import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { AI_CONFIG } from "../../../packages/config/src/index.ts";

const MAX_AUDIO = 80 * 1024 * 1024;
const NOTES_MODEL = process.env.XAI_NOTES_MODEL || AI_CONFIG.notesModel;
const STT_MODEL = process.env.XAI_STT_MODEL || AI_CONFIG.sttModel;

const NOTES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "highlights", "actions", "sections"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    highlights: { type: "array", items: { type: "string" } },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "owner"],
        properties: {
          text: { type: "string" },
          owner: { type: "string" },
        },
      },
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "bullets"],
        properties: {
          heading: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

const SYSTEM = `You are JotBox. You write the notes a careful person would wish they had taken in a meeting, seminar, lecture, or voice note.

Rules:
- The transcript is what was said. Scratch notes are what the listener marked. When scratch notes exist, treat them as the spine and expand them from the transcript.
- Do not invent names, numbers, decisions, quotes, or assignments.
- Do not add praise, preamble, or filler.
- Write in plain English.
- Title: specific, under 8 words, no quotation marks.
- Summary: one short paragraph a person could send to someone who missed the session.
- Highlights: the points worth keeping. Each one is a full sentence.
- Actions: only real commitments and next steps. Owner is the person named, "You" when the listener took it, or "Unassigned". Use an empty list when there is nothing to do.
- Sections follow the shape of the session. Meetings lean on decisions and discussion. Lectures and seminars follow the topics that were taught. Voice notes stay short.
- If the transcript is thin, write only from what is there.`;

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("too_large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function fileExt(contentType: string) {
  if (contentType.includes("mp4") || contentType.includes("m4a")) return "m4a";
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("ogg")) return "ogg";
  return "webm";
}

async function transcribe(apiKey: string, body: Buffer, contentType: string) {
  const form = new FormData();
  form.append("model", STT_MODEL);
  form.append("language", "en");
  form.append("format", "true");
  form.append("diarize", "true");
  const type = contentType.split(";")[0] || "application/octet-stream";
  form.append("file", new Blob([body], { type }), `session.${fileExt(type)}`);
  const response = await fetch("https://api.x.ai/v1/stt", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(150_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw Object.assign(new Error(detail.slice(0, 400)), { status: response.status });
  }
  return response.json();
}

async function enhance(apiKey: string, payload: { kind: string; title: string; scratch: string; transcript: string }) {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: NOTES_MODEL,
      temperature: AI_CONFIG.temperature,
      max_tokens: AI_CONFIG.maxTokens,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Kind: ${payload.kind}\nWorking title: ${payload.title || "(none)"}\n\nScratch notes:\n${payload.scratch.trim() || "(none)"}\n\nTranscript:\n${payload.transcript.trim() || "(none)"}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "session_notes",
          strict: true,
          schema: NOTES_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(75_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw Object.assign(new Error(detail.slice(0, 400)), { status: response.status });
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("empty notes");
  return JSON.parse(content) as unknown;
}

export function notesApi(apiKey: string): Plugin {
  const handle = async (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const pathname = (req.url ?? "").split("?")[0];
    if (!pathname.startsWith("/api/")) {
      next();
      return;
    }
    try {
      if (pathname === "/api/health" && req.method === "GET") {
        send(res, 200, { ai: Boolean(apiKey) });
        return;
      }
      if (!apiKey) {
        send(res, 503, { error: "Add XAI_API_KEY to the server environment to turn on studio notes." });
        return;
      }
      if (pathname === "/api/transcribe" && req.method === "POST") {
        const body = await readBody(req, MAX_AUDIO);
        const contentType = String(req.headers["content-type"] ?? "application/octet-stream");
        send(res, 200, await transcribe(apiKey, body, contentType));
        return;
      }
      if (pathname === "/api/enhance" && req.method === "POST") {
        const raw = await readBody(req, 2 * 1024 * 1024);
        const payload = JSON.parse(raw.toString("utf8")) as {
          kind?: string;
          title?: string;
          scratch?: string;
          transcript?: string;
        };
        send(
          res,
          200,
          await enhance(apiKey, {
            kind: payload.kind ?? "meeting",
            title: payload.title ?? "",
            scratch: payload.scratch ?? "",
            transcript: (payload.transcript ?? "").slice(0, 80_000),
          }),
        );
        return;
      }
      send(res, 404, { error: "Not found" });
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
      const message = error instanceof Error ? error.message : "Request failed";
      send(res, Number.isFinite(status) ? status : 500, { error: message.slice(0, 400) });
    }
  };

  return {
    name: "jotbox-notes-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next);
      });
    },
  };
}
