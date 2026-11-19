import { cosine, embedTexts, embeddingsConfigured, vectorLiteral } from "./embeddings.mjs";
import { hasDatabase, query } from "./pg.mjs";

/**
 * Speaker-turn chunks for organisation memory.
 *
 * Every chunk keeps its capture, speaker and start second, so an answer can
 * link straight back to the moment it came from. Embeddings are best effort:
 * text and tsvector rows are written first, lexical search works immediately,
 * and vectors are filled in afterwards.
 */

const MAX_CHUNK_CHARS = 900;
const MAX_CHUNKS = 400;
const MAX_GAP_SECONDS = 90;
const LEXICAL_LIMIT = 40;
const VECTOR_LIMIT = 40;
const MAX_JSON_CANDIDATES = 600;

function words(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function secondsLine(line) {
  const at = Number(line?.at);
  return Number.isFinite(at) && at >= 0 ? at : 0;
}

function noteText(notes) {
  if (!notes || typeof notes !== "object") return "";
  const parts = [];
  if (typeof notes.summary === "string") parts.push(notes.summary);
  for (const key of ["highlights", "decisions", "blockers"]) {
    if (Array.isArray(notes[key])) {
      for (const item of notes[key]) if (typeof item === "string" && item.trim()) parts.push(item.trim());
    }
  }
  return parts.join("\n");
}

/**
 * Groups transcript lines into speaker turns of at most MAX_CHUNK_CHARS.
 * Pure and deterministic so it can be tested without a database.
 */
export function chunkCapture({ transcript, notes } = {}) {
  const lines = Array.isArray(transcript) ? transcript : [];
  const chunks = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const text = current.parts.join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      chunks.push({
        speaker: current.speaker || "",
        startSec: Math.max(0, current.startSec),
        endSec: Math.max(current.startSec, current.endSec),
        text,
      });
    }
    current = null;
  };

  for (const line of lines) {
    const text = String(line?.text || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const speaker = typeof line?.speaker === "string" ? line.speaker.trim() : "";
    const at = secondsLine(line);
    const end = at + Math.max(1, words(text) / 2.5);

    if (!current) {
      current = { speaker, startSec: at, endSec: end, parts: [] };
    } else {
      const speakerChanged = speaker !== current.speaker;
      const tooLong = current.parts.join(" ").length + text.length > MAX_CHUNK_CHARS;
      const longGap = at - current.endSec > MAX_GAP_SECONDS && current.parts.join(" ").length > 200;
      if (speakerChanged || tooLong || longGap) flush();
      if (!current) current = { speaker, startSec: at, endSec: end, parts: [] };
    }

    // A pasted line can be longer than a chunk on its own.
    if (text.length > MAX_CHUNK_CHARS) {
      const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
      let piece = "";
      for (const sentence of sentences) {
        const clean = sentence.trim();
        if (!clean) continue;
        if (piece && piece.length + clean.length > MAX_CHUNK_CHARS) {
          current.parts.push(piece);
          flush();
          current = { speaker, startSec: at, endSec: end, parts: [] };
          piece = "";
        }
        piece = piece ? `${piece} ${clean}` : clean;
      }
      if (piece) current.parts.push(piece);
    } else {
      current.parts.push(text);
    }
    current.endSec = Math.max(current.endSec, end);
    if (chunks.length >= MAX_CHUNKS) break;
  }
  flush();

  const summary = noteText(notes);
  if (summary && !chunks.length) {
    chunks.push({ speaker: "Notes", startSec: 0, endSec: 0, text: summary.slice(0, MAX_CHUNK_CHARS) });
  }

  return chunks.slice(0, MAX_CHUNKS).map((chunk, index) => ({ ...chunk, chunkIndex: index }));
}

export async function indexCapture(db, capture) {
  const captureId = capture?.id;
  if (!captureId) return 0;
  if (!capture.org_id) {
    await db.query("delete from memory_chunks where capture_id = $1", [captureId]);
    return 0;
  }
  const chunks = chunkCapture({ transcript: capture.transcript, notes: capture.notes });
  await db.query("delete from memory_chunks where capture_id = $1", [captureId]);
  if (!chunks.length) return 0;
  await db.query(
    `insert into memory_chunks
       (capture_id, org_id, department_id, owner_id, chunk_index, speaker, start_sec, end_sec, text)
     select $1, $2, $3, $4,
            row.chunk_index, row.speaker, row.start_sec, row.end_sec, row.text
       from jsonb_to_recordset($5::jsonb)
         as row(chunk_index int, speaker text, start_sec double precision,
                end_sec double precision, text text)`,
    [
      captureId,
      capture.org_id,
      capture.department_id ?? null,
      capture.user_id,
      JSON.stringify(chunks),
    ],
  );
  return chunks.length;
}

let vectorColumn = null;

export async function hasVectorColumn(db = { query }) {
  if (vectorColumn !== null) return vectorColumn;
  try {
    const result = await db.query(
      "select 1 from information_schema.columns where table_name = 'memory_chunks' and column_name = 'embedding_vector' limit 1",
    );
    vectorColumn = result.rows.length > 0;
  } catch {
    vectorColumn = false;
  }
  return vectorColumn;
}

