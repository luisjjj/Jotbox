import { getPool } from "./pg.mjs";
import { planOf } from "./billing.mjs";
import { ENTERPRISE_PLAN_KEY, FREE_PLAN_KEY } from "./plan-keys.mjs";
import { planMonthlySeconds, usageSeconds, usageSecondsSince, usageSnapshot } from "./usage.mjs";

/**
 * Reserve and settle listening time.
 *
 * A reservation is taken before a recording starts, so a person who is out of
 * minutes is refused before a speech provider is paid. Saving the capture
 * settles the reservation into `usage_ledger`; an abandoned recording expires.
 * Enterprise members draw from one shared pool when their organisation has a
 * pool set.
 */

export const OVERAGE_GRACE_SECONDS = 10;
export const MAX_RESERVATION_SECONDS = 4 * 3600;
export const RESERVATION_TTL_MINUTES = 6 * 60;

export function overLimitMessage(plan, limitSeconds, exhausted) {
  if (plan === ENTERPRISE_PLAN_KEY) {
    return "This workspace has used its listening time for this month. Your notes are still saved on this device.";
  }
  if (plan !== FREE_PLAN_KEY) {
    const hours = Math.max(1, Math.round(limitSeconds / 3600));
    return exhausted
      ? `You have used the ${hours} hours included with your plan this month. It resets at the start of next month. Your notes are still saved on this device.`
      : "This capture is longer than the listening time you have left this month. Your notes are still saved on this device.";
  }
  return exhausted
    ? "Your 100 free listening minutes are finished. Upgrade to keep listening. Your notes are still saved on this device."
    : "This capture is longer than the free listening time you have left. Upgrade to keep listening. Your notes are still saved on this device.";
}

/**
 * Pure check so the rule can be tested without a database. `limitSeconds`
 * stays real even when the plan displays as unlimited.
 */
export function decideQuota({ usedSeconds = 0, reservedSeconds = 0, limitSeconds, seconds = 0 }) {
  const used = Math.max(0, Number(usedSeconds) || 0);
  const reserved = Math.max(0, Number(reservedSeconds) || 0);
  const ask = Math.max(0, Math.min(Number(seconds) || 0, MAX_RESERVATION_SECONDS));
  const limit = Math.max(0, Number(limitSeconds) || 0);
  return {
    allowed: used + reserved + ask <= limit + OVERAGE_GRACE_SECONDS,
    usedSeconds: used,
    reservedSeconds: reserved,
    requestedSeconds: ask,
    limitSeconds: limit,
    remainingSeconds: Math.max(0, limit - used - reserved),
  };
}

async function planRow(db, userId) {
  const result = await db.query("select * from billing_subscriptions where user_id = $1 limit 1", [userId]);
  return result.rows[0] ?? null;
}

async function freeAllowanceStart(db, userId) {
  const result = await db.query("select free_allowance_started_at from users where id = $1 limit 1", [userId]);
  return result.rows[0]?.free_allowance_started_at ?? null;
}

