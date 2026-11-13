import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { query } from "./pg.mjs";
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
 */

const PAYSTACK_API = "https://api.paystack.co";
const PRO_PRICE_USD = 7;
const DEFAULT_NGN_PER_USD = 1600;
const PRO_PLAN_KEY = "pro";
const PAYSTACK_TIMEOUT_MS = 20_000;

const ENTITLED = new Set(["active", "attention", "non-renewing"]);

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

async function paystack(path, init = {}) {
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
      signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS),
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
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || (req.socket?.encrypted ? "https" : "http");
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

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

export function isEntitled(row, now = Date.now()) {
  if (!row) return false;
  if (ENTITLED.has(row.status)) return true;
  if (row.status === "cancelled" && row.next_payment_at) {
    const end = new Date(row.next_payment_at).getTime();
    return Number.isFinite(end) && end > now;
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
    startedAt: row.started_at ? new Date(row.started_at).getTime() : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).getTime() : null,
  };
}

async function getSubscription(userId) {
  const result = await query("select * from billing_subscriptions where user_id = $1 limit 1", [userId]);
  return result.rows[0] ?? null;
}

export async function isProUser(userId) {
  return isEntitled(await getSubscription(userId));
}

async function statusFor(userId) {
  const config = billingConfig();
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
  sendJson(res, 200, await statusFor(user.id));
}

async function checkout(req, res) {
  assertSameOrigin(req);
  const { user } = await requireSession(req);
  const config = billingConfig();
  const existing = await getSubscription(user.id);
  if (isEntitled(existing)) {
    throw new HttpError(409, "You are already on Pro. Manage your plan below.");
  }

  const planCode = await ensurePlan(config);
  const callbackUrl = `${publicOrigin(req)}/account?billing=callback`;
  const transaction = await paystack("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: user.email,
      amount: config.amountKobo,
      currency: config.currency,
      plan: planCode,
      callback_url: callbackUrl,
      metadata: {
        user_id: user.id,
        plan_key: PRO_PLAN_KEY,
        source: "jotbox",
      },
    }),
  });

  if (!transaction?.authorization_url) {
    throw new HttpError(502, "Paystack did not return a checkout link. Try again.");
  }
  sendJson(res, 200, {
    authorizationUrl: transaction.authorization_url,
    reference: transaction.reference,
    pricing: publicPricing(config),
  });
}

