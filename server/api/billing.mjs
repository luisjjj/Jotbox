import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getPool, query } from "./pg.mjs";
import { requireSession } from "./auth.mjs";
import { usageView } from "./usage.mjs";
import {
  HttpError,
  assertSameOrigin,
  readJson,
  requireMethod,
  sendJson,
} from "./http.mjs";

/**
 * Paystack subscriptions.
 *
 * Pro is priced in US dollars on the site but charged in Naira, because a
 * Paystack plan is tied to one currency. The Naira amount is set with
 * PAYSTACK_PRO_AMOUNT_NGN, or converted from $7 with JOTBOX_USD_TO_NGN.
 *
 * Money is only trusted after Paystack confirms it. The browser return and the
 * webhook both write through the same reference-first ledger, so a retry or a
 * second browser tab cannot buy a second month, and a webhook cannot extend a
 * plan past the period Paystack says was paid for.
 */

const PAYSTACK_API = "https://api.paystack.co";
const PRO_PRICE_USD = 7;
const DEFAULT_NGN_PER_USD = 1600;
const PRO_PLAN_KEY = "pro";
const PAYSTACK_TIMEOUT_MS = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECKOUT_CREATING_MS = 90 * 1000;
const MAX_CHECKOUTS_PER_HOUR = 12;
const MAX_PERIOD_DAYS = 32;
const ACTIVE_GRACE_DAYS = 1;
const ATTENTION_GRACE_DAYS = 2;
const RECONCILE_AFTER_MS = 10 * 60 * 1000;
const MIN_PRO_AMOUNT_KOBO = 100_00;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function billingConfig(env = process.env) {
  const ngnPerUsd = Math.round(positiveNumber(env.JOTBOX_USD_TO_NGN, DEFAULT_NGN_PER_USD));
  const naira = Math.round(positiveNumber(env.PAYSTACK_PRO_AMOUNT_NGN, PRO_PRICE_USD * ngnPerUsd));
  return {
    currency: "NGN",
    interval: "monthly",
    usd: PRO_PRICE_USD,
    ngnPerUsd,
    naira,
    amountKobo: naira * 100,
    configured: Boolean(env.PAYSTACK_SECRET_KEY?.trim()),
    planCode: env.PAYSTACK_PLAN_CODE?.trim() || "",
  };
}

function publicPricing(config = billingConfig()) {
  return {
    usd: config.usd,
    naira: config.naira,
    ngnPerUsd: config.ngnPerUsd,
    currency: config.currency,
    interval: config.interval,
  };
}

function requirePaystack() {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret) throw new HttpError(503, "Payments are not switched on yet.");
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
    throw new HttpError(502, body?.message || "Paystack could not complete that. Try again.");
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

