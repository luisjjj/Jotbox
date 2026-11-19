import { defaultTitle, transcriptText } from "./format";
import { filterLines, focusContext, getFocusMode, getSessionLanguage, knownNames } from "./listening";
import { localNotes } from "./localNotes";
import { wordsToLines } from "./transcript";
import type { Participant, SessionKind, SessionNotes, SttWord, TranscriptLine } from "./types";

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
  blockers: string[];
  actions: { text: string; owner: string; due: string }[];
  followUps: { to: string; subject: string; body: string }[];
  sections: { heading: string; bullets: string[] }[];
}

function asStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asNotes(value: unknown): StudioPayload | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.summary !== "string" || typeof record.title !== "string") return null;
  if (!Array.isArray(record.highlights) || !Array.isArray(record.actions) || !Array.isArray(record.sections)) return null;
  const highlights = record.highlights.filter((item): item is string => typeof item === "string");
  const decisions = asStrings(record.decisions);
  const blockers = asStrings(record.blockers);
  const actions = record.actions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const action = item as Record<string, unknown>;
    if (typeof action.text !== "string") return [];
    return [
      {
        text: action.text,
        owner: typeof action.owner === "string" && action.owner ? action.owner : "Unassigned",
        due: typeof action.due === "string" ? action.due : "",
      },
    ];
  });
  const followUps = Array.isArray(record.followUps)
    ? record.followUps.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const draft = item as Record<string, unknown>;
        if (typeof draft.subject !== "string" || typeof draft.body !== "string") return [];
        if (!draft.subject.trim() || !draft.body.trim()) return [];
        return [
          {
            to: typeof draft.to === "string" ? draft.to : "",
            subject: draft.subject,
            body: draft.body,
          },
        ];
      })
    : [];
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
  return { title: record.title, summary: record.summary, highlights, decisions, blockers, actions, followUps, sections };
}

function encodeContext(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function transcribe(
  blob: Blob,
  context: { title: string; kind: SessionKind; names: string[]; focus: string; language: string },
) {
  const response = await timedFetch(
    "/api/transcribe",
    {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "application/octet-stream",
        "x-jotbox-stt-context": encodeContext(context),
      },
      body: blob,
    },
    180_000,
  );
  if (!response.ok) {
    let message = "JotBox could not read that recording.";
    if (response.status < 500) {
      try {
        const data = (await response.json()) as { error?: unknown };
        if (typeof data?.error === "string" && data.error.trim()) message = data.error;
      } catch {
        // Keep the plain message when the server did not send JSON.
      }
    }
    throw new Error(message);
  }
  const data = (await response.json()) as { text?: string; words?: SttWord[] };
  return wordsToLines(data.words, data.text ?? "");
}

async function studioNotes(input: {
  kind: SessionKind;
  title: string;
  scratch: string;
  lines: TranscriptLine[];
  participants: Participant[];
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
        participants: input.participants.map((person) => person.name),
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
    blockers: parsed.blockers,
    followUps: parsed.followUps,
    sections: parsed.sections,
    source: "studio",
    actions: parsed.actions.map((action) => ({
      id: crypto.randomUUID(),
      text: action.text,
      owner: action.owner,
      due: action.due || undefined,
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
  participants?: Participant[];
}) {
  const participants = input.participants ?? [];
  const context = focusContext({
    title: input.title,
    kind: input.kind,
    participants,
    scratch: input.scratch,
  });
  const focus = getFocusMode();
  let lines = input.lines;
  let readFailed = false;
  if (input.ai && input.audio && input.audio.size > 0) {
    try {
      const fromAudio = await transcribe(input.audio, {
        title: input.title,
        kind: input.kind,
        names: knownNames(participants),
        focus,
        language: getSessionLanguage(),
      });
      if (fromAudio.length) lines = fromAudio;
    } catch {
      readFailed = true;
      lines = input.lines;
    }
  }
  lines = filterLines(lines, context, focus).kept;

  if (readFailed && !lines.length && !input.scratch.trim()) {
    throw new Error(
      "JotBox could not read that recording. The audio is saved on this device, so try again, or add the words by hand.",
    );
  }

  if (input.ai && (lines.length || input.scratch.trim())) {
    try {
      const studio = await studioNotes({ ...input, lines, participants });
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
