import { query } from "./pg.mjs";

const DEFAULT_FREE_MINUTES = 100;
const DEFAULT_PRO_HOURS = 25;
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

export function freeMonthlySeconds(env = process.env) {
  const raw = Number(env.JOTBOX_FREE_MONTH_MINUTES);
  const minutes =
    Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), MAX_MONTH_MINUTES) : DEFAULT_FREE_MINUTES;
  return minutes * 60;
}

export function proMonthlySeconds(env = process.env) {
  return monthHours(env, "JOTBOX_PRO_MONTH_HOURS", DEFAULT_PRO_HOURS);
}

export function enterpriseMonthlySeconds(env = process.env) {
  return monthHours(env, "JOTBOX_ENTERPRISE_MONTH_HOURS", DEFAULT_ENTERPRISE_HOURS);
}

export function planMonthlySeconds(plan, env = process.env) {
  if (plan === "enterprise") return enterpriseMonthlySeconds(env);
  if (plan === "pro") return proMonthlySeconds(env);
  return freeMonthlySeconds(env);
}

export function usageSnapshot(usedSeconds, { unlimited = false, limitSeconds = freeMonthlySeconds() } = {}, bounds = {}) {
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

export async function monthlyUsageSeconds(userId, { excludeId } = {}) {
  return usageSeconds({ query }, userId, excludeId ?? null);
}

export async function usageView(userId, { unlimited = false, limitSeconds, excludeId } = {}) {
  const row = await usageRow(userId, excludeId);
  return usageSnapshot(row.used, { unlimited, limitSeconds }, { start: row.start_at, end: row.end_at });
}