export async function embedCaptureChunks(captureId, { db = { query } } = {}) {
  if (!embeddingsConfigured()) return 0;
  const pending = await db.query(
    `select id, text from memory_chunks
      where capture_id = $1 and embedding is null
      order by chunk_index
      limit 128`,
    [captureId],
  );
  if (!pending.rows.length) return 0;
  const vectors = await embedTexts(pending.rows.map((row) => row.text));
  if (!vectors) return 0;
  const useVector = await hasVectorColumn(db);
  for (let index = 0; index < pending.rows.length; index += 1) {
    const vector = vectors[index];
    if (!vector) continue;
    await db.query(
      `update memory_chunks set embedding = $2::jsonb, embedding_model = $3 where id = $1`,
      [pending.rows[index].id, JSON.stringify(vector), process.env.JOTBOX_EMBEDDINGS_MODEL || "text-embedding-3-small"],
    );
    if (useVector && vector.length === 1536) {
      await db.query("update memory_chunks set embedding_vector = $2::vector where id = $1", [
        pending.rows[index].id,
        vectorLiteral(vector),
      ]);
    }
  }
  return pending.rows.length;
}

/**
 * Runs in the background after a save. A serverless host may stop the process
 * early; the chunk rows are already searchable and the next save retries.
 */
export async function scheduleChunkEmbedding(captureId) {
  if (!hasDatabase() || !embeddingsConfigured()) return;
  const work = embedCaptureChunks(captureId).catch((error) => {
    console.warn("[jotbox-memory-index]", error instanceof Error ? error.message : error);
  });
  if (process.env.VERCEL) {
    try {
      const { waitUntil } = await import("@vercel/functions");
      waitUntil(work);
      return;
    } catch {
      // Fall through to a detached promise; polling or the next save retries.
    }
  }
  void work;
}

export function fuseRanks(lexical = [], vector = [], k = 60) {
  const merged = new Map();
  const add = (item, key, rank, score) => {
    const existing = merged.get(item.id) ?? { ...item, lexicalScore: 0, vectorScore: 0, score: 0 };
    existing[key] = score;
    existing.score += 1 / (k + rank + 1);
    merged.set(item.id, existing);
  };
  lexical.forEach((item, index) => add(item, "lexicalScore", index, item.score ?? 0));
  vector.forEach((item, index) => add(item, "vectorScore", index, item.score ?? 0));
  return [...merged.values()].sort((a, b) => b.score - a.score);
}

function chunkView(row) {
  return {
    id: row.id,
    captureId: row.capture_id,
    speaker: row.speaker || "",
    startSec: Number(row.start_sec) || 0,
    endSec: Number(row.end_sec) || 0,
    text: String(row.text || ""),
    score: Number(row.score) || 0,
  };
}

/**
 * Hybrid retrieval: tsvector ranking fused with vector ranking. The caller
 * supplies already permission-filtered capture ids, so this never widens the
 * set of meetings a person can see.
 */
export async function retrieveChunks(db, { question, captureIds, limit = 24 }) {
  if (!captureIds?.length) return [];
  const cleanQuestion = String(question || "").trim().slice(0, 600);
  if (!cleanQuestion) return [];

  let lexical = [];
  try {
    const result = await db.query(
      `with q as (select plainto_tsquery('simple', $1) as query)
       select c.id, c.capture_id, c.speaker, c.start_sec, c.end_sec, c.text,
              ts_rank(c.tsv, q.query) as score
         from memory_chunks c, q
        where c.capture_id = any($2::uuid[])
          and c.tsv @@ q.query
        order by score desc
        limit ${LEXICAL_LIMIT}`,
      [cleanQuestion, captureIds],
    );
    lexical = result.rows.map(chunkView);
  } catch (error) {
    console.warn("[jotbox-memory-index] lexical search failed", error instanceof Error ? error.message : error);
  }

  let vector = [];
  if (embeddingsConfigured()) {
    const vectors = await embedTexts([cleanQuestion]);
    const queryVector = vectors?.[0];
    if (queryVector) {
      try {
        if (await hasVectorColumn(db)) {
          const result = await db.query(
            `select id, capture_id, speaker, start_sec, end_sec, text,
                    1 - (embedding_vector <=> $1::vector) as score
               from memory_chunks
              where capture_id = any($2::uuid[])
                and embedding_vector is not null
              order by embedding_vector <=> $1::vector
              limit ${VECTOR_LIMIT}`,
            [vectorLiteral(queryVector), captureIds],
          );
          vector = result.rows.map(chunkView);
        } else {
          const result = await db.query(
            `select id, capture_id, speaker, start_sec, end_sec, text, embedding
               from memory_chunks
              where capture_id = any($1::uuid[]) and embedding is not null
              order by created_at desc
              limit ${MAX_JSON_CANDIDATES}`,
            [captureIds],
          );
          vector = result.rows
            .map((row) => ({ ...row, score: cosine(queryVector, row.embedding) }))
            .filter((row) => row.score > 0.15)
            .sort((a, b) => b.score - a.score)
            .slice(0, VECTOR_LIMIT)
            .map(chunkView);
        }
      } catch (error) {
        console.warn("[jotbox-memory-index] vector search failed", error instanceof Error ? error.message : error);
      }
    }
  }

  return fuseRanks(lexical, vector).slice(0, limit);
}

export function citationsFrom(chunks, sourceMap, limit = 8) {
  const seen = new Set();
  const citations = [];
  for (const chunk of chunks) {
    const source = sourceMap.get(chunk.captureId);
    if (!source) continue;
    const key = `${chunk.captureId}:${Math.floor(chunk.startSec)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const start = Math.max(0, Math.floor(chunk.startSec));
    citations.push({
      id: key,
      captureId: chunk.captureId,
      title: source.title,
      date: source.date,
      speaker: chunk.speaker,
      startSec: start,
      excerpt: chunk.text.replace(/\s+/g, " ").slice(0, 260),
      href: `/session/${chunk.captureId}${start > 0 ? `?t=${start}` : ""}`,
    });
    if (citations.length >= limit) break;
  }
  return citations;
}
