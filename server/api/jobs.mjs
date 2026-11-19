import { randomUUID } from "node:crypto";
import { z } from "zod";
import { enhanceSession, sanitizeSttContext, transcribeAudio } from "./ai.mjs";
import { requireSession } from "./auth.mjs";
import { query } from "./pg.mjs";
import { audioKeyFor, getAudio } from "./storage.mjs";
import { HttpError, assertSameOrigin, readJson, requireMethod, sendJson } from "./http.mjs";

/**
 * Background note jobs.
 *
 * The client gets a job id as soon as the audio is stored, then polls while it
 * moves to the session page. On Vercel the work is handed to `waitUntil`. On a
 * host without it, the first poll claims and runs the job, so the feature does
 * not depend on an external queue service.
 */

const STALE_RUNNING_MINUTES = 10;

export function linesFromWords(words, text) {
  if (!Array.isArray(words) || !words.length) {
    const trimmed = String(text || "").trim();
    return trimmed ? [{ id: randomUUID(), text: trimmed, at: 0, speaker: "Speaker 1" }] : [];
  }
  const lines = [];
  const diarized = words.some((word) => word?.speaker !== undefined);
  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    const speaker = buffer[0].speaker;
    const joined = buffer
      .map((word) => word.text)
      .join(" ")
      .replace(/\s+([,.!?;:])/g, "$1")
      .trim();
    if (joined) {
      lines.push({
        id: randomUUID(),
        text: joined,
        at: Number(buffer[0].start) || 0,
        speaker: speaker === undefined ? (diarized ? undefined : "Speaker 1") : `Speaker ${speaker + 1}`,
      });
    }
    buffer = [];
  };
  for (const word of words) {
    const previous = buffer[buffer.length - 1];
    const gap = previous ? Number(word.start) - Number(previous.end) : 0;
    const speakerChanged = previous && word.speaker !== undefined && word.speaker !== previous.speaker;
    const tooLong = buffer.reduce((total, item) => total + item.text.length + 1, 0) > 220;
    if (buffer.length && (speakerChanged || gap > 1.15 || tooLong)) flush();
    buffer.push(word);
  }
  flush();
  return lines;
}

function transcriptForNotes(lines) {
  return lines.map((line) => (line.speaker ? `${line.speaker}: ${line.text}` : line.text)).join("\n");
}