async function poolFor(db, userId, plan) {
  if (plan !== ENTERPRISE_PLAN_KEY) return null;
  const result = await db.query(
    `select o.id, o.pool_seconds
       from org_members m
       join organisations o on o.id = m.org_id
      where m.user_id = $1
        and o.plan = 'enterprise'
        and o.pool_seconds is not null
      order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.joined_at
      limit 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { orgId: row.id, limitSeconds: Number(row.pool_seconds) };
}

export async function quotaScope(db, userId) {
  const plan = planOf(await planRow(db, userId));
  const pool = await poolFor(db, userId, plan);
  if (pool) {
    return {
      userId,
      plan,
      orgId: pool.orgId,
      scopeId: `org:${pool.orgId}`,
      limitSeconds: pool.limitSeconds,
      unlimited: false,
      pooled: true,
      lifetimeSince: null,
    };
  }
  // Free minutes are a lifetime allowance. Paid plans keep the calendar-month
  // window, which is what the quota message promises.
  const lifetimeSince =
    plan === FREE_PLAN_KEY ? ((await freeAllowanceStart(db, userId)) ?? new Date(0)) : null;
  return {
    userId,
    plan,
    orgId: null,
    scopeId: `user:${userId}`,
    limitSeconds: planMonthlySeconds(plan),
    // Enterprise keeps the hidden ceiling but presents as unlimited.
    unlimited: plan === ENTERPRISE_PLAN_KEY,
    pooled: false,
    lifetimeSince,
  };
}

async function usedForScope(db, scope) {
  if (scope.lifetimeSince != null) return usageSecondsSince(db, scope.userId, scope.lifetimeSince);
  if (!scope.pooled) return usageSeconds(db, scope.userId);
  const result = await db.query(
    `with bounds as (
       select date_trunc('month', now()) as start_at,
              date_trunc('month', now()) + interval '1 month' as end_at
     )
     select coalesce(sum(l.seconds), 0) as used
       from bounds
       join org_members m on m.org_id = $1
       join usage_ledger l
         on l.user_id = m.user_id
        and l.recorded_at >= bounds.start_at
        and l.recorded_at < bounds.end_at`,
    [scope.orgId],
  );
  return Number(result.rows[0]?.used) || 0;
}

async function expireStale(db, scope) {
  await db.query(
    `update usage_reservations
        set status = 'expired'
      where status = 'active'
        and expires_at < now()
        and (${scope.pooled ? "org_id = $1" : "user_id = $1"})`,
    [scope.pooled ? scope.orgId : scope.userId],
  );
}

async function reservedForScope(db, scope, excludeCaptureId = null) {
  const column = scope.pooled ? "org_id" : "user_id";
  const value = scope.pooled ? scope.orgId : scope.userId;
  const result = await db.query(
    `select coalesce(sum(seconds), 0) as reserved
       from usage_reservations
      where status = 'active'
        and expires_at > now()
        and ${column} = $1
        and ($2::uuid is null or capture_id <> $2::uuid)`,
    [value, excludeCaptureId],
  );
  return Number(result.rows[0]?.reserved) || 0;
}

export async function quotaState(db, userId, { excludeCaptureId = null } = {}) {
  const scope = await quotaScope(db, userId);
  await expireStale(db, scope);
  const used = await usedForScope(db, scope);
  const reserved = await reservedForScope(db, scope, excludeCaptureId);
  let bounds = { start: scope.lifetimeSince, end: null };
  if (scope.lifetimeSince === null) {
    const month = await db.query(
      `select date_trunc('month', now()) as start_at,
              date_trunc('month', now()) + interval '1 month' as end_at`,
    );
    bounds = { start: month.rows[0]?.start_at, end: month.rows[0]?.end_at };
  }
  const usage = usageSnapshot(
    used,
    { unlimited: scope.unlimited, limitSeconds: scope.limitSeconds },
    bounds,
  );
  return {
    plan: scope.plan,
    pooled: scope.pooled,
    orgId: scope.orgId,
    reservedSeconds: reserved,
    availableSeconds: scope.unlimited
      ? null
      : Math.max(0, scope.limitSeconds - used - reserved),
    limitSeconds: scope.limitSeconds,
    usedSeconds: used,
    usage,
  };
}

export async function reserveQuota({ userId, captureId, seconds }) {
  const requested = Math.max(0, Math.min(Math.round(Number(seconds) || 0), MAX_RESERVATION_SECONDS));
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const scope = await quotaScope(client, userId);
    // One lock per scope keeps the check and the reservation atomic across
    // tabs and, for an enterprise pool, across every member of the org.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`quota:${scope.scopeId}`]);
    await expireStale(client, scope);
    const used = await usedForScope(client, scope);
    const reserved = await reservedForScope(client, scope, captureId);
    const decision = decideQuota({
      usedSeconds: used,
      reservedSeconds: reserved,
      limitSeconds: scope.limitSeconds,
      seconds: requested,
    });
    if (!decision.allowed) {
      await client.query("rollback");
      return {
        ok: false,
        plan: scope.plan,
        state: { ...decision, pooled: scope.pooled, orgId: scope.orgId, unlimited: scope.unlimited },
      };
    }
    const saved = await client.query(
      `insert into usage_reservations (user_id, capture_id, org_id, seconds, status, expires_at)
       values ($1, $2, $3, $4, 'active', now() + ($5::int * interval '1 minute'))
       on conflict (user_id, capture_id) where status = 'active'
       do update set seconds = excluded.seconds,
                     expires_at = excluded.expires_at,
                     org_id = excluded.org_id
       returning id, seconds, expires_at`,
      [userId, captureId, scope.orgId, requested, RESERVATION_TTL_MINUTES],
    );
    await client.query("commit");
    return {
      ok: true,
      plan: scope.plan,
      reservation: saved.rows[0],
      state: {
        ...decision,
        pooled: scope.pooled,
        orgId: scope.orgId,
        unlimited: scope.unlimited,
      },
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function settleQuota(db, userId, captureId) {
  await db.query(
    `update usage_reservations
        set status = 'settled', settled_at = now()
      where user_id = $1 and capture_id = $2 and status = 'active'`,
    [userId, captureId],
  );
}

export async function releaseQuota(userId, captureId) {
  await getPool().query(
    `update usage_reservations
        set status = 'released', settled_at = now()
      where user_id = $1 and capture_id = $2 and status = 'active'`,
    [userId, captureId],
  );
}

export async function sweepReservations() {
  const result = await getPool().query(
    `update usage_reservations
        set status = 'expired'
      where status = 'active' and expires_at < now()`,
  );
  return result.rowCount ?? 0;
}

export async function quotaUsage(userId) {
  return quotaState(getPool(), userId);
}