async function saveSubscription(input) {
  const now = new Date();
  const result = await query(
    `insert into billing_subscriptions
       (user_id, provider, plan_key, plan_code, subscription_code, email_token, status,
        currency, amount, interval, customer_code, reference, next_payment_at, started_at, cancelled_at)
     values ($1, 'paystack', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, coalesce($13, now()), $14)
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
           next_payment_at = coalesce(excluded.next_payment_at, billing_subscriptions.next_payment_at),
           cancelled_at = excluded.cancelled_at,
           updated_at = now()
     returning *`,
    [
      input.userId,
      PRO_PLAN_KEY,
      input.planCode ?? null,
      input.subscriptionCode ?? null,
      input.emailToken ?? null,
      input.status,
      input.currency || "NGN",
      numberOrNull(input.amount) ?? 0,
      input.interval || "monthly",
      input.customerCode ?? null,
      input.reference ?? null,
      dateOrNull(input.nextPaymentAt),
      dateOrNull(input.startedAt),
      input.status === "cancelled" ? now : null,
    ],
  );
  return result.rows[0] ?? null;
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
  if (typeof candidate === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)) {
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

async function applyEvent(event, data) {
  const shaped = shapeEvent(data);
  const metadata = metadataOf(data)?.user_id ? metadataOf(data) : metadataOf(shaped.subscription);
  const userId = await resolveUserId({
    metadata,
    customer: shaped.customer,
    subscriptionCode: shaped.subscriptionCode,
  });
  if (!userId) {
    console.warn("[jotbox-billing] webhook could not find a user", event, shaped.subscriptionCode);
    return;
  }

  const base = {
    userId,
    planCode: shaped.plan.plan_code || data?.plan_code || null,
    subscriptionCode: shaped.subscriptionCode,
    emailToken: shaped.emailToken,
    amount: shaped.plan.amount ?? data?.amount,
    currency: shaped.plan.currency || data?.currency,
    interval: shaped.plan.interval || data?.interval,
    customerCode: shaped.customer.customer_code || data?.customer_code || null,
    reference: data?.reference || null,
    nextPaymentAt: shaped.nextPaymentAt,
    startedAt: data?.created_at || data?.paid_at || null,
  };

  if (event === "subscription.create") {
    await saveSubscription({ ...base, status: "active" });
    return;
  }
  if (event === "subscription.not_renew") {
    await saveSubscription({ ...base, status: "non-renewing" });
    return;
  }
  if (event === "subscription.disable") {
    await saveSubscription({ ...base, status: "cancelled" });
    return;
  }
  if (event === "subscription.enable") {
    await saveSubscription({ ...base, status: "active" });
    return;
  }
  if (event === "charge.success") {
    const looksLikePro =
      shaped.plan.plan_code ||
      data?.plan_code ||
      shaped.subscriptionCode ||
      metadata?.plan_key === PRO_PLAN_KEY;
    if (!looksLikePro) {
      const existing = await getSubscription(userId);
      if (!existing) return;
    }
    await saveSubscription({ ...base, status: "active" });
    return;
  }
  if (event === "invoice.payment_failed") {
    await saveSubscription({ ...base, status: "attention" });
    return;
  }
  if (event === "invoice.update") {
    const chargeStatus = data?.transaction?.status;
    const paid = data?.paid === true || data?.status === "success" || chargeStatus === "success";
    const failed = data?.paid === false || data?.status === "failed" || chargeStatus === "failed";
    if (!paid && !failed) return;
    await saveSubscription({ ...base, status: paid ? "active" : "attention" });
  }
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
  const state = data.status || (data.paid === true ? "paid" : data.paid === false ? "unpaid" : "");
  const eventId = `paystack:${event}:${data.id ?? data.reference ?? data.subscription_code ?? fallback}:${state}`;

  const stored = await query(
    `insert into billing_events (id, provider, event, reference, payload)
     values ($1, 'paystack', $2, $3, $4::jsonb)
     on conflict (id) do nothing
     returning id`,
    [eventId, event, data.reference || data.subscription_code || null, JSON.stringify(payload)],
  );
  if (!stored.rows[0]) {
    sendJson(res, 200, { received: true, duplicate: true });
    return;
  }

  try {
    await applyEvent(event, data);
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

  const plan = transaction.plan && typeof transaction.plan === "object" ? transaction.plan : {};
  const subscription = transaction.subscription && typeof transaction.subscription === "object" ? transaction.subscription : {};
  await saveSubscription({
    userId: user.id,
    status: "active",
    planCode: plan.plan_code || metadata.plan_code || null,
    subscriptionCode: subscription.subscription_code || null,
    emailToken: subscription.email_token || null,
    amount: transaction.amount,
    currency: transaction.currency,
    interval: plan.interval || "monthly",
    customerCode: customer.customer_code || null,
    reference: transaction.reference || reference,
    nextPaymentAt: subscription.next_payment_date || null,
    startedAt: transaction.paid_at || transaction.created_at || null,
  });

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

  const merged = {
    ...row,
    subscription_code: match.subscription_code || row.subscription_code,
    email_token: match.email_token || row.email_token,
    next_payment_at: match.next_payment_date || row.next_payment_at,
  };
  await query(
    `update billing_subscriptions
        set subscription_code = $2,
            email_token = $3,
            next_payment_at = coalesce($4, next_payment_at)
      where user_id = $1`,
    [row.user_id, merged.subscription_code, merged.email_token, dateOrNull(merged.next_payment_at)],
  );
  return merged;
}

async function cancel(req, res) {
  assertSameOrigin(req);
  const { user } = await requireSession(req);
  const row = await getSubscription(user.id);
  if (!row || !isEntitled(row)) throw new HttpError(409, "You are not on a paid plan.");
  if (row.status === "cancelled" || row.status === "non-renewing") {
    throw new HttpError(409, "This plan is already set to end.");
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
    nextPaymentAt: active.next_payment_at,
    startedAt: active.started_at,
  });

  sendJson(res, 200, await statusFor(user.id));
}

export async function handleBilling(req, res) {
  if (req.method === "GET") {
    await status(req, res);
    return;
  }

  if (req.method === "POST") {
    if (req.headers["x-paystack-signature"]) {
      await webhook(req, res);
      return;
    }
    const action = new URL(req.url || "/", "http://localhost").searchParams.get("action") || "";
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