export function jobView(row) {
  return {
    id: row.id,
    status: row.status,
    result: row.result ?? null,
    error: row.error ?? null,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

export async function createJob({ userId, captureId, payload }) {
  const active = await query(
    `select * from ai_jobs
      where user_id = $1 and capture_id = $2 and status in ('queued', 'running')
      order by created_at desc
      limit 1`,
    [userId, captureId],
  );
  if (active.rows[0]) return jobView(active.rows[0]);

  const result = await query(
    `insert into ai_jobs (user_id, capture_id, kind, payload)
     values ($1, $2, 'notes', $3::jsonb)
     returning *`,
    [userId, captureId, JSON.stringify(payload)],
  );
  const job = result.rows[0];
  void dispatch(job.id);
  return jobView(job);
}

async function dispatch(jobId) {
  const work = runJob(jobId).catch((error) => {
    console.warn("[jotbox-jobs] run failed", jobId, error instanceof Error ? error.message : error);
  });
  if (process.env.VERCEL) {
    try {
      const { waitUntil } = await import("@vercel/functions");
      waitUntil(work);
      return;
    } catch {
      // The poll endpoint claims the job when no background slot exists.
    }
  }
  void work;
}

async function claim(jobId) {
  const result = await query(
    `update ai_jobs
        set status = 'running', attempt = attempt + 1, started_at = now(), updated_at = now()
      where id = $1
        and (status = 'queued'
          or (status = 'running' and started_at < now() - ($2::int * interval '1 minute')))
      returning *`,
    [jobId, STALE_RUNNING_MINUTES],
  );
  return result.rows[0] ?? null;
}

async function current(jobId) {
  const result = await query("select * from ai_jobs where id = $1", [jobId]);
  return result.rows[0] ?? null;
}

export async function runJob(jobId) {
  const job = await claim(jobId);
  if (!job) {
    const row = await current(jobId);
    return row ? jobView(row) : null;
  }
  try {
    const payload = job.payload || {};
    if (!payload.audioKey) throw new Error("The audio for this job is not stored.");
    const expected = audioKeyFor(job.user_id, job.capture_id, payload.contentType);
    if (payload.audioKey !== expected) throw new Error("The audio key does not match this capture.");
    const audio = await getAudio(payload.audioKey);
    const filename = `session.${payload.audioKey.split(".").pop() || "webm"}`;
    const transcription = await transcribeAudio({
      buffer: audio.body,
      contentType: audio.contentType || payload.contentType,
      filename,
      context: payload.context ?? null,
    });
    const lines = linesFromWords(transcription.words, transcription.text);
    if (!lines.length) throw new Error("JotBox could not hear enough words in that recording.");
    const notes = await enhanceSession({
      kind: payload.kind,
      title: payload.title,
      scratch: payload.scratch,
      transcript: transcriptForNotes(lines).slice(0, 80_000),
      tone: payload.tone || "warm-direct",
      participants: Array.isArray(payload.participants) ? payload.participants : [],
    });
    const result = {
      title: payload.titleIsDefault && notes?.title ? notes.title : payload.title,
      lines,
      notes,
      language: transcription.language ?? null,
    };
    const saved = await query(
      `update ai_jobs
          set status = 'done', result = $2::jsonb, error = null, finished_at = now(), updated_at = now()
        where id = $1
        returning *`,
      [job.id, JSON.stringify(result)],
    );
    return jobView(saved.rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The notes could not be written.";
    const saved = await query(
      `update ai_jobs
          set status = 'failed', error = $2, finished_at = now(), updated_at = now()
        where id = $1
        returning *`,
      [job.id, message.slice(0, 1_000)],
    );
    return jobView(saved.rows[0]);
  }
}

export async function getJob({ userId, id }) {
  const row = await current(id);
  if (!row || row.user_id !== userId) return null;
  if (row.status === "queued" || row.status === "running") {
    const finished = await runJob(id);
    if (finished) return finished;
  }
  return jobView(row);
}

export async function sweepJobs() {
  const result = await query(
    `update ai_jobs
        set status = 'failed', error = 'The job was abandoned before it finished.', finished_at = now(), updated_at = now()
      where status = 'running' and started_at < now() - interval '2 hours'`,
  );
  return result.rowCount ?? 0;
}

const uuid = z.string().uuid();

const jobInput = z.object({
  id: uuid,
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["meeting", "seminar", "lecture", "voice"]),
  scratch: z.string().max(200_000).default(""),
  participants: z.array(z.string().max(120)).max(100).default([]),
  context: z.unknown().optional().nullable(),
  contentType: z.string().max(120),
  audioKey: z.string().max(300),
  titleIsDefault: z.boolean().default(false),
  tone: z.string().max(40).optional(),
});

export async function handleTranscribeJob(req, res) {
  const { user } = await requireSession(req);
  const url = new URL(req.url || "/", "http://localhost");

  if (req.method === "POST") {
    assertSameOrigin(req);
    const parsed = jobInput.safeParse(await readJson(req, 40_000));
    if (!parsed.success) throw new HttpError(400, "That job request could not be read.");
    const input = parsed.data;
    const owned = await query("select id from captures where id = $1 and user_id = $2", [input.id, user.id]);
    if (!owned.rowCount) throw new HttpError(404, "Save the session before writing its notes.");
    const expectedKey = audioKeyFor(user.id, input.id, input.contentType);
    if (input.audioKey !== expectedKey) throw new HttpError(400, "That audio does not belong to this session.");
    const job = await createJob({
      userId: user.id,
      captureId: input.id,
      payload: {
        title: input.title,
        kind: input.kind,
        scratch: input.scratch,
        participants: input.participants,
        context: sanitizeSttContext(input.context),
        contentType: input.contentType,
        audioKey: input.audioKey,
        titleIsDefault: input.titleIsDefault,
        tone: input.tone || "warm-direct",
      },
    });
    sendJson(res, 202, { job });
    return;
  }

  if (req.method === "GET") {
    const id = url.searchParams.get("id") || "";
    if (!uuid.safeParse(id).success) throw new HttpError(400, "A job id is required.");
    const job = await getJob({ userId: user.id, id });
    if (!job) throw new HttpError(404, "That job was not found.");
    sendJson(res, 200, { job });
    return;
  }

  requireMethod(req, ["GET", "POST"]);
}
