import { query } from "./pg.mjs";

const DEFAULT_FREE_MINUTES = 60;
const MAX_FREE_MINUTES = 24 * 60 * 31;

export function freeMonthlySeconds(env = process.env) {
  const raw = Number(env.JOTBOX_FREE_MONTH_MINUTES);
  const minutes =
    Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), MAX_FREE_MINUTES) : DEFAULT_FREE_MINUTES;
  return minutes * 60;
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
     select bounds.start_at, bounds.end_at, coalesce(sum(c.duration_sec), 0) as used
       from bounds
       left join captures c
         on c.user_id = $1
        and c.recorded_at >= bounds.start_at
        and c.recorded_at < bounds.end_at
        and ($2::uuid is null or c.id <> $2::uuid)
      group by bounds.start_at, bounds.end_at`,
    [userId, excludeId ?? null],
  );
  return result.rows[0] ?? { used: 0, start_at: null, end_at: null };
}

export async function monthlyUsageSeconds(userId, { excludeId } = {}) {
  const row = await usageRow(userId, excludeId);
  return Number(row.used) || 0;
}

export async function usageView(userId, { unlimited = false, excludeId } = {}) {
  const row = await usageRow(userId, excludeId);
  return usageSnapshot(row.used, { unlimited }, { start: row.start_at, end: row.end_at });
}
