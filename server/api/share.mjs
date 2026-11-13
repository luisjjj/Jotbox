import { z } from "zod";
import { query } from "./pg.mjs";
import { currentSession, requireSession } from "./auth.mjs";
import { isProUser } from "./billing.mjs";
import { shareLimits } from "./limits.mjs";
import { token, tokenHash } from "./passwords.mjs";
import {
  HttpError,
  assertSameOrigin,
  readJson,
  requireMethod,
  sendJson,
} from "./http.mjs";

const createSchema = z.object({
  captureId: z.string().uuid(),
  days: z.number().int().min(1).max(30).default(7),
});

const idSchema = z.string().uuid();

function linkView(row) {
  return {
    id: row.id,
    hint: row.token_hint,
    createdAt: new Date(row.created_at).getTime(),
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).getTime() : null,
    views: Number(row.views ?? 0),
  };
}

async function getPublicShare(req, res, raw) {
  const hash = tokenHash(raw);
  const result = await query(
    `select l.id as link_id, l.views, l.expires_at, l.revoked_at,
            c.id, c.title, c.kind, c.status, c.created_at, c.duration_sec,
            c.notes, c.transcript, c.participants, u.name as owner_name
       from capture_share_links l
       join captures c on c.id = l.capture_id
       join users u on u.id = c.user_id
      where l.token_hash = $1
      limit 1`,
    [hash],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, "That link is not valid any more.");
  if (row.revoked_at) throw new HttpError(410, "This link was turned off by the person who shared it.");
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    throw new HttpError(410, "This link has expired.");
  }

  await query("update capture_share_links set views = views + 1 where id = $1", [row.link_id]);

  sendJson(res, 200, {
    capture: {
      id: row.id,
      title: row.title,
      kind: row.kind,
      status: row.status,
      createdAt: new Date(row.created_at).getTime(),
      durationSec: Number(row.duration_sec),
      notes: row.notes ?? null,
      transcript: row.transcript ?? [],
      participants: row.participants ?? [],
      ownerName: row.owner_name || "",
      expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    },
  });
}

async function listLinks(req, res, user) {
  const url = new URL(req.url || "/", "http://localhost");
  const captureId = idSchema.safeParse(url.searchParams.get("captureId") || "");
  if (!captureId.success) throw new HttpError(400, "A session id is required.");

  const owned = await query("select id from captures where id = $1 and user_id = $2", [
    captureId.data,
    user.id,
  ]);
  if (!owned.rows[0]) throw new HttpError(404, "That session is not yours to share.");

  const result = await query(
    `select id, token_hint, created_at, expires_at, revoked_at, views
       from capture_share_links
      where capture_id = $1 and created_by = $2
      order by created_at desc
      limit 20`,
    [captureId.data, user.id],
  );
  sendJson(res, 200, { links: result.rows.map(linkView) });
}

async function createLink(req, res, user) {
  assertSameOrigin(req);
  const parsed = createSchema.safeParse(await readJson(req, 20_000));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || "Check the details.");

  const owned = await query("select id, title from captures where id = $1 and user_id = $2", [
    parsed.data.captureId,
    user.id,
  ]);
  const capture = owned.rows[0];
  if (!capture) throw new HttpError(404, "That session is not yours to share.");

  const pro = await isProUser(user.id);
  const limits = shareLimits(pro);
  const days = Math.min(parsed.data.days, limits.days);

  const active = await query(
    `select count(*)::int as count
       from capture_share_links
      where capture_id = $1 and revoked_at is null and (expires_at is null or expires_at > now())`,
    [capture.id],
  );
  if ((active.rows[0]?.count ?? 0) >= limits.links) {
    throw new HttpError(
      402,
      pro
        ? "This session already has five live links. Turn one off first."
        : "Free sharing keeps one live link per session for 7 days. Pro gives you five links and 30 days.",
    );
  }

  const raw = token();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const inserted = await query(
    `insert into capture_share_links (capture_id, created_by, token_hash, token_hint, expires_at)
     values ($1, $2, $3, $4, $5)
     returning id, token_hint, created_at, expires_at, revoked_at, views`,
    [capture.id, user.id, tokenHash(raw), raw.slice(0, 6), expiresAt],
  );

  sendJson(res, 201, {
    link: linkView(inserted.rows[0]),
    token: raw,
    url: `${new URL(req.url || "/", "http://localhost").origin}/s/${raw}`,
  });
}

async function revokeLink(req, res, user) {
  assertSameOrigin(req);
  const url = new URL(req.url || "/", "http://localhost");
  const id = idSchema.safeParse(url.searchParams.get("id") || "");
  if (!id.success) throw new HttpError(400, "A link id is required.");

  const result = await query(
    `update capture_share_links l
        set revoked_at = now()
       from captures c
      where l.id = $1 and l.capture_id = c.id and c.user_id = $2 and l.revoked_at is null
      returning l.id`,
    [id.data, user.id],
  );
  if (!result.rows[0]) throw new HttpError(404, "That link was not found.");
  sendJson(res, 200, { id: id.data });
}

export async function handleShare(req, res) {
  const url = new URL(req.url || "/", "http://localhost");

  if (req.method === "GET") {
    const raw = url.searchParams.get("token") || "";
    if (raw) {
      if (raw.length < 20 || raw.length > 200) throw new HttpError(404, "That link is not valid any more.");
      await getPublicShare(req, res, raw);
      return;
    }
    const session = await currentSession(req);
    if (!session) throw new HttpError(401, "Sign in to continue.");
    await listLinks(req, res, session.user);
    return;
  }

  if (req.method === "POST") {
    const { user } = await requireSession(req);
    await createLink(req, res, user);
    return;
  }

  if (req.method === "DELETE") {
    const { user } = await requireSession(req);
    await revokeLink(req, res, user);
    return;
  }

  requireMethod(req, ["GET", "POST", "DELETE"]);
}
