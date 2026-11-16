import { z } from "zod";
import { currentSession } from "./auth.mjs";
import { tokenHash } from "./passwords.mjs";
import { query } from "./pg.mjs";
import { HttpError, clientIp, readJson, requireMethod, sendJson } from "./http.mjs";

/**
 * Private enterprise onboarding.
 *
 * Operators issue a link from scripts/enterprise-invite.mjs after a deal is
 * agreed. The link is never linked from the app, and it does not grant a
 * session: the customer still signs in before they reach their workspace.
 */

const STEPS = ["welcome", "account", "workspace", "team", "first_meeting", "rollout"];

const stepEnum = z.enum(STEPS);
const tokenSchema = z.string().trim().min(20).max(200);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ token: tokenSchema, action: z.literal("check"), step: stepEnum, done: z.boolean() }),
  z.object({ token: tokenSchema, action: z.literal("accept") }),
]);

const buckets = new Map();

function rateLimit(req) {
  const now = Date.now();
  const key = clientIp(req);
  const entry = buckets.get(key);
  if (!entry || now - entry.at > 10 * 60 * 1000) {
    buckets.set(key, { at: now, count: 1 });
    return;
  }
  entry.count += 1;
  if (entry.count > 40) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
}

function notFound() {
  return new HttpError(404, "This onboarding link is not valid any more.");
}

async function findInvite(rawToken, { touch = false } = {}) {
  const result = await query(
    `select id, company, contact_email, contact_name, seats, price_usd, notes, checklist,
            created_at, expires_at, opened_at, accepted_at, accepted_by, revoked_at
       from enterprise_invites
      where token_hash = $1
      limit 1`,
    [tokenHash(rawToken)],
  );
  const row = result.rows[0];
  if (!row || row.revoked_at) throw notFound();
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new HttpError(410, "This onboarding link has expired. Ask your JotBox contact for a new one.");
  }

  if (touch && !row.opened_at) {
    await query("update enterprise_invites set opened_at = now() where id = $1 and opened_at is null", [row.id]);
    row.opened_at = new Date();
  }
  return row;
}

function inviteView(row, session) {
  const checklist = row.checklist && typeof row.checklist === "object" ? row.checklist : {};
  return {
    company: row.company,
    contactEmail: row.contact_email,
    contactName: row.contact_name,
    seats: row.seats,
    priceUsd: Number(row.price_usd),
    notes: row.notes,
    checklist,
    accepted: Boolean(row.accepted_at),
    acceptedAt: row.accepted_at ? new Date(row.accepted_at).getTime() : null,
    openedAt: row.opened_at ? new Date(row.opened_at).getTime() : null,
    createdAt: new Date(row.created_at).getTime(),
    expiresAt: new Date(row.expires_at).getTime(),
    signedInEmail: session?.user?.email ?? null,
  };
}

export async function handleOnboarding(req, res) {
  requireMethod(req, ["GET", "POST"]);
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  rateLimit(req);

  const url = new URL(req.url || "/", "http://localhost");
  const session = await currentSession(req);

  if (req.method === "GET") {
    const parsed = tokenSchema.safeParse(url.searchParams.get("token") ?? "");
    if (!parsed.success) throw notFound();
    const row = await findInvite(parsed.data, { touch: true });
    sendJson(res, 200, { invite: inviteView(row, session) });
    return;
  }

  const parsed = actionSchema.safeParse(await readJson(req, 20_000));
  if (!parsed.success) throw new HttpError(400, "That onboarding update is not valid.");
  const row = await findInvite(parsed.data.token);

  if (parsed.data.action === "check") {
    const updated = await query(
      `update enterprise_invites
          set checklist = jsonb_set(checklist, array[$2]::text[], to_jsonb($3::boolean), true)
        where id = $1 and revoked_at is null
        returning checklist`,
      [row.id, parsed.data.step, parsed.data.done],
    );
    sendJson(res, 200, { checklist: updated.rows[0]?.checklist ?? {} });
    return;
  }

  const accepted = await query(
    `update enterprise_invites
        set accepted_at = coalesce(accepted_at, now()),
            accepted_by = coalesce(accepted_by, $2)
      where id = $1 and revoked_at is null
      returning accepted_at, accepted_by`,
    [row.id, session?.user?.id ?? null],
  );
  const saved = accepted.rows[0];
  if (!saved) throw notFound();
  sendJson(res, 200, {
    accepted: true,
    acceptedAt: saved.accepted_at ? new Date(saved.accepted_at).getTime() : Date.now(),
    acceptedByEmail: session?.user?.email ?? null,
  });
}

export const ONBOARDING_STEPS = STEPS;
