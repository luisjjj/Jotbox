import { z } from "zod";
import { getPool, query } from "./pg.mjs";
import { requireSession } from "./auth.mjs";
import { indexCapture, scheduleChunkEmbedding } from "./memory-index.mjs";
import { syncMeetingInsights } from "./meeting-insights.mjs";
import {
  overLimitMessage,
  OVERAGE_GRACE_SECONDS,
  quotaScope,
  quotaState,
  releaseQuota,
  reserveQuota,
  settleQuota,
} from "./quota.mjs";
import { audioKeyFor, deleteAudioObject, headAudio, presignAudio, putAudio, storageConfigured } from "./storage.mjs";
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
  due: z.string().max(40).optional(),
  done: z.boolean(),
});

const noteSection = z.object({
  heading: z.string().max(400),
  bullets: z.array(z.string().max(8_000)).max(200),
});

const followUp = z.object({
  to: z.string().max(320),
  subject: z.string().max(400),
  body: z.string().max(20_000),
});

const notes = z.object({
  summary: z.string().max(40_000),
  highlights: z.array(z.string().max(8_000)).max(200),
  decisions: z.array(z.string().max(8_000)).max(100).optional(),
  blockers: z.array(z.string().max(8_000)).max(100).optional(),
  followUps: z.array(followUp).max(20).optional(),
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

const MAX_AUDIO_BYTES = 80 * 1024 * 1024;

async function readBuffer(req, limit) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > limit) throw new HttpError(413, "That recording is too large.");
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "That recording is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function ownedCapture(userId, captureId) {
  const result = await query("select id, audio_key from captures where id = $1 and user_id = $2", [captureId, userId]);
  return result.rows[0] ?? null;
}

const reserveInput = z.object({
  id: z.string().uuid(),
  seconds: z.number().finite().min(0).max(4 * 3600).optional(),
});

