import { z } from "zod";
import { query } from "./pg.mjs";
import { requireSession } from "./auth.mjs";
import { isProUser } from "./billing.mjs";
import { freeMonthlySeconds, monthlyUsageSeconds } from "./usage.mjs";
import {
  HttpError,
  assertSameOrigin,
  readJson,
  requireMethod,
  sendJson,
} from "./http.mjs";

const transcriptLine = z.object({
  id: z.string().max(120),
  text: z.string().max(20_000),
  at: z.number().finite().min(0).max(24 * 3600),
  speaker: z.string().max(120).optional(),
});

const actionItem = z.object({
  id: z.string().max(120),
  text: z.string().max(4_000),
  owner: z.string().max(160),
  done: z.boolean(),
});

const noteSection = z.object({
  heading: z.string().max(400),
  bullets: z.array(z.string().max(8_000)).max(200),
});

const notes = z.object({
  summary: z.string().max(40_000),
  highlights: z.array(z.string().max(8_000)).max(200),
  decisions: z.array(z.string().max(8_000)).max(100).optional(),
  actions: z.array(actionItem).max(200),
  sections: z.array(noteSection).max(100),
  source: z.enum(["studio", "browser"]),
});

const participant = z.object({
  id: z.string().max(120),
  name: z.string().max(120),
  external: z.boolean().optional(),
});

const liveInsights = z.object({
  decisions: z.array(z.string().max(4_000)).max(20),
  actions: z.array(z.object({ text: z.string().max(4_000), owner: z.string().max(160) })).max(20),
});

const session = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["meeting", "seminar", "lecture", "voice"]),
  status: z.enum(["live", "processing", "ready", "failed"]),
  createdAt: z.number().int().positive(),
  durationSec: z.number().finite().min(0).max(24 * 3600),
  scratch: z.string().max(200_000),
  transcript: z.array(transcriptLine).max(5_000),
  notes: notes.nullable(),
  hasAudio: z.boolean(),
  error: z.string().max(4_000).optional(),
  participants: z.array(participant).max(100).optional(),
  live: liveInsights.nullable().optional(),
});

const EXPIRED_LIVE_ERROR =
  "This capture stayed open for more than 4 hours, so JotBox ended it. The words that were saved are here. Write the notes from them.";

// The recorder stops itself at the limit. A few seconds of grace covers the
// final tick, so an honest capture is never refused for stopping on time.
const OVERAGE_GRACE_SECONDS = 10;

function fromRow(row) {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    status: row.status,
    createdAt: new Date(row.created_at).getTime(),
    durationSec: Number(row.duration_sec),
    scratch: row.scratch,
    transcript: row.transcript ?? [],
    notes: row.notes ?? null,
    hasAudio: row.has_audio,
    participants: row.participants ?? [],
    ...(row.live ? { live: row.live } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

export async function handleCaptures(req, res) {
  const { user } = await requireSession(req);

  if (req.method === "GET") {
    await query(
      `update captures
          set status = 'failed', error = $2, updated_at = now()
        where user_id = $1 and status = 'live' and created_at < now() - interval '4 hours'`,
      [user.id, EXPIRED_LIVE_ERROR],
    );
    const result = await query(
      `select id, title, kind, status, duration_sec, scratch, transcript, notes, has_audio, error, participants, live, created_at
         from captures
        where user_id = $1
        order by created_at desc
        limit 500`,
      [user.id],
    );
    sendJson(res, 200, { sessions: result.rows.map(fromRow) });
    return;
  }

  if (req.method === "POST") {
    assertSameOrigin(req);
    const parsed = session.safeParse((await readJson(req, 3_000_000)).session);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || "That session could not be saved.");
    }
    const item = parsed.data;

    if (!(await isProUser(user.id))) {
      const limit = freeMonthlySeconds();
      const used = await monthlyUsageSeconds(user.id, { excludeId: item.id });
      if (used + item.durationSec > limit + OVERAGE_GRACE_SECONDS) {
        const message =
          used >= limit
            ? "Your free listening minutes are finished for this month. Upgrade to Pro to keep listening. Your notes are still saved on this device."
            : "This capture is longer than the free listening time you have left this month. Upgrade to Pro to keep listening. Your notes are still saved on this device.";
        throw new HttpError(402, message);
      }
    }

    const result = await query(
      `insert into captures
         (id, user_id, title, kind, status, duration_sec, scratch, transcript, notes, has_audio, error, participants, live, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12::jsonb, $13::jsonb, $14)
       on conflict (id) do update set
         title = excluded.title,
         kind = excluded.kind,
         status = excluded.status,
         duration_sec = excluded.duration_sec,
         scratch = excluded.scratch,
         transcript = excluded.transcript,
         notes = excluded.notes,
         has_audio = excluded.has_audio,
         error = excluded.error,
         participants = excluded.participants,
         live = excluded.live,
         created_at = excluded.created_at,
         updated_at = now()
       where captures.user_id = excluded.user_id
       returning id`,
      [
        item.id,
        user.id,
        item.title,
        item.kind,
        item.status,
        item.durationSec,
        item.scratch,
        JSON.stringify(item.transcript),
        item.notes ? JSON.stringify(item.notes) : null,
        item.hasAudio,
        item.error ?? null,
        JSON.stringify(item.participants ?? []),
        item.live ? JSON.stringify(item.live) : null,
        new Date(item.createdAt).toISOString(),
      ],
    );
    if (!result.rowCount) {
      throw new HttpError(409, "That session belongs to another account.");
    }
    sendJson(res, 200, { id: item.id });
    return;
  }

  if (req.method === "DELETE") {
    assertSameOrigin(req);
    const url = new URL(req.url || "/", "http://localhost");
    const id = url.searchParams.get("id") || "";
    if (!z.string().uuid().safeParse(id).success) {
      throw new HttpError(400, "A session id is required.");
    }
    await query("delete from captures where id = $1 and user_id = $2", [id, user.id]);
    res.statusCode = 204;
    res.end();
    return;
  }

  requireMethod(req, ["GET", "POST", "DELETE"]);
}
