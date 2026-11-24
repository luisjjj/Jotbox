import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getPool, query } from "./pg.mjs";
import { requireSession } from "./auth.mjs";
import { quotaUsage, sweepReservations } from "./quota.mjs";
import { sweepExpiredAudio } from "./storage.mjs";
import { sweepJobs } from "./jobs.mjs";
import { sendCancellationEmail, sendReceiptEmail, sendRenewalReminderEmail } from "./email.mjs";
import {
  HttpError,
  assertSameOrigin,
  readJson,
  requireMethod,
  sendJson,
} from "./http.mjs";
import {
  ENTERPRISE_PLAN_KEY,
  LEGACY_PRO_PLAN_KEY,
  PAID_PLAN_KEYS,
  POWER_PLAN_KEY,
  STARTER_PLAN_KEY,
  isPurchasePlan,
} from "./plan-keys.mjs";

/**
 * Pro subscriptions.
 *
 * There are two paid plans, Starter Pro and Power User. Both are priced in US
 * dollars on the site but charged in Naira, because a Paystack plan is tied to
 * one currency. Each Naira amount is set with PAYSTACK_PRO_AMOUNT_NGN or
 * PAYSTACK_POWER_AMOUNT_NGN, or converted from the dollar price with
 * JOTBOX_USD_TO_NGN. A legacy Pro row keeps its original price and allowance.
 *
 * Money is only trusted after Paystack confirms it. The browser return and the
 * webhook both write through the same reference-first ledger, so a retry or a
 * second browser tab cannot buy a second month, and a webhook cannot extend a
 * plan past the period Paystack says was paid for.
 */

const PAYSTACK_API = "https://api.paystack.co";
const STARTER_PRICE_USD = 7;
const POWER_PRICE_USD = 16;
const DEFAULT_NGN_PER_USD = 1400;
const PAYSTACK_TIMEOUT_MS = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECKOUT_CREATING_MS = 90 * 1000;
const MAX_CHECKOUTS_PER_HOUR = 12;
const MAX_PERIOD_DAYS = 32;
const ACTIVE_GRACE_DAYS = 1;
const ATTENTION_GRACE_DAYS = 2;
const RECONCILE_AFTER_MS = 10 * 60 * 1000;
const REMINDER_WINDOW_DAYS = 3;
const REMINDER_BATCH = 25;
const MIN_PRO_AMOUNT_KOBO = 100_00;
const PLAN_CHECK_MS = 10 * 60 * 1000;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function purchaseTier({ key, label, usd, amountEnv, planCodeEnv, ngnPerUsd, env }) {
  const naira = Math.round(positiveNumber(env[amountEnv], usd * ngnPerUsd));
  return {
    key,
    label,
    usd,
    naira,
    amountKobo: naira * 100,
    planCode: env[planCodeEnv]?.trim() || "",
  };
}

export function billingConfig(env = process.env) {
  const ngnPerUsd = Math.round(positiveNumber(env.JOTBOX_USD_TO_NGN, DEFAULT_NGN_PER_USD));
  const secret = env.PAYSTACK_SECRET_KEY?.trim() || "";
  const starter = purchaseTier({
    key: STARTER_PLAN_KEY,
    label: "Starter Pro",
    usd: STARTER_PRICE_USD,
    amountEnv: "PAYSTACK_PRO_AMOUNT_NGN",
    planCodeEnv: "PAYSTACK_PLAN_CODE",
    ngnPerUsd,
    env,
  });
  const power = purchaseTier({
    key: POWER_PLAN_KEY,
    label: "Power User",
    usd: POWER_PRICE_USD,
    amountEnv: "PAYSTACK_POWER_AMOUNT_NGN",
    planCodeEnv: "PAYSTACK_POWER_PLAN_CODE",
    ngnPerUsd,
    env,
  });
  return {
    currency: "NGN",
    interval: "monthly",
    // The top-level fields stay on Starter so older callers keep working.
    usd: starter.usd,
    naira: starter.naira,
    amountKobo: starter.amountKobo,
    planCode: starter.planCode,
    ngnPerUsd,
    configured: Boolean(secret),
    live: secret.startsWith("sk_live_"),
    tiers: { [STARTER_PLAN_KEY]: starter, [POWER_PLAN_KEY]: power },
    starter,
    power,
  };
}

export function tierConfig(config, tier) {
  const found = config.tiers?.[tier];
  if (!found) throw new HttpError(400, "That plan is not available.");
  return found;
}

function publicPricing(config = billingConfig()) {
  return {
    usd: config.usd,
    naira: config.naira,
    ngnPerUsd: config.ngnPerUsd,
    currency: config.currency,
    interval: config.interval,
    starter: { usd: config.starter.usd, naira: config.starter.naira },
    power: { usd: config.power.usd, naira: config.power.naira },
  };
}

function requirePaystack() {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret) throw new HttpError(503, "Payments are not switched on yet.");
  if (process.env.VERCEL_ENV === "production" && !secret.startsWith("sk_live_")) {
    throw new HttpError(503, "Payments are still in test mode. Add the live Paystack key first.");
  }
  return secret;
}

