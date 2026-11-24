import { query } from "./pg.mjs";
import { ENTERPRISE_PLAN_KEY, POWER_PLAN_KEY, STARTER_PLAN_KEY } from "./plan-keys.mjs";

const DEFAULT_FREE_MINUTES = 100;
const DEFAULT_STARTER_HOURS = 10;
const DEFAULT_POWER_HOURS = 25;
// The old paid key. Kept at its original 20 hours so anyone already paying
// keeps what they bought.
const DEFAULT_LEGACY_PRO_HOURS = 20;
const DEFAULT_ENTERPRISE_HOURS = 1000;
const MAX_MONTH_MINUTES = 24 * 60 * 31;
// The hidden enterprise ceiling is larger than any calendar month, so it is
// capped by the product limit rather than by days in a month.
const MAX_MONTH_HOURS = 1000;

function monthHours(env, name, fallback) {
  const raw = Number(env[name]);
  const hours = Number.isFinite(raw) && raw > 0 ? Math.min(Math.max(1, Math.round(raw)), MAX_MONTH_HOURS) : fallback;
  return hours * 3600;
}

/**
 * The free allowance is lifetime, not monthly. It is counted from
 * `users.free_allowance_started_at`, which the pricing migration sets to the
 * rollout time for existing accounts so nobody loses minutes they already had.
 */
export function freeAllowanceSeconds(env = process.env) {
  const raw = Number(env.JOTBOX_FREE_MONTH_MINUTES);
  const minutes =
    Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), MAX_MONTH_MINUTES) : DEFAULT_FREE_MINUTES;
  return minutes * 60;
}

export function starterMonthlySeconds(env = process.env) {
  return monthHours(env, "JOTBOX_STARTER_MONTH_HOURS", DEFAULT_STARTER_HOURS);
}

export function powerMonthlySeconds(env = process.env) {
  return monthHours(env, "JOTBOX_POWER_MONTH_HOURS", DEFAULT_POWER_HOURS);
}

export function legacyProMonthlySeconds(env = process.env) {
  return monthHours(env, "JOTBOX_PRO_MONTH_HOURS", DEFAULT_LEGACY_PRO_HOURS);
}

export function enterpriseMonthlySeconds(env = process.env) {
  return monthHours(env, "JOTBOX_ENTERPRISE_MONTH_HOURS", DEFAULT_ENTERPRISE_HOURS);
}

export function planMonthlySeconds(plan, env = process.env) {
  if (plan === ENTERPRISE_PLAN_KEY) return enterpriseMonthlySeconds(env);
  if (plan === POWER_PLAN_KEY) return powerMonthlySeconds(env);
  if (plan === STARTER_PLAN_KEY) return starterMonthlySeconds(env);
  if (plan === "pro") return legacyProMonthlySeconds(env);
  return freeAllowanceSeconds(env);
}

export function usageSnapshot(usedSeconds, { unlimited = false, limitSeconds = freeAllowanceSeconds() } = {}, bounds = {}) {
  const used = Math.max(0, Math.ceil(Number(usedSeconds) || 0));
  return {
    unlimited: Boolean(unlimited),
    usedSeconds: used,
    limitSeconds: unlimited ? null : limitSeconds,
    remainingSeconds: unlimited ? null : Math.max(0, limitSeconds - used),
    periodStart: bounds.start ? new Date(bounds.start).getTime() : null,
    periodEnd: bounds.end ? new Date(bounds.end).getTime() : null,
  };
}

async function usageRow(userId, excludeId) {
  const result = await query(
    `with bounds as (
       select date_trunc('month', now()) as start_at,
              date_trunc('month', now()) + interval '1 month' as end_at
     )
     select bounds.start_at, bounds.end_at, coalesce(sum(l.seconds), 0) as used
       from bounds
       left join usage_ledger l
         on l.user_id = $1
        and l.recorded_at >= bounds.start_at
        and l.recorded_at < bounds.end_at
        and ($2::uuid is null or l.capture_id <> $2::uuid)
      group by bounds.start_at, bounds.end_at`,
    [userId, excludeId ?? null],
  );
  return result.rows[0] ?? { used: 0, start_at: null, end_at: null };
}

export async function usageSeconds(db, userId, excludeId = null) {
  const result = await db.query(
    `with bounds as (
       select date_trunc('month', now()) as start_at,
              date_trunc('month', now()) + interval '1 month' as end_at
     )
     select coalesce(sum(l.seconds), 0) as used
       from bounds
       left join usage_ledger l
         on l.user_id = $1
        and l.recorded_at >= bounds.start_at
        and l.recorded_at < bounds.end_at
        and ($2::uuid is null or l.capture_id <> $2::uuid)`,
    [userId, excludeId],
  );
  return Number(result.rows[0]?.used) || 0;
}

export async function usageSecondsSince(db, userId, since, excludeId = null) {
  const result = await db.query(
    `select coalesce(sum(l.seconds), 0) as used
       from usage_ledger l
      where l.user_id = $1
        and ($2::timestamptz is null or l.recorded_at >= $2::timestamptz)
        and ($3::uuid is null or l.capture_id <> $3::uuid)`,
    [userId, since ?? null, excludeId],
  );
  return Number(result.rows[0]?.used) || 0;
}

export async function monthlyUsageSeconds(userId, { excludeId } = {}) {
  return usageSeconds({ query }, userId, excludeId ?? null);
}

export async function usageView(userId, { unlimited = false, limitSeconds, excludeId } = {}) {
  const row = await usageRow(userId, excludeId);
  return usageSnapshot(row.used, { unlimited, limitSeconds }, { start: row.start_at, end: row.end_at });
}
