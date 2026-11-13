import { defaultTitle, transcriptText } from "./format";
import { localNotes } from "./localNotes";
import { wordsToLines } from "./transcript";
import type { SessionKind, SessionNotes, SttWord, TranscriptLine } from "./types";

async function timedFetch(input: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function studioAvailable() {
  try {
    const response = await timedFetch("/api/health", {}, 3500);
    if (!response.ok) return false;
    const data = (await response.json()) as { ai?: boolean };
    return Boolean(data.ai);
  } catch {
    return false;
  }
}

interface StudioPayload {
  title: string;
  summary: string;
  highlights: string[];
  decisions: string[];
  actions: { text: string; owner: string }[];
  sections: { heading: string; bullets: string[] }[];
}

function asNotes(value: unknown): StudioPayload | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.summary !== "string" || typeof record.title !== "string") return null;
  if (!Array.isArray(record.highlights) || !Array.isArray(record.actions) || !Array.isArray(record.sections)) return null;
  const highlights = record.highlights.filter((item): item is string => typeof item === "string");
  const decisions = Array.isArray(record.decisions)
    ? record.decisions.filter((item): item is string => typeof item === "string")
    : [];
  const actions = record.actions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const action = item as Record<string, unknown>;
    if (typeof action.text !== "string") return [];
    return [{ text: action.text, owner: typeof action.owner === "string" && action.owner ? action.owner : "Unassigned" }];
  });
  const sections = record.sections.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const section = item as Record<string, unknown>;
    if (typeof section.heading !== "string" || !Array.isArray(section.bullets)) return [];
    return [
      {
        heading: section.heading,
        bullets: section.bullets.filter((bullet): bullet is string => typeof bullet === "string"),
      },
    ];
  });
  return { title: record.title, summary: record.summary, highlights, decisions, actions, sections };
}

async function transcribe(blob: Blob) {
  const response = await timedFetch(
    "/api/transcribe",
    {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    },
    180_000,
  );
  if (!response.ok) return null;
  const data = (await response.json()) as { text?: string; words?: SttWord[] };
  return wordsToLines(data.words, data.text ?? "");
}

async function studioNotes(input: {
  kind: SessionKind;
  title: string;
  scratch: string;
  lines: TranscriptLine[];
}) {
  const response = await timedFetch(
    "/api/enhance",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: input.kind,
        title: input.title,
        scratch: input.scratch,
        transcript: transcriptText(input.lines).slice(0, 80_000),
        tone: "warm-direct",
      }),
    },
    90_000,
  );
  if (!response.ok) return null;
  const parsed = asNotes(await response.json());
  if (!parsed) return null;
  const notes: SessionNotes = {
    summary: parsed.summary,
    highlights: parsed.highlights,
    decisions: parsed.decisions,
    sections: parsed.sections,
    source: "studio",
    actions: parsed.actions.map((action) => ({
      id: crypto.randomUUID(),
      text: action.text,
      owner: action.owner,
      done: false,
    })),
  };
  return { title: parsed.title, notes };
}

export async function buildNotes(input: {
  kind: SessionKind;
  title: string;
  titleIsDefault: boolean;
  scratch: string;
  lines: TranscriptLine[];
  audio?: Blob | null;
  ai: boolean;
}) {
  let lines = input.lines;
  if (input.ai && input.audio && input.audio.size > 0) {
    try {
      const fromAudio = await transcribe(input.audio);
      if (fromAudio && fromAudio.length) lines = fromAudio;
    } catch {
      lines = input.lines;
    }
  }

  if (input.ai && (lines.length || input.scratch.trim())) {
    try {
      const studio = await studioNotes({ ...input, lines });
      if (studio) {
        return {
          lines,
          notes: studio.notes,
          title: input.titleIsDefault && studio.title.trim() ? studio.title.trim() : input.title,
        };
      }
    } catch {
      // The browser draft below still leaves the session usable.
    }
  }

  const notes = localNotes({ kind: input.kind, scratch: input.scratch, lines });
  const title = input.title.trim() || defaultTitle(input.kind);
  return { lines, notes, title };
}