async function ensurePlan(config) {
  if (config.planCode) return config.planCode;

  const cached = await query(
    `select code, currency, amount, interval
       from billing_plans
      where provider = 'paystack' and plan_key = $1
      limit 1`,
    [PRO_PLAN_KEY],
  );
  const row = cached.rows[0];
  if (
    row &&
    row.currency === config.currency &&
    Number(row.amount) === config.amountKobo &&
    row.interval === config.interval
  ) {
    return row.code;
  }

  const plan = await paystack("/plan", {
    method: "POST",
    body: JSON.stringify({
      name: `JotBox Pro ${config.currency} ${config.naira} monthly`,
      interval: config.interval,
      amount: config.amountKobo,
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
    [PRO_PLAN_KEY, code, config.currency, config.amountKobo, config.interval],
  );
  return code;
}

async function knownPlanCode(config) {
  if (config.planCode) return config.planCode;
  const cached = await query(
    "select code from billing_plans where provider = 'paystack' and plan_key = $1 limit 1",
    [PRO_PLAN_KEY],
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
         set plan_key = excluded.plan_key,
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
        PRO_PLAN_KEY,
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
 * A charge may only grant Pro when it is a Naira payment at the agreed price
 * for our plan. Being signed in, or holding a valid reference for a cheaper
 * transaction, is not enough.
 */
function validProCharge(data, { existing, config, planCode }) {
  const shaped = shapeEvent(data);
  const chargeCode = shaped.plan.plan_code || data?.plan_code || null;
  const ourCode = existing?.plan_code || planCode;
  if (chargeCode && ourCode && chargeCode !== ourCode) return false;

  const metadata = metadataOf(data);
  if (metadata.plan_key && metadata.plan_key !== PRO_PLAN_KEY) return false;
  const hasProEvidence =
    Boolean(existing) ||
    metadata.plan_key === PRO_PLAN_KEY ||
    Boolean(chargeCode && (!ourCode || chargeCode === ourCode));
  if (!hasProEvidence) return false;

  const currency = currencyOf(data?.currency || shaped.plan.currency);
  if (currency !== "NGN") return false;

  const amount = numberOrNull(data?.amount ?? shaped.plan.amount);
  if (amount === null) return false;
  const expected = existing?.amount > 0 ? Number(existing.amount) : config.amountKobo;
  return amount >= Math.max(MIN_PRO_AMOUNT_KOBO, Math.floor(expected * 0.9));
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

async function applyVerifiedTransaction(transaction, userId, { planCode, config, existing, eventId, source }) {
  const shaped = shapeEvent(transaction);
  const reference = String(transaction?.reference || "").trim();
  if (!reference) throw new HttpError(400, "That payment has no reference.");
  if (!validProCharge(transaction, { existing, config, planCode })) {
    return { applied: false, reason: "not_a_pro_charge" };
  }

  return withTransaction(async (client) => {
    const recorded = await recordTransaction(client, {
      reference,
      userId,
      planCode: shaped.plan.plan_code || transaction?.plan_code || planCode,
      subscriptionCode: shaped.subscriptionCode,
      status: String(transaction?.status || "unknown"),
      amount: transaction?.amount,
      currency: transaction?.currency || shaped.plan.currency,
      channel: transaction?.channel,
      paidAt: transaction?.paid_at || transaction?.created_at,
      metadata: metadataOf(transaction),
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
        planCode: shaped.plan.plan_code || transaction?.plan_code || planCode,
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
    return { applied: true, reason: "" };
  });
}

async function statusFor(userId, { reconcile = false } = {}) {
  const config = billingConfig();
  if (reconcile && config.configured) {
    await reconcileUser(userId).catch((error) => {
      console.warn("[jotbox-billing] reconcile skipped", error instanceof Error ? error.message : error);
    });
  }
  const row = await getSubscription(userId);
  const pro = isEntitled(row);
  return {
    configured: config.configured,
    plan: pro ? "pro" : "free",
    subscription: subscriptionView(row),
    pricing: publicPricing(config),
    usage: await usageView(userId, { unlimited: pro }),
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

async function openCheckout(userId, userEmail, req, key, config) {
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
    if (row) {
      if (row.status === "paid") throw new HttpError(409, "You are already on Pro. Manage your plan below.");
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
        and created_at > now() - interval '30 minutes'
      order by created_at desc
      limit 1`,
    [userId],
  );
  const row = open.rows[0];
  if (row) {
    if (row.status === "open" && row.authorization_url) return row;
    throw new HttpError(409, "Your checkout is still being prepared. Try again in a moment.");
  }

  const recent = await query(
    "select count(*)::int as count from billing_checkouts where user_id = $1 and created_at > now() - interval '1 hour'",
    [userId],
  );
  if ((recent.rows[0]?.count ?? 0) >= MAX_CHECKOUTS_PER_HOUR) {
    throw new HttpError(429, "That is a lot of checkout attempts. Wait a little, then try again.");
  }

  const planCode = await ensurePlan(config);
  const reference = `jotbox_${randomUUID().replaceAll("-", "")}`;
  let inserted;
  try {
    inserted = await query(
      `insert into billing_checkouts (reference, user_id, idempotency_key, amount, currency, plan_code)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [reference, userId, key, config.amountKobo, config.currency, planCode],
    );
  } catch (error) {
    if (error?.code === "23505") {
      const again = await query(
        `select * from billing_checkouts
          where user_id = $1 and status in ('creating', 'open')
          order by created_at desc limit 1`,
        [userId],
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
        amount: config.amountKobo,
        currency: config.currency,
        plan: planCode,
        reference,
        callback_url: `${publicOrigin(req)}/account?billing=callback`,
        metadata: {
          user_id: userId,
          plan_key: PRO_PLAN_KEY,
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
  const config = billingConfig();
  const existing = await getSubscription(user.id);
  if (isEntitled(existing)) {
    throw new HttpError(409, "You are already on Pro. Manage your plan below.");
  }

  const key = idempotencyKey(req);
  const checkoutRow = await openCheckout(user.id, user.email, req, key, config);
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
  const applied = await applyVerifiedTransaction(transaction, user.id, {
    planCode: await knownPlanCode(config),
    config,
    existing,
    eventId: `paystack:verify:${reference}`,
    source: "verify",
  });

  if (!applied.applied && applied.reason === "not_a_pro_charge") {
    throw new HttpError(402, "That payment is not a JotBox Pro payment, so Pro was not switched on.");
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

  sendJson(res, 200, await statusFor(user.id));
}

function transactionEventAt(data) {
  return (
    dateOrNull(data?.paid_at || data?.created_at || data?.updated_at || data?.transaction?.paid_at) || new Date()
  );
}

function planStatus(value) {
  return ["active", "attention", "non-renewing", "cancelled", "completed"].includes(value) ? value : null;
}

/**
 * Reconcile local state with Paystack. This is the repair path when a webhook
 * is lost or a browser return dies mid-flight.
 */
async function reconcileUser(userId, { force = false } = {}) {
  const config = billingConfig();
  if (!config.configured) return getSubscription(userId);

  const existing = await getSubscription(userId);
  if (!existing && !force) return null;
  const last = existing?.last_reconciled_at ? new Date(existing.last_reconciled_at).getTime() : 0;
  if (!force && last && Date.now() - last < RECONCILE_AFTER_MS) return existing;

  const userResult = await query("select email from users where id = $1 limit 1", [userId]);
  const email = userResult.rows[0]?.email;
  const planCode = await knownPlanCode(config);

  let remote = null;
  if (existing?.subscription_code) {
    try {
      remote = await paystack(`/subscription/${encodeURIComponent(existing.subscription_code)}`, {}, 3000);
    } catch {
      remote = null;
    }
  }
  if (!remote && email) {
    try {
      const list = await paystack(`/subscription?customer=${encodeURIComponent(email)}`, {}, 3000);
      const items = Array.isArray(list) ? list : [];
      remote =
        items.find((item) => item?.plan?.plan_code && item.plan.plan_code === (planCode || existing?.plan_code)) ||
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
      await saveSubscription({
        userId,
        status,
        planCode: remote.plan?.plan_code || existing?.plan_code || planCode,
        subscriptionCode: remote.subscription_code || existing?.subscription_code,
        emailToken: remote.email_token || existing?.email_token,
        amount: remote.plan?.amount ?? remote.amount ?? existing?.amount,
        currency: remote.plan?.currency || remote.currency || existing?.currency,
        interval: remote.plan?.interval || existing?.interval || "monthly",
        customerCode: remote.customer?.customer_code || existing?.customer_code,
        reference: existing?.reference,
        nextPaymentAt: remote.next_payment_date || existing?.next_payment_at,
        startedAt: remote.createdAt || remote.created_at || existing?.started_at,
        eventAt: new Date(),
        eventId: `jotbox:reconcile:${remote.subscription_code || userId}:${status}`,
        source: "reconcile",
      });
    }
  }

  if (existing?.reference) {
    try {
      const transaction = await paystack(`/transaction/verify/${encodeURIComponent(existing.reference)}`, {}, 3000);
      if (transaction?.status === "success") {
        await applyVerifiedTransaction(transaction, userId, {
          planCode,
          config,
          existing,
          eventId: `paystack:reconcile:${existing.reference}`,
          source: "reconcile",
        });
      }
    } catch {
      // The subscription check above is enough. A failed transaction check will
      // be retried on the next reconcile.
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
    `select user_id from billing_subscriptions
      where last_reconciled_at is null or last_reconciled_at < now() - interval '1 hour'
      order by last_reconciled_at nulls first
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
  sendJson(res, 200, { received: true, reconciled: done, failed });
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

  if (eventChargeCode && localCode && eventChargeCode !== localCode) {
    return { applied: false, reason: "different_plan", userId };
  }

  if (isMoneyEvent) {
    const hasAmount = numberOrNull(data?.amount ?? shaped.plan.amount) !== null;
    if (hasAmount) {
      if (!validProCharge(data, { existing, config, planCode })) {
        return { applied: false, reason: "not_a_pro_charge", userId };
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
    planCode: eventChargeCode || existing?.plan_code || planCode,
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

  if (event === "charge.success" && data?.reference && data?.status === "success" && result.applied) {
    await withTransaction(async (client) => {
      await recordTransaction(client, {
        reference: data.reference,
        userId,
        planCode: eventChargeCode || existing?.plan_code || planCode,
        subscriptionCode: shaped.subscriptionCode,
        status: "success",
        amount: data.amount,
        currency: data.currency || shaped.plan.currency,
        channel: data.channel,
        paidAt: data.paid_at || data.created_at,
        metadata: metadataOf(data),
      });
      await client.query(
        "update billing_transactions set applied_at = coalesce(applied_at, now()), updated_at = now() where provider = 'paystack' and reference = $1",
        [data.reference],
      );
      await client.query("update billing_checkouts set status = 'paid', updated_at = now() where reference = $1", [
        data.reference,
      ]);
    });
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
  const eventAt = transactionEventAt(data);

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