const audioRegisterInput = z.object({
  id: z.string().uuid(),
  key: z.string().max(300),
  contentType: z.string().max(120),
});

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
  const url = new URL(req.url || "/", "http://localhost");
  const action = url.searchParams.get("action") || "";

  if (req.method === "GET" && action === "audio") {
    const id = url.searchParams.get("id") || "";
    if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "A session id is required.");
    const capture = await ownedCapture(user.id, id);
    if (!capture) throw new HttpError(404, "That session was not found.");
    if (!capture.audio_key) throw new HttpError(404, "That session has no stored audio.");
    sendJson(res, 200, presignAudio(capture.audio_key));
    return;
  }

  // A two hour recording is larger than a serverless request body allows, so
  // the browser uploads straight to storage with a signed PUT.
  if (req.method === "GET" && action === "audio-upload") {
    const id = url.searchParams.get("id") || "";
    if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "A session id is required.");
    if (!storageConfigured()) throw new HttpError(503, "Audio storage is not configured on this server.");
    const capture = await ownedCapture(user.id, id);
    if (!capture) throw new HttpError(404, "Save the session before sending its audio.");
    const contentType = (url.searchParams.get("contentType") || "application/octet-stream").split(";")[0].trim();
    const objectKey = audioKeyFor(user.id, id, contentType);
    const signed = presignAudio(objectKey, 3600, { method: "PUT", contentType });
    sendJson(res, 200, { key: objectKey, url: signed.url, expiresAt: signed.expiresAt });
    return;
  }

  if (req.method === "POST" && action === "audio-register") {
    assertSameOrigin(req);
    const parsed = audioRegisterInput.safeParse(await readJson(req, 8_000));
    if (!parsed.success) throw new HttpError(400, "That upload could not be registered.");
    const input = parsed.data;
    const contentType = input.contentType.split(";")[0].trim();
    const expected = audioKeyFor(user.id, input.id, contentType);
    if (input.key !== expected) throw new HttpError(400, "That audio does not belong to this session.");
    const stored = await headAudio(input.key);
    if (!stored) throw new HttpError(409, "The recording did not reach storage. Try again.");
    await query(
      `update captures
          set audio_key = $3, audio_content_type = $4, audio_bytes = $5,
              has_audio = true, audio_deleted_at = null, updated_at = now()
        where id = $1 and user_id = $2`,
      [input.id, user.id, input.key, contentType, stored.bytes],
    );
    sendJson(res, 200, { stored: true, key: input.key, bytes: stored.bytes });
    return;
  }

  if (req.method === "POST" && action === "reserve") {
    assertSameOrigin(req);
    const input = reserveInput.safeParse(await readJson(req, 8_000));
    if (!input.success) throw new HttpError(400, "A session id is required.");
    const result = await reserveQuota({
      userId: user.id,
      captureId: input.data.id,
      seconds: input.data.seconds ?? 0,
    });
    if (!result.ok) {
      const exhausted = result.state.usedSeconds + result.state.reservedSeconds >= result.state.limitSeconds;
      throw new HttpError(402, overLimitMessage(result.plan, result.state.limitSeconds, exhausted, result.state.mode));
    }
    sendJson(res, 200, {
      plan: result.plan,
      mode: result.mode,
      reservedSeconds: result.reservation?.seconds ?? 0,
      usedSeconds: result.state.usedSeconds + result.state.reservedSeconds,
      limitSeconds: result.state.limitSeconds,
      remainingSeconds: Math.max(0, result.state.remainingSeconds - result.state.requestedSeconds),
      unlimited: result.state.unlimited,
      pooled: result.state.pooled,
    });
    return;
  }

  if (req.method === "POST" && action === "release") {
    assertSameOrigin(req);
    const input = reserveInput.safeParse({ ...(await readJson(req, 8_000)), seconds: 0 });
    if (!input.success) throw new HttpError(400, "A session id is required.");
    await releaseQuota(user.id, input.data.id);
    sendJson(res, 200, { released: true });
    return;
  }

  if (req.method === "POST" && action === "audio") {
    assertSameOrigin(req);
    const id = url.searchParams.get("id") || "";
    if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "A session id is required.");
    if (!storageConfigured()) throw new HttpError(503, "Audio storage is not configured on this server.");
    const capture = await ownedCapture(user.id, id);
    if (!capture) throw new HttpError(404, "Save the session before sending its audio.");
    const body = await readBuffer(req, MAX_AUDIO_BYTES);
    if (!body.length) throw new HttpError(400, "No audio was sent.");
    const contentType = String(req.headers["content-type"] || "application/octet-stream").split(";")[0];
    const key = audioKeyFor(user.id, id, contentType);
    await putAudio(key, body, contentType);
    await query(
      `update captures
          set audio_key = $3, audio_content_type = $4, audio_bytes = $5,
              has_audio = true, audio_deleted_at = null, updated_at = now()
        where id = $1 and user_id = $2`,
      [id, user.id, key, contentType, body.length],
    );
    sendJson(res, 200, { stored: true, key, bytes: body.length });
    return;
  }

  if (req.method === "DELETE" && action === "audio") {
    assertSameOrigin(req);
    const id = url.searchParams.get("id") || "";
    if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "A session id is required.");
    const capture = await ownedCapture(user.id, id);
    if (!capture) throw new HttpError(404, "That session was not found.");
    if (capture.audio_key) await deleteAudioObject(capture.audio_key).catch(() => {});
    await query(
      `update captures
          set audio_key = null, has_audio = false, audio_deleted_at = now(), updated_at = now()
        where id = $1 and user_id = $2`,
      [id, user.id],
    );
    sendJson(res, 200, { deleted: true });
    return;
  }

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
        where user_id = $1 and is_document = false
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
    let saved = null;
    const client = await getPool().connect();
    try {
      await client.query("begin");
      // One lock per person keeps the plan check and the ledger write atomic, so
      // two tabs saving at once cannot both pass the last minute.
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`usage:${user.id}`]);
      const scope = await quotaScope(client, user.id);
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`quota:${scope.scopeId}`]);
      const state = await quotaState(client, user.id, { excludeCaptureId: item.id });
      if (state.usedSeconds + state.reservedSeconds + item.durationSec > state.limitSeconds + OVERAGE_GRACE_SECONDS) {
        throw new HttpError(
          402,
          overLimitMessage(state.plan, state.limitSeconds, state.usedSeconds >= state.limitSeconds, state.mode),
        );
      }

      const result = await client.query(
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

      if (item.durationSec > 0) {
        await client.query(
          `insert into usage_ledger (user_id, capture_id, seconds)
           values ($1, $2, $3)
           on conflict (user_id, capture_id)
           do update set seconds = greatest(usage_ledger.seconds, excluded.seconds)`,
          [user.id, item.id, Math.ceil(item.durationSec)],
        );
      }
      await settleQuota(client, user.id, item.id, item.durationSec, { wallet: scope.mode === "payg" });
      saved = await client.query(
        "select id, user_id, org_id, department_id, transcript, notes from captures where id = $1 and user_id = $2",
        [item.id, user.id],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    if (saved?.rows[0]?.org_id) {
      try {
        await indexCapture({ query }, saved.rows[0]);
        void scheduleChunkEmbedding(item.id);
      } catch (error) {
        console.warn("[jotbox-captures] memory index skipped", error instanceof Error ? error.message : error);
      }
      try {
        await syncMeetingInsights({ query }, { ...saved.rows[0], notes: item.notes });
      } catch (error) {
        console.warn("[jotbox-captures] insight sync skipped", error instanceof Error ? error.message : error);
      }
    }
    sendJson(res, 200, { id: item.id });
    return;
  }

  if (req.method === "DELETE") {
    assertSameOrigin(req);
    const id = url.searchParams.get("id") || "";
    if (!z.string().uuid().safeParse(id).success) {
      throw new HttpError(400, "A session id is required.");
    }
    const existing = await query(
      "select audio_key from captures where id = $1 and user_id = $2 and status <> 'live'",
      [id, user.id],
    );
    const result = await query(
      "delete from captures where id = $1 and user_id = $2 and status <> 'live' returning id",
      [id, user.id],
    );
    if (!result.rowCount) {
      const live = await query(
        "select 1 from captures where id = $1 and user_id = $2 and status = 'live'",
        [id, user.id],
      );
      if (live.rowCount) {
        throw new HttpError(409, "Stop the capture before deleting it.");
      }
    } else {
      const audioKey = existing.rows[0]?.audio_key;
      if (audioKey) await deleteAudioObject(audioKey).catch(() => {});
      await releaseQuota(user.id, id).catch(() => {});
    }
    res.statusCode = 204;
    res.end();
    return;
  }

  requireMethod(req, ["GET", "POST", "DELETE"]);
}
