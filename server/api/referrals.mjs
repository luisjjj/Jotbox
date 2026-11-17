import crypto from "node:crypto";
import { query } from "./pg.mjs";
import {
  HttpError,
  clientIp,
  isSecureRequest,
  requireMethod,
  sendJson,
  serializeCookie,
} from "./http.mjs";

/**
 * Partner referrals.
 *
 * A public link (/r/<slug>) drops an attribution cookie, and registration
 * copies that partner onto the new user. The partner dashboard lives at
 * /partner/<token> and is never linked from the app. Commissions are computed
 * from the recorded billing transactions only. Nothing here calls Paystack.
 */

export const REFERRAL_COOKIE = "jotbox_ref";
export const REFERRAL_DAYS = 90;
const REFERRAL_SLUG = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;
const MAX_LIST = 500;

const visitBuckets = new Map();
const dashboardBuckets = new Map();

function limited(buckets, req, limit) {
  const now = Date.now();
  const key = clientIp(req);
  const entry = buckets.get(key);
  if (!entry || now - entry.at > 10 * 60 * 1000) {
    buckets.set(key, { at: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

function publicOrigin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = req.headers["x-forwarded-proto"] || (isSecureRequest(req) ? "https" : "http");
  const onCustomDomain = host && !/^localhost(:\d+)?$/.test(host) && !host.endsWith(".vercel.app");
  if (onCustomDomain) return `${proto}://${host}`;
  const configured = process.env.JOTBOX_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `${proto}://${host || "jotbox.online"}`;
}

export function commissionFor(amountKobo, commissionBp) {
  const amount = Number(amountKobo) || 0;
  const bp = Number(commissionBp) || 0;
  if (amount <= 0 || bp <= 0) return 0;
  return Math.round((amount * bp) / 10_000);
}

export function isReferralSlug(value) {
  return REFERRAL_SLUG.test(String(value || "").trim().toLowerCase());
}

export function maskEmail(value) {
  const email = String(value || "").trim();
  const at = email.indexOf("@");
  if (at <= 0) return "hidden";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

function tokenHash(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function statusLabel(status) {
  if (!status) return "free";
  if (status === "non-renewing") return "ending";
  return status;
}

export async function handleReferralVisit(req, res) {
  requireMethod(req, ["GET"]);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (limited(visitBuckets, req, 120)) throw new HttpError(429, "Too many requests. Try again in a few minutes.");

  const url = new URL(req.url || "/", "http://localhost");
  const raw = url.searchParams.get("code") || "";
  const slug = raw.trim().toLowerCase();

  let target = "/";
  if (isReferralSlug(slug)) {
    const found = await query(
      "select slug from referral_partners where slug = $1 and active = true limit 1",
      [slug],
    );
    if (found.rows[0]) {
      res.setHeader(
        "Set-Cookie",
        serializeCookie(REFERRAL_COOKIE, slug, {
          maxAge: REFERRAL_DAYS * 24 * 60 * 60,
          secure: isSecureRequest(req),
          sameSite: "Lax",
          path: "/",
        }),
      );
      target = "/?ref=" + encodeURIComponent(slug);
    }
  }

  res.statusCode = 302;
  res.setHeader("Location", target);
  res.end();
}

async function partnerFromToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (token.length < 20 || token.length > 200) {
    throw new HttpError(404, "This partner link is not valid.");
  }
  const result = await query(
    `select id, name, slug, commission_bp, active
       from referral_partners
      where access_token_hash = $1
      limit 1`,
    [tokenHash(token)],
  );
  const partner = result.rows[0];
  if (!partner || !partner.active) throw new HttpError(404, "This partner link is not valid.");
  return partner;
}

export async function handleReferrals(req, res) {
  requireMethod(req, ["GET"]);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (limited(dashboardBuckets, req, 60)) throw new HttpError(429, "Too many requests. Try again in a few minutes.");

  const url = new URL(req.url || "/", "http://localhost");
  const partner = await partnerFromToken(url.searchParams.get("token"));
  const bp = Number(partner.commission_bp) || 0;

  const [referred, payments, payouts] = await Promise.all([
    query(
      `select u.email, u.created_at, s.status, s.plan_key,
              coalesce(p.payments, 0)::int as payments,
              coalesce(p.gross, 0)::bigint as gross,
              p.last_paid_at
         from users u
         left join billing_subscriptions s on s.user_id = u.id
         left join (
           select user_id, count(*)::int as payments, sum(amount)::bigint as gross,
                  max(coalesce(paid_at, created_at)) as last_paid_at
             from billing_transactions
            where status = 'success' and applied_at is not null
            group by user_id
         ) p on p.user_id = u.id
        where u.referral_partner_id = $1
        order by u.created_at desc
        limit ${MAX_LIST}`,
      [partner.id],
    ),
    query(
      `select t.reference, t.amount, t.currency, coalesce(t.paid_at, t.created_at) as paid_at, u.email
         from billing_transactions t
         join users u on u.id = t.user_id
        where u.referral_partner_id = $1
          and t.status = 'success'
          and t.applied_at is not null
        order by coalesce(t.paid_at, t.created_at) desc
        limit 200`,
      [partner.id],
    ),
    query(
      `select id, amount, currency, paid_at, note
         from referral_payouts
        where partner_id = $1
        order by paid_at desc
        limit 200`,
      [partner.id],
    ),
  ]);

  let grossKobo = 0;
  let commissionKobo = 0;
  let paying = 0;
  let active = 0;

  const referrals = referred.rows.map((row) => {
    const gross = Number(row.gross) || 0;
    const commission = commissionFor(gross, bp);
    grossKobo += gross;
    commissionKobo += commission;
    if (row.payments > 0) paying += 1;
    if (row.status === "active") active += 1;
    return {
      email: maskEmail(row.email),
      joinedAt: new Date(row.created_at).getTime(),
      status: statusLabel(row.status),
      payments: Number(row.payments) || 0,
      grossKobo: gross,
      commissionKobo: commission,
      lastPaidAt: row.last_paid_at ? new Date(row.last_paid_at).getTime() : null,
    };
  });

  const paidOutKobo = payouts.rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  sendJson(res, 200, {
    partner: {
      name: partner.name,
      slug: partner.slug,
      commissionPercent: bp / 100,
      link: `${publicOrigin(req)}/r/${partner.slug}`,
    },
    stats: {
      currency: "NGN",
      signups: referrals.length,
      paying,
      active,
      grossKobo,
      commissionKobo,
      paidOutKobo,
      balanceKobo: Math.max(0, commissionKobo - paidOutKobo),
    },
    referrals,
    payments: payments.rows.slice(0, 100).map((row) => ({
      reference: row.reference,
      amountKobo: Number(row.amount) || 0,
      commissionKobo: commissionFor(row.amount, bp),
      currency: row.currency || "NGN",
      paidAt: new Date(row.paid_at).getTime(),
      email: maskEmail(row.email),
    })),
    payouts: payouts.rows.map((row) => ({
      id: row.id,
      amountKobo: Number(row.amount) || 0,
      currency: row.currency || "NGN",
      paidAt: new Date(row.paid_at).getTime(),
      note: row.note || "",
    })),
  });
}