async function paystack(path, init = {}, timeoutMs = PAYSTACK_TIMEOUT_MS) {
  const secret = requirePaystack();
  let response;
  try {
    response = await fetch(`${PAYSTACK_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    console.error("[jotbox-billing] Paystack request failed", path, error);
    throw new HttpError(502, "Paystack did not answer. Try again in a moment.");
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.status === false) {
    console.error("[jotbox-billing] Paystack refused", path, response.status, body?.message);
    throw new HttpError(
      response.status === 404 ? 404 : 502,
      body?.message || "Paystack could not complete that. Try again.",
    );
  }
  return body?.data;
}

function publicOrigin(req) {
  const configured = process.env.JOTBOX_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const proto =
    String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim() || (req.socket?.encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5173";
  return `${proto}://${host}`;
}

/**
 * A cached plan code can belong to Paystack test mode, or to a price that has
 * since changed. Verifying the plan with the current key before reusing it
 * stops a live checkout from initialising against a test plan or an old price.
 */
const planChecks = new Map();

async function planMatches(code, config) {
  const cacheKey = `${code}:${config.amountKobo}:${config.currency}:${config.interval}`;
  const checkedAt = planChecks.get(cacheKey);
  if (checkedAt && Date.now() - checkedAt < PLAN_CHECK_MS) return true;

  let plan;
  try {
    plan = await paystack(`/plan/${encodeURIComponent(code)}`, {}, 5000);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return false;
    throw error;
  }

  const matches =
    currencyOf(plan?.currency) === config.currency &&
    numberOrNull(plan?.amount) === config.amountKobo &&
    String(plan?.interval || "").toLowerCase() === config.interval;
  if (matches) planChecks.set(cacheKey, Date.now());
  return matches;
}

async function ensurePlan(config, tier = config.starter) {
  const price = { ...config, amountKobo: tier.amountKobo, currency: config.currency, interval: config.interval };
  if (tier.planCode) {
    if (!(await planMatches(tier.planCode, price))) {
      throw new HttpError(
        503,
        `The Paystack plan code for ${tier.label} does not match the current price. Update it or remove it.`,
      );
    }
    return tier.planCode;
  }

  const cached = await query(
    `select code, currency, amount, interval
       from billing_plans
      where provider = 'paystack' and plan_key = $1
      limit 1`,
    [tier.key],
  );
  const row = cached.rows[0];
  if (
    row &&
    row.currency === config.currency &&
    Number(row.amount) === tier.amountKobo &&
    row.interval === config.interval &&
    (await planMatches(row.code, price))
  ) {
    return row.code;
  }

  const plan = await paystack("/plan", {
    method: "POST",
    body: JSON.stringify({
      name: `JotBox ${tier.label} ${config.currency} ${tier.naira} monthly`,
      interval: config.interval,
      amount: tier.amountKobo,
      currency: config.currency,
    }),
  });
  const code = plan?.plan_code;
  if (!code) throw new HttpError(502, "Paystack did not return a plan. Try again.");

  await query(
    `insert into billing_plans (provider, plan_key, code, currency, amount, interval)
     values ('paystack', $1, $2, $3, $4, $5)
     on conflict (provider, plan_key) do update
       set code = excluded.code,
           currency = excluded.currency,
           amount = excluded.amount,
           interval = excluded.interval,
           created_at = now()`,
    [tier.key, code, config.currency, tier.amountKobo, config.interval],
  );
  return code;
}

async function knownPlanCode(config, planKey = LEGACY_PRO_PLAN_KEY) {
  const tier = config.tiers?.[planKey];
  if (tier?.planCode) return tier.planCode;
  const cached = await query(
    "select code from billing_plans where provider = 'paystack' and plan_key = $1 limit 1",
    [planKey],
  );
  return cached.rows[0]?.code ?? null;
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function currencyOf(value) {
  return String(value || "").trim().toUpperCase();
}

/**
 * Clamp a paid period so a stale, replayed, or buggy event cannot hand out
 * years of Pro. An unexpired period already on file is never shortened.
 */
export function clampPeriodEnd(value, now = Date.now(), existingEnd = null) {
  const proposed = dateOrNull(value)?.getTime();
  const cap = now + MAX_PERIOD_DAYS * DAY_MS;
  const fallback = now + 30 * DAY_MS;
  const bounded = Math.min(proposed ?? fallback, cap);
  const keep = existingEnd && existingEnd > now ? existingEnd : 0;
  return new Date(Math.min(Math.max(bounded, keep), cap));
}

export function isEntitled(row, now = Date.now()) {
  if (!row) return false;
  // Enterprise seats are invoiced outside Paystack, so an active manual plan
  // stays on until an operator turns it off.
  if (row.plan_key === ENTERPRISE_PLAN_KEY && row.status === "active") return true;
  const end = dateOrNull(row.current_period_end || row.next_payment_at)?.getTime() ?? null;
  const recent = dateOrNull(row.updated_at || row.started_at)?.getTime() ?? null;

  if (row.status === "active") {
    if (end) return now < end + ACTIVE_GRACE_DAYS * DAY_MS;
    return recent ? now < recent + (MAX_PERIOD_DAYS + ACTIVE_GRACE_DAYS) * DAY_MS : true;
  }
  if (row.status === "attention") {
    if (end) return now < end + ATTENTION_GRACE_DAYS * DAY_MS;
    return recent ? now < recent + (MAX_PERIOD_DAYS + ATTENTION_GRACE_DAYS) * DAY_MS : true;
  }
  if (row.status === "non-renewing") {
    if (end) return now < end + ACTIVE_GRACE_DAYS * DAY_MS;
    return recent ? now < recent + (MAX_PERIOD_DAYS + ACTIVE_GRACE_DAYS) * DAY_MS : true;
  }
  if (row.status === "cancelled") {
    return Boolean(end && now < end);
  }
  return false;
}

export function subscriptionView(row) {
  if (!row) return null;
  return {
    planKey: row.plan_key,
    status: row.status,
    currency: row.currency,
    amount: Number(row.amount),
    interval: row.interval,
    nextPaymentAt: row.next_payment_at ? new Date(row.next_payment_at).getTime() : null,
    periodEnd: row.current_period_end ? new Date(row.current_period_end).getTime() : null,
    startedAt: row.started_at ? new Date(row.started_at).getTime() : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).getTime() : null,
    reconciledAt: row.last_reconciled_at ? new Date(row.last_reconciled_at).getTime() : null,
  };
}

async function getSubscription(userId) {
  const result = await query("select * from billing_subscriptions where user_id = $1 limit 1", [userId]);
  return result.rows[0] ?? null;
}

export async function isProUser(userId) {
  return isEntitled(await getSubscription(userId));
}

export function planOf(row, now = Date.now()) {
  if (!isEntitled(row, now)) return "free";
  if (row.plan_key === ENTERPRISE_PLAN_KEY) return "enterprise";
  if (row.plan_key === POWER_PLAN_KEY) return "power";
  if (row.plan_key === STARTER_PLAN_KEY) return "starter";
  return LEGACY_PRO_PLAN_KEY;
}

export async function planForUser(userId) {
  return planOf(await getSubscription(userId));
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function statusFromEvent(event) {
  const map = {
    "subscription.create": "active",
    "subscription.enable": "active",
    "subscription.not_renew": "non-renewing",
    "subscription.disable": "cancelled",
    "charge.success": "active",
    "invoice.payment_failed": "attention",
  };
  return map[event] ?? null;
}

/**
 * Apply a subscription snapshot. Events older than the last one already applied
 * are ignored, which stops a retry of an old "active" webhook from resurrecting
 * a plan the person has since cancelled.
 */
async function saveSubscription(input, client = null) {
  const run = async (db) => {
    const found = await db.query("select * from billing_subscriptions where user_id = $1 for update", [
      input.userId,
    ]);
    const existing = found.rows[0] ?? null;
    const now = Date.now();
    const eventAt = input.eventAt ? input.eventAt.getTime() : now;
    const lastEventAt = existing?.last_event_at ? new Date(existing.last_event_at).getTime() : null;

    if (input.source !== "reconcile" && lastEventAt !== null) {
      if (eventAt < lastEventAt) return { row: existing, applied: false, reason: "stale_event" };
      if (
        eventAt === lastEventAt &&
        (existing.status === "cancelled" || existing.status === "non-renewing") &&
        input.status === "active"
      ) {
        return { row: existing, applied: false, reason: "cancelled_wins_tie" };
      }
    }

    const existingEnd = dateOrNull(existing?.current_period_end || existing?.next_payment_at)?.getTime() ?? null;
    const isEnding = input.status === "cancelled" || input.status === "non-renewing";
    const periodEnd = isEnding
      ? new Date(
          Math.min(
            Math.max(existingEnd ?? 0, dateOrNull(input.nextPaymentAt)?.getTime() ?? 0, now),
            now + MAX_PERIOD_DAYS * DAY_MS,
          ),
        )
      : clampPeriodEnd(input.nextPaymentAt, now, existingEnd);
    const periodStart = dateOrNull(input.startedAt) || dateOrNull(existing?.current_period_start) || new Date(now);

    const result = await db.query(
      `insert into billing_subscriptions
         (user_id, provider, plan_key, plan_code, subscription_code, email_token, status,
          currency, amount, interval, customer_code, reference, next_payment_at,
          current_period_start, current_period_end, started_at, cancelled_at,
          last_event_at, last_event_id, last_reconciled_at)
       values ($1, 'paystack', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, coalesce($15, now()), $16, $17, $18, $19)
       on conflict (user_id) do update
         set provider = excluded.provider,
             plan_key = excluded.plan_key,
             plan_code = coalesce(excluded.plan_code, billing_subscriptions.plan_code),
             subscription_code = coalesce(excluded.subscription_code, billing_subscriptions.subscription_code),
             email_token = coalesce(excluded.email_token, billing_subscriptions.email_token),
             status = excluded.status,
             currency = coalesce(excluded.currency, billing_subscriptions.currency),
             amount = case when excluded.amount > 0 then excluded.amount else billing_subscriptions.amount end,
             interval = coalesce(excluded.interval, billing_subscriptions.interval),
             customer_code = coalesce(excluded.customer_code, billing_subscriptions.customer_code),
             reference = coalesce(excluded.reference, billing_subscriptions.reference),
             next_payment_at = excluded.next_payment_at,
             current_period_start = coalesce(billing_subscriptions.current_period_start, excluded.current_period_start),
             current_period_end = excluded.current_period_end,
             cancelled_at = excluded.cancelled_at,
             last_event_at = excluded.last_event_at,
             last_event_id = excluded.last_event_id,
             last_reconciled_at = coalesce(excluded.last_reconciled_at, billing_subscriptions.last_reconciled_at),
             updated_at = now()
       returning *`,
      [
        input.userId,
        PAID_PLAN_KEYS.includes(input.planKey) ? input.planKey : LEGACY_PRO_PLAN_KEY,
        input.planCode ?? null,
        input.subscriptionCode ?? null,
        input.emailToken ?? null,
        input.status,
        currencyOf(input.currency) || "NGN",
        numberOrNull(input.amount) ?? 0,
        input.interval || "monthly",
        input.customerCode ?? null,
        input.reference ?? null,
        periodEnd,
        periodStart,
        periodEnd,
        dateOrNull(input.startedAt),
        input.status === "cancelled" ? new Date(now) : null,
        new Date(eventAt),
        input.eventId ?? null,
        input.source === "reconcile" ? new Date(now) : null,
      ],
    );
    return { row: result.rows[0] ?? null, applied: true, reason: "" };
  };

  return client ? run(client) : withTransaction(run);
}

function metadataOf(data) {
  const raw = data?.metadata;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? raw : {};
}

async function resolveUserId({ metadata, customer, subscriptionCode }) {
  const candidate = metadata?.user_id || metadata?.userId;
  if (
    typeof candidate === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)
  ) {
    const found = await query("select id from users where id = $1 limit 1", [candidate]);
    if (found.rows[0]) return found.rows[0].id;
  }

  const email = typeof customer?.email === "string" ? customer.email.trim().toLowerCase() : "";
  if (email) {
    const found = await query("select id from users where email = $1 limit 1", [email]);
    if (found.rows[0]) return found.rows[0].id;
  }

  if (subscriptionCode) {
    const found = await query(
      "select user_id from billing_subscriptions where provider = 'paystack' and subscription_code = $1 limit 1",
      [subscriptionCode],
    );
    if (found.rows[0]) return found.rows[0].user_id;
  }
  return null;
}

function shapeEvent(data) {
  const subscription = data?.subscription && typeof data.subscription === "object" ? data.subscription : {};
  const plan = data?.plan && typeof data.plan === "object" ? data.plan : {};
  return {
    subscription,
    plan,
    subscriptionCode: data?.subscription_code || data?.code || subscription.subscription_code || null,
    emailToken: data?.email_token || subscription.email_token || null,
    nextPaymentAt: data?.next_payment_date || subscription.next_payment_date || null,
    customer: data?.customer && typeof data.customer === "object" ? data.customer : {},
  };
}

/**
 * A charge may only grant Pro when it is a Naira payment for exactly the price
 * quoted when that checkout was opened. Checking against the live config would
 * reject a payment made just before a price change, and accepting any cheaper
 * reference would let someone unlock Pro with a smaller payment.
 */
export function validPaidCharge(data, { existing, config, planCode, checkout = null, tier = null }) {
  const shaped = shapeEvent(data);
  const chargeCode = shaped.plan.plan_code || data?.plan_code || null;
  const ourCode = checkout?.plan_code || existing?.plan_code || planCode;
  if (chargeCode && ourCode && chargeCode !== ourCode) return false;

  const metadata = metadataOf(data);
  if (metadata.plan_key && !PAID_PLAN_KEYS.includes(metadata.plan_key)) return false;
  const hasPaidEvidence =
    Boolean(checkout) ||
    Boolean(existing) ||
    PAID_PLAN_KEYS.includes(metadata.plan_key) ||
    Boolean(chargeCode && (!ourCode || chargeCode === ourCode));
  if (!hasPaidEvidence) return false;

  const currency = currencyOf(data?.currency || shaped.plan.currency);
  const expectedCurrency = currencyOf(checkout?.currency || existing?.currency || config.currency);
  if (currency !== "NGN" || currency !== expectedCurrency) return false;

  const amount = numberOrNull(data?.amount ?? shaped.plan.amount);
  if (amount === null) return false;
  const expected =
    checkout?.amount > 0
      ? Number(checkout.amount)
      : existing?.amount > 0
        ? Number(existing.amount)
        : tier?.amountKobo > 0
          ? tier.amountKobo
          : config.amountKobo;
  return amount === expected && amount >= MIN_PRO_AMOUNT_KOBO;
}

async function getCheckout(reference, userId = null) {
  if (!reference) return null;
  const result = userId
    ? await query("select * from billing_checkouts where reference = $1 and user_id = $2 limit 1", [
        reference,
        userId,
      ])
    : await query("select * from billing_checkouts where reference = $1 limit 1", [reference]);
  return result.rows[0] ?? null;
}

/**
 * A first payment can be lost when the webhook and the browser return both
 * fail before a subscription row exists. Recent checkouts are the durable
 * breadcrumb back to that money.
 */
async function recentCheckouts(userId, limit = 5) {
  const result = await query(
    `select * from billing_checkouts
      where user_id = $1
        and status in ('open', 'creating', 'paid')
        and created_at > now() - interval '7 days'
      order by created_at desc
      limit $2`,
    [userId, limit],
  );
  return result.rows;
}

async function recordTransaction(client, input) {
  const result = await client.query(
    `insert into billing_transactions
       (provider, reference, user_id, plan_code, subscription_code, status, amount,
        currency, channel, paid_at, metadata)
     values ('paystack', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     on conflict (provider, reference) do update
       set status = excluded.status,
           amount = excluded.amount,
           currency = excluded.currency,
           channel = coalesce(excluded.channel, billing_transactions.channel),
           plan_code = coalesce(excluded.plan_code, billing_transactions.plan_code),
           subscription_code = coalesce(excluded.subscription_code, billing_transactions.subscription_code),
           paid_at = coalesce(billing_transactions.paid_at, excluded.paid_at),
           metadata = excluded.metadata,
           updated_at = now()
     returning *, (applied_at is null) as needs_apply`,
    [
      input.reference,
      input.userId,
      input.planCode ?? null,
      input.subscriptionCode ?? null,
      input.status,
      Number(input.amount) || 0,
      currencyOf(input.currency) || "NGN",
      input.channel ?? null,
      dateOrNull(input.paidAt),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows[0] ?? null;
}

async function planKeyForCode(code, config) {
  if (!code) return null;
  if (config.power?.planCode === code) return POWER_PLAN_KEY;
  if (config.starter?.planCode === code) return STARTER_PLAN_KEY;
  const found = await query(
    "select plan_key from billing_plans where provider = 'paystack' and code = $1 limit 1",
    [code],
  );
  return found.rows[0]?.plan_key ?? null;
}

export function planKeyForCharge({ metadata, checkout, existing, chargePlanCode, config }) {
  if (PAID_PLAN_KEYS.includes(metadata?.plan_key)) return metadata.plan_key;
  if (PAID_PLAN_KEYS.includes(checkout?.plan_key)) return checkout.plan_key;
  if (PAID_PLAN_KEYS.includes(existing?.plan_key)) return existing.plan_key;
  if (chargePlanCode && config.power?.planCode === chargePlanCode) return POWER_PLAN_KEY;
  if (chargePlanCode && config.starter?.planCode === chargePlanCode) return STARTER_PLAN_KEY;
  return null;
}

async function applyVerifiedTransaction(
  transaction,
  userId,
  { planCode, config, existing, eventId, source, checkout = null },
) {
  const shaped = shapeEvent(transaction);
  const reference = String(transaction?.reference || "").trim();
  if (!reference) throw new HttpError(400, "That payment has no reference.");
  const metadata = metadataOf(transaction);
  const chargePlanCode = shaped.plan.plan_code || transaction?.plan_code || checkout?.plan_code || planCode;
  const planKey =
    planKeyForCharge({ metadata, checkout, existing, chargePlanCode, config }) ||
    (await planKeyForCode(chargePlanCode, config)) ||
    LEGACY_PRO_PLAN_KEY;
  if (!validPaidCharge(transaction, { existing, config, planCode, checkout, tier: config.tiers?.[planKey] })) {
    return { applied: false, reason: "not_a_paid_charge" };
  }

  const outcome = await withTransaction(async (client) => {
    const recorded = await recordTransaction(client, {
      reference,
      userId,
      planCode: chargePlanCode,
      subscriptionCode: shaped.subscriptionCode,
      status: String(transaction?.status || "unknown"),
      amount: transaction?.amount,
      currency: transaction?.currency || shaped.plan.currency,
      channel: transaction?.channel,
      paidAt: transaction?.paid_at || transaction?.created_at,
      metadata,
    });

    if (transaction?.status !== "success") return { applied: false, reason: "not_successful" };

    await client.query("update billing_checkouts set status = 'paid', updated_at = now() where reference = $1", [
      reference,
    ]);
    if (!recorded?.needs_apply) return { applied: false, reason: "already_applied" };

    const applied = await saveSubscription(
      {
        userId,
        status: "active",
        planKey,
        planCode: chargePlanCode,
        subscriptionCode: shaped.subscriptionCode,
        emailToken: shaped.emailToken,
        amount: transaction?.amount,
        currency: transaction?.currency || shaped.plan.currency,
        interval: shaped.plan.interval || "monthly",
        customerCode: shaped.customer.customer_code || transaction?.customer_code || null,
        reference,
        nextPaymentAt: shaped.nextPaymentAt,
        startedAt: transaction?.paid_at || transaction?.created_at || null,
        eventAt: dateOrNull(transaction?.paid_at || transaction?.created_at) || new Date(),
        eventId: eventId ?? `paystack:transaction:${reference}`,
        source: source ?? "verify",
      },
      client,
    );
    if (!applied.applied) return { applied: false, reason: applied.reason };

    await client.query(
      "update billing_transactions set applied_at = now(), updated_at = now() where provider = 'paystack' and reference = $1",
      [reference],
    );
    return { applied: true, reason: "", interval: shaped.plan.interval || "monthly", planKey };
  });

  if (outcome.applied) {
    await sendReceipt(userId, {
      amount: transaction?.amount,
      currency: transaction?.currency || shaped.plan.currency,
      reference,
      interval: outcome.interval,
      planKey: outcome.planKey,
    });
  }
  return outcome;
}

async function sendReceipt(userId, receipt) {
  const found = await query("select email, name from users where id = $1 limit 1", [userId]);
  const user = found.rows[0];
  if (!user) return;
  await sendReceiptEmail(user, receipt).catch((error) => {
    console.error("[jotbox-billing] receipt email failed", error instanceof Error ? error.message : error);
  });
}

/**
 * One reminder per billing period. The claim row is written before the send,
 * so an overlapping or retried cron cannot mail the same person twice. A lost
 * network answer keeps the claim on purpose: sending twice is worse than a
 * missed reminder.
 */
export async function sendRenewalReminders({ limit = REMINDER_BATCH } = {}) {
  const batch = Math.max(1, Math.min(100, Number(limit) || REMINDER_BATCH));
  const due = await query(
    `select u.id, u.email, u.name,
            s.amount, s.currency, s.plan_key,
            coalesce(s.current_period_end, s.next_payment_at) as renews_at
       from billing_subscriptions s
       join users u on u.id = s.user_id
      where s.status = 'active'
        and coalesce(s.current_period_end, s.next_payment_at) > now()
        and coalesce(s.current_period_end, s.next_payment_at) <= now() + ($1::int * interval '1 day')
        and not exists (
          select 1 from billing_reminders r
           where r.user_id = s.user_id
             and r.kind = 'renewal'
             and r.period_end = coalesce(s.current_period_end, s.next_payment_at)
        )
      order by coalesce(s.current_period_end, s.next_payment_at) asc
      limit $2`,
    [REMINDER_WINDOW_DAYS, batch],
  );

  let sent = 0;
  let skipped = 0;
  await Promise.all(
    due.rows.map(async (row) => {
      const claimed = await query(
        `insert into billing_reminders (user_id, kind, period_end)
         values ($1, 'renewal', $2)
         on conflict do nothing
         returning user_id`,
        [row.id, row.renews_at],
      );
      if (!claimed.rows[0]) {
        skipped += 1;
        return;
      }
      try {
        const result = await sendRenewalReminderEmail(
          { id: row.id, email: row.email, name: row.name },
          { amount: row.amount, currency: row.currency, nextPaymentAt: row.renews_at, planKey: row.plan_key },
        );
        if (result.delivered) {
          sent += 1;
          return;
        }
        skipped += 1;
        if (result.reason !== "network") {
          await query(
            "delete from billing_reminders where user_id = $1 and kind = 'renewal' and period_end = $2",
            [row.id, row.renews_at],
          ).catch(() => {});
        }
      } catch (error) {
        skipped += 1;
        await query(
          "delete from billing_reminders where user_id = $1 and kind = 'renewal' and period_end = $2",
          [row.id, row.renews_at],
        ).catch(() => {});
        console.warn(
          "[jotbox-billing] renewal reminder failed",
          row.id,
          error instanceof Error ? error.message : error,
        );
      }
    }),
  );
  return { checked: due.rows.length, sent, skipped };
}

async function statusFor(userId, { reconcile = false } = {}) {
  const config = billingConfig();
  let row = await getSubscription(userId);
  // Manual enterprise rows have no Paystack reference; reconciling them would
  // let an unrelated old Paystack subscription overwrite the plan.
  if (reconcile && config.configured && row?.provider !== "manual") {
    await reconcileUser(userId).catch((error) => {
      console.warn("[jotbox-billing] reconcile skipped", error instanceof Error ? error.message : error);
    });
    row = await getSubscription(userId);
  }
  const plan = planOf(row);
  const quota = await quotaUsage(userId);
  return {
    configured: config.configured,
    plan,
    subscription: subscriptionView(row),
    pricing: publicPricing(config),
    usage: quota.usage,
    quota: {
      pooled: quota.pooled,
      orgId: quota.orgId,
      limitSeconds: quota.limitSeconds,
      reservedSeconds: quota.reservedSeconds,
      availableSeconds: quota.availableSeconds,
    },
  };
}

async function status(req, res) {
  const { user } = await requireSession(req);
  sendJson(res, 200, await statusFor(user.id, { reconcile: true }));
}

function checkoutView(row, config) {
  return {
    authorizationUrl: row.authorization_url,
    reference: row.reference,
    planKey: row.plan_key,
    pricing: publicPricing(config),
  };
}

function idempotencyKey(req) {
  const raw = String(req.headers["idempotency-key"] || "").trim();
  if (!raw) return null;
  if (raw.length < 8 || raw.length > 120 || !/^[A-Za-z0-9:_-]+$/.test(raw)) {
    throw new HttpError(400, "That request key is not valid.");
  }
  return raw;
}

async function openCheckout(userId, userEmail, req, key, config, tier = config.starter) {
  // Abandoned attempts must not block a fresh checkout, and a key that already
  // failed is allowed to start again with a new Paystack reference.
  await query(
    `delete from billing_checkouts
      where user_id = $1
        and (status in ('failed', 'expired')
          or (status = 'open' and created_at < now() - interval '30 minutes')
          or (status = 'creating' and created_at < now() - interval '90 seconds'))`,
    [userId],
  );

  if (key) {
    const byKey = await query("select * from billing_checkouts where user_id = $1 and idempotency_key = $2 limit 1", [
      userId,
      key,
    ]);
    const row = byKey.rows[0];
    if (row && row.plan_key === tier.key) {
      if (row.status === "paid") throw new HttpError(409, "You are already on a paid plan. Manage it below.");
      if (row.status === "open" && row.authorization_url) return row;
      if (row.status === "creating" && Date.now() - new Date(row.created_at).getTime() < CHECKOUT_CREATING_MS) {
        throw new HttpError(409, "Your checkout is still being prepared. Try again in a moment.");
      }
    }
  }

  const open = await query(
    `select * from billing_checkouts
      where user_id = $1
        and status in ('creating', 'open')
        and plan_key = $2
        and created_at > now() - interval '30 minutes'
      order by created_at desc
      limit 1`,
    [userId, tier.key],
  );
  const row = open.rows[0];
  if (row) {
    if (row.status === "open" && row.authorization_url) return row;
    throw new HttpError(409, "Your checkout is still being prepared. Try again in a moment.");
  }

  // Only one open checkout can exist per user. Switching tier abandons the
  // unpaid one rather than sending the person to the wrong plan.
  await query(
    `update billing_checkouts
        set status = 'expired', updated_at = now()
      where user_id = $1 and status in ('creating', 'open') and plan_key <> $2`,
    [userId, tier.key],
  );

  const recent = await query(
    "select count(*)::int as count from billing_checkouts where user_id = $1 and created_at > now() - interval '1 hour'",
    [userId],
  );
  if ((recent.rows[0]?.count ?? 0) >= MAX_CHECKOUTS_PER_HOUR) {
    throw new HttpError(429, "That is a lot of checkout attempts. Wait a little, then try again.");
  }

  const planCode = await ensurePlan(config, tier);
  const reference = `jotbox_${randomUUID().replaceAll("-", "")}`;
  let inserted;
  try {
    inserted = await query(
      `insert into billing_checkouts (reference, user_id, idempotency_key, amount, currency, plan_code, plan_key)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [reference, userId, key, tier.amountKobo, config.currency, planCode, tier.key],
    );
  } catch (error) {
    if (error?.code === "23505") {
      const again = await query(
        `select * from billing_checkouts
          where user_id = $1 and status in ('creating', 'open') and plan_key = $2
          order by created_at desc limit 1`,
        [userId, tier.key],
      );
      if (again.rows[0]?.status === "open" && again.rows[0]?.authorization_url) return again.rows[0];
      throw new HttpError(409, "Your checkout is still being prepared. Try again in a moment.");
    }
    throw error;
  }

  let transaction;
  try {
    transaction = await paystack("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: userEmail,
        amount: tier.amountKobo,
        currency: config.currency,
        plan: planCode,
        reference,
        callback_url: `${publicOrigin(req)}/account?billing=callback`,
        metadata: {
          user_id: userId,
          plan_key: tier.key,
          reference,
          source: "jotbox",
        },
      }),
    });
  } catch (error) {
    await query("update billing_checkouts set status = 'failed', updated_at = now() where reference = $1", [reference]);
    throw error;
  }

  if (!transaction?.authorization_url) {
    await query("update billing_checkouts set status = 'failed', updated_at = now() where reference = $1", [reference]);
    throw new HttpError(502, "Paystack did not return a checkout link. Try again.");
  }

  const updated = await query(
    "update billing_checkouts set status = 'open', authorization_url = $2, updated_at = now() where reference = $1 returning *",
    [reference, transaction.authorization_url],
  );
  return updated.rows[0] ?? { ...inserted.rows[0], authorization_url: transaction.authorization_url };
}

async function checkout(req, res) {
  assertSameOrigin(req);
  const { user } = await requireSession(req);
  const body = await readJson(req, 4_000);
  const requested = typeof body?.tier === "string" && body.tier.trim() ? body.tier.trim() : STARTER_PLAN_KEY;
  if (!isPurchasePlan(requested)) throw new HttpError(400, "That plan is not available.");
  const config = billingConfig();
  const tier = tierConfig(config, requested);
  const existing = await getSubscription(user.id);
  if (isEntitled(existing)) {
    throw new HttpError(409, "You are already on a paid plan. Manage it below.");
  }

  const key = idempotencyKey(req);
  const checkoutRow = await openCheckout(user.id, user.email, req, key, config, tier);
  sendJson(res, 200, checkoutView(checkoutRow, config));
}

async function verify(req, res) {
  assertSameOrigin(req);
  const { user } = await requireSession(req);
  const body = await readJson(req, 20_000);
  const reference = typeof body?.reference === "string" ? body.reference.trim() : "";
  if (reference.length < 6 || reference.length > 140) {
    throw new HttpError(400, "That payment reference is not valid.");
  }

  const transaction = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (transaction?.status !== "success") {
    sendJson(res, 200, {
      ...(await statusFor(user.id)),
      payment: transaction?.status || "pending",
    });
    return;
  }

  const metadata = metadataOf(transaction);
  const customer = transaction.customer && typeof transaction.customer === "object" ? transaction.customer : {};
  const emailMatches =
    typeof customer.email === "string" && customer.email.trim().toLowerCase() === user.email.toLowerCase();
  const sameUser = metadata.user_id === user.id || emailMatches;
  if (!sameUser) throw new HttpError(403, "That payment belongs to another account.");

  const config = billingConfig();
  const existing = await getSubscription(user.id);
  const checkout = await getCheckout(reference, user.id);
  const applied = await applyVerifiedTransaction(transaction, user.id, {
    planCode: await knownPlanCode(config, checkout?.plan_key || LEGACY_PRO_PLAN_KEY),
    config,
    existing,
    checkout,
    eventId: `paystack:verify:${reference}`,
    source: "verify",
  });

  if (!applied.applied && applied.reason === "not_a_paid_charge") {
    throw new HttpError(402, "That payment is not a JotBox plan payment, so no plan was switched on.");
  }

  sendJson(res, 200, { ...(await statusFor(user.id)), payment: "success" });
}

async function activePaystackSubscription(row, email) {
  if (row.subscription_code && row.email_token) return row;
  if (!email) return row;

  const list = await paystack(`/subscription?customer=${encodeURIComponent(email)}`);
  const items = Array.isArray(list) ? list : [];
  const match =
    items.find((item) => item?.status !== "cancelled" && item?.plan?.plan_code === row.plan_code) ||
    items.find((item) => item?.status !== "cancelled");
  if (!match) return row;

  return {
    ...row,
    subscription_code: match.subscription_code || row.subscription_code,
    email_token: match.email_token || row.email_token,
    next_payment_at: match.next_payment_date || row.next_payment_at,
  };
}

async function cancel(req, res) {
  assertSameOrigin(req);
  const { user } = await requireSession(req);
  const row = await getSubscription(user.id);
  if (!row || !isEntitled(row)) throw new HttpError(409, "You are not on a paid plan.");
  if (row.status === "cancelled" || row.status === "non-renewing") {
    sendJson(res, 200, await statusFor(user.id));
    return;
  }

  const active = await activePaystackSubscription(row, user.email);
  if (!active.subscription_code || !active.email_token) {
    throw new HttpError(409, "Your subscription is still being set up. Try again in a minute.");
  }

  await paystack("/subscription/disable", {
    method: "POST",
    body: JSON.stringify({ code: active.subscription_code, token: active.email_token }),
  });

  await saveSubscription({
    userId: user.id,
    status: "cancelled",
    planKey: row.plan_key,
    subscriptionCode: active.subscription_code,
    emailToken: active.email_token,
    planCode: active.plan_code,
    amount: active.amount,
    currency: active.currency,
    interval: active.interval,
    customerCode: active.customer_code,
    reference: active.reference,
    nextPaymentAt: active.current_period_end || active.next_payment_at,
    startedAt: active.started_at,
    eventAt: new Date(),
    eventId: `jotbox:cancel:${randomUUID()}`,
    source: "cancel",
  });

  await sendCancellationEmail(user, {
    periodEnd: active.current_period_end || active.next_payment_at,
    planKey: row.plan_key,
  }).catch((error) => {
    console.error("[jotbox-billing] cancellation email failed", error instanceof Error ? error.message : error);
  });

  sendJson(res, 200, await statusFor(user.id));
}

/**
 * Money events are ordered by when the money moved. Subscription lifecycle
 * events carry the subscription's original created_at, which can be months
 * old, so their ordering must come from updated_at instead.
 */
export function eventTime(event, data) {
  const money = event === "charge.success" || event.startsWith("invoice.");
  if (money) {
    return (
      dateOrNull(
        data?.paid_at ||
          data?.transaction?.paid_at ||
          data?.created_at ||
          data?.updated_at ||
          data?.transaction?.created_at,
      ) || new Date()
    );
  }
  return (
    dateOrNull(
      data?.updated_at ||
        data?.subscription?.updated_at ||
        data?.created_at ||
        data?.subscription?.created_at,
    ) || new Date()
  );
}

function planStatus(value) {
  return ["active", "attention", "non-renewing", "cancelled", "completed"].includes(value) ? value : null;
}

/**
 * Reconcile local state with Paystack. This is the repair path when a webhook
 * is lost or a browser return dies mid-flight. A user with no subscription row
 * can still have a paid checkout, so those references are checked too.
 */
async function reconcileUser(userId, { force = false } = {}) {
  const config = billingConfig();
  if (!config.configured) return getSubscription(userId);

  const existing = await getSubscription(userId);
  const checkouts = await recentCheckouts(userId);
  if (!existing && !checkouts.length && !force) return null;
  const last = existing?.last_reconciled_at ? new Date(existing.last_reconciled_at).getTime() : 0;
  if (!force && existing && last && Date.now() - last < RECONCILE_AFTER_MS) return existing;

  const planCode = await knownPlanCode(config);
  const checkoutByReference = new Map(checkouts.map((row) => [row.reference, row]));
  const references = [...new Set([existing?.reference, ...checkouts.map((row) => row.reference)].filter(Boolean))];
  let verifiedReference = null;

  for (const reference of references) {
    try {
      const transaction = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`, {}, 3000);
      if (transaction?.status !== "success") continue;
      const applied = await applyVerifiedTransaction(transaction, userId, {
        planCode,
        config,
        existing: existing ?? null,
        checkout: checkoutByReference.get(reference) ?? null,
        eventId: `paystack:reconcile:${reference}`,
        source: "reconcile",
      });
      verifiedReference = reference;
      if (applied.applied) break;
    } catch {
      // A failed transaction check is retried on the next reconcile.
    }
  }

  const userResult = await query("select email from users where id = $1 limit 1", [userId]);
  const email = userResult.rows[0]?.email;
  const current = await getSubscription(userId);
  let remote = null;
  if (current?.subscription_code) {
    try {
      remote = await paystack(`/subscription/${encodeURIComponent(current.subscription_code)}`, {}, 3000);
    } catch {
      remote = null;
    }
  }
  if (!remote && email) {
    try {
      const list = await paystack(`/subscription?customer=${encodeURIComponent(email)}`, {}, 3000);
      const items = Array.isArray(list) ? list : [];
      remote =
        items.find((item) => item?.plan?.plan_code && item.plan.plan_code === (current?.plan_code || planCode)) ||
        items.find((item) => item?.status === "active") ||
        items[0] ||
        null;
    } catch {
      remote = null;
    }
  }

  if (remote) {
    const status = planStatus(remote.status);
    if (status) {
      const remotePlanKey =
        (await planKeyForCode(remote.plan?.plan_code, config)) || current?.plan_key || LEGACY_PRO_PLAN_KEY;
      await saveSubscription({
        userId,
        status,
        planKey: remotePlanKey,
        planCode: remote.plan?.plan_code || current?.plan_code || planCode,
        subscriptionCode: remote.subscription_code || current?.subscription_code,
        emailToken: remote.email_token || current?.email_token,
        amount: remote.plan?.amount ?? remote.amount ?? current?.amount,
        currency: remote.plan?.currency || remote.currency || current?.currency,
        interval: remote.plan?.interval || current?.interval || "monthly",
        customerCode: remote.customer?.customer_code || current?.customer_code,
        reference: current?.reference || verifiedReference,
        nextPaymentAt: remote.next_payment_date || current?.next_payment_at,
        startedAt: remote.createdAt || remote.created_at || current?.started_at,
        eventAt: new Date(),
        eventId: `jotbox:reconcile:${remote.subscription_code || userId}:${status}`,
        source: "reconcile",
      });
    }
  }

  await query("update billing_subscriptions set last_reconciled_at = now() where user_id = $1", [userId]);
  return getSubscription(userId);
}

async function reconcile(req, res) {
  const secret = process.env.CRON_SECRET?.trim();
  const url = new URL(req.url || "/", "http://localhost");
  const auth = String(req.headers.authorization || "");
  const fromVercel = Boolean(secret) && (auth === `Bearer ${secret}` || url.searchParams.get("secret") === secret);

  if (!fromVercel) {
    assertSameOrigin(req);
    const { user } = await requireSession(req);
    await reconcileUser(user.id, { force: true });
    sendJson(res, 200, await statusFor(user.id));
    return;
  }

  const rows = await query(
    `with candidates as (
       select user_id, last_reconciled_at as seen_at
         from billing_subscriptions
       union all
       select user_id, null as seen_at
         from billing_checkouts
        where status in ('open', 'creating', 'paid')
          and created_at > now() - interval '7 days'
     )
     select user_id, max(seen_at) as last_reconciled_at
       from candidates
      group by user_id
     having max(seen_at) is null or max(seen_at) < now() - interval '1 hour'
      order by max(seen_at) nulls first
      limit 5`,
  );
  let done = 0;
  let failed = 0;
  for (const row of rows.rows) {
    try {
      await reconcileUser(row.user_id, { force: true });
      done += 1;
    } catch (error) {
      failed += 1;
      console.warn(
        "[jotbox-billing] cron reconcile failed",
        row.user_id,
        error instanceof Error ? error.message : error,
      );
    }
  }

  let reminders = { checked: 0, sent: 0, skipped: 0 };
  try {
    reminders = await sendRenewalReminders();
  } catch (error) {
    console.warn(
      "[jotbox-billing] renewal reminders failed",
      error instanceof Error ? error.message : error,
    );
    reminders = { checked: 0, sent: 0, skipped: 0, failed: true };
  }
  const [reservations, jobs, audio] = await Promise.all([
    sweepReservations().catch((error) => {
      console.warn("[jotbox-billing] reservation sweep failed", error instanceof Error ? error.message : error);
      return 0;
    }),
    sweepJobs().catch((error) => {
      console.warn("[jotbox-billing] job sweep failed", error instanceof Error ? error.message : error);
      return 0;
    }),
    sweepExpiredAudio().catch((error) => {
      console.warn("[jotbox-billing] audio sweep failed", error instanceof Error ? error.message : error);
      return { deleted: 0, checked: 0 };
    }),
  ]);
  sendJson(res, 200, { received: true, reconciled: done, failed, reminders, reservations, jobs, audio });
}

async function applyEvent(event, data, { planCode, config, eventId, eventAt }) {
  const shaped = shapeEvent(data);
  const metadata = metadataOf(data)?.user_id ? metadataOf(data) : metadataOf(shaped.subscription);
  const userId = await resolveUserId({
    metadata,
    customer: shaped.customer,
    subscriptionCode: shaped.subscriptionCode,
  });
  if (!userId) return { applied: false, reason: "unknown_user", userId: null };

  const existing = await getSubscription(userId);
  const eventChargeCode = shaped.plan.plan_code || data?.plan_code || null;
  const localCode = existing?.plan_code || planCode;
  const isSubscriptionEvent = event.startsWith("subscription.");
  const isMoneyEvent = event === "charge.success" || event.startsWith("invoice.");
  const checkout = isMoneyEvent && data?.reference ? await getCheckout(data.reference, userId) : null;

  const codePlanKey = await planKeyForCode(eventChargeCode, config);
  if (eventChargeCode && localCode && eventChargeCode !== localCode && !codePlanKey) {
    return { applied: false, reason: "different_plan", userId };
  }
  const planKey =
    planKeyForCharge({ metadata, checkout, existing, chargePlanCode: eventChargeCode, config }) ||
    codePlanKey ||
    LEGACY_PRO_PLAN_KEY;

  if (isMoneyEvent) {
    const hasAmount = numberOrNull(data?.amount ?? shaped.plan.amount) !== null;
    if (hasAmount) {
      if (!validPaidCharge(data, { existing, config, planCode, checkout, tier: config.tiers?.[planKey] })) {
        return { applied: false, reason: "not_a_paid_charge", userId };
      }
    } else if (!existing) {
      return { applied: false, reason: "missing_amount", userId };
    }
  }

  if (isSubscriptionEvent && !eventChargeCode && !existing && !shaped.subscriptionCode) {
    return { applied: false, reason: "missing_plan", userId };
  }

  let status = statusFromEvent(event);
  if (event === "invoice.update") {
    const chargeStatus = data?.transaction?.status;
    const paid = data?.paid === true || data?.status === "success" || chargeStatus === "success";
    const failed = data?.paid === false || data?.status === "failed" || chargeStatus === "failed";
    if (!paid && !failed) return { applied: false, reason: "not_final", userId };
    status = paid ? "active" : "attention";
  }
  if (!status) return { applied: false, reason: "unhandled_event", userId };

  const result = await saveSubscription({
    userId,
    status,
    planKey,
    planCode: eventChargeCode || checkout?.plan_code || existing?.plan_code || planCode,
    subscriptionCode: shaped.subscriptionCode,
    emailToken: shaped.emailToken,
    amount: data?.amount ?? shaped.plan.amount ?? existing?.amount,
    currency: data?.currency || shaped.plan.currency || existing?.currency,
    interval: shaped.plan.interval || data?.interval || existing?.interval,
    customerCode: shaped.customer.customer_code || data?.customer_code || null,
    reference: data?.reference || existing?.reference || null,
    nextPaymentAt: shaped.nextPaymentAt || (status === "active" ? existing?.next_payment_at : null),
    startedAt: data?.created_at || data?.paid_at || existing?.started_at,
    eventAt,
    eventId,
    source: "webhook",
  });

  // A valid charge is money on file even when a later cancellation wins the
  // ordering and blocks entitlement. Record it, but only mark it applied when
  // the subscription actually moved.
  if (event === "charge.success" && data?.reference && data?.status === "success") {
    await withTransaction(async (client) => {
      await recordTransaction(client, {
        reference: data.reference,
        userId,
        planCode: eventChargeCode || checkout?.plan_code || existing?.plan_code || planCode,
        subscriptionCode: shaped.subscriptionCode,
        status: "success",
        amount: data.amount,
        currency: data.currency || shaped.plan.currency,
        channel: data.channel,
        paidAt: data.paid_at || data.created_at,
        metadata: metadataOf(data),
      });
      if (result.applied) {
        await client.query(
          "update billing_transactions set applied_at = coalesce(applied_at, now()), updated_at = now() where provider = 'paystack' and reference = $1",
          [data.reference],
        );
      }
      await client.query("update billing_checkouts set status = 'paid', updated_at = now() where reference = $1", [
        data.reference,
      ]);
    });
    if (result.applied) {
      await sendReceipt(userId, {
        amount: data.amount,
        currency: data.currency || shaped.plan.currency,
        reference: data.reference,
        interval: shaped.plan.interval || data.interval || "monthly",
      });
    }
  }

  return result;
}

export function verifyWebhookSignature(raw, signature, secret) {
  if (!raw || !signature || !secret) return false;
  const expected = createHmac("sha512", secret).update(raw).digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(String(signature).trim().toLowerCase(), "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readRawBody(req, limit = 1_000_000) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body instanceof Uint8Array) return Buffer.from(req.body);
  if (typeof req.body === "string") return Buffer.from(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "That webhook is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function webhook(req, res) {
  const secret = requirePaystack();
  const raw = await readRawBody(req);
  const signature = req.headers["x-paystack-signature"];
  if (!verifyWebhookSignature(raw, signature, secret)) {
    throw new HttpError(401, "That webhook signature is not valid.");
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "That webhook body is not valid JSON.");
  }

  const event = String(payload?.event || "");
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  if (!event) throw new HttpError(400, "That webhook has no event name.");

  const fallback = createHash("sha256").update(raw).digest("hex").slice(0, 40);
  const providerId =
    data.id ??
    data.reference ??
    data.subscription_code ??
    data.subscription?.subscription_code ??
    data.customer?.customer_code;
  const state = data.status || (data.paid === true ? "paid" : data.paid === false ? "unpaid" : "");
  const eventId = `paystack:${event}:${providerId ?? fallback}:${state}`;
  const eventAt = eventTime(event, data);

  const stored = await query(
    `insert into billing_events (id, provider, event, reference, payload, event_at)
     values ($1, 'paystack', $2, $3, $4::jsonb, $5)
     on conflict (id) do nothing
     returning id`,
    [eventId, event, data.reference || data.subscription_code || null, JSON.stringify(payload), eventAt],
  );
  if (!stored.rows[0]) {
    sendJson(res, 200, { received: true, duplicate: true });
    return;
  }

  try {
    const config = billingConfig();
    const result = await applyEvent(event, data, {
      planCode: await knownPlanCode(config),
      config,
      eventId,
      eventAt,
    });
    await query("update billing_events set user_id = $2, applied = $3, ignored_reason = $4 where id = $1", [
      eventId,
      result.userId ?? null,
      result.applied,
      result.reason || null,
    ]);
  } catch (error) {
    // Let Paystack retry this event instead of treating a half-applied event as complete.
    await query("delete from billing_events where id = $1", [eventId]).catch(() => {});
    throw error;
  }

  if (Math.random() < 0.05) {
    await query("delete from billing_events where created_at < now() - interval '90 days'");
  }
  sendJson(res, 200, { received: true });
}

export async function handleBilling(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  const action = url.searchParams.get("action") || "";

  if (req.method === "GET") {
    if (action === "reconcile") {
      await reconcile(req, res);
      return;
    }
    await status(req, res);
    return;
  }

  if (req.method === "POST") {
    if (req.headers["x-paystack-signature"]) {
      await webhook(req, res);
      return;
    }
    if (action === "checkout") {
      await checkout(req, res);
      return;
    }
    if (action === "verify") {
      await verify(req, res);
      return;
    }
    if (action === "cancel") {
      await cancel(req, res);
      return;
    }
    throw new HttpError(404, "That billing action was not found.");
  }

  requireMethod(req, ["GET", "POST"]);
}
