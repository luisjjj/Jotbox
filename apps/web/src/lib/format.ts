import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";
import { OUTPUT_PRESETS } from "./presets";
import type { Session, SessionKind, SessionNotes, TranscriptLine } from "./types";

export const KIND_META: Record<SessionKind, { label: string; hint: string }> = {
  meeting: { label: "Meeting", hint: "Decisions, and who does what" },
  seminar: { label: "Seminar", hint: "Talks, panels, and workshops" },
  lecture: { label: "Lecture", hint: "Classes and teachings" },
  voice: { label: "Voice note", hint: "A memo, a call, a thought" },
};

export function formatMinutes(seconds: number) {
  const minutes = Math.max(0, Math.ceil(seconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function formatClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(remain).padStart(2, "0");
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${minutes}:${ss}`;
}

export function formatWhen(ts: number) {
  if (isToday(ts)) return formatDistanceToNowStrict(ts, { addSuffix: true });
  if (isYesterday(ts)) return "Yesterday";
  return format(ts, "d MMM yyyy");
}

export function defaultTitle(kind: SessionKind, date = new Date()) {
  return `${KIND_META[kind].label} · ${format(date, "d MMM, HH:mm")}`;
}

export function isDefaultTitle(title: string, kind: SessionKind) {
  return title === defaultTitle(kind, new Date(0)) || title.startsWith(`${KIND_META[kind].label} · `);
}

export function transcriptText(lines: TranscriptLine[]) {
  return lines
    .map((line) => (line.speaker ? `${line.speaker}: ${line.text}` : line.text))
    .join("\n");
}

export function notesToMarkdown(session: Session) {
  const notes = session.notes;
  const preset = OUTPUT_PRESETS[session.kind];
  const lines = [
    `# ${session.title}`,
    "",
    `*${KIND_META[session.kind].label} · ${format(session.createdAt, "d MMM yyyy, HH:mm")} · ${formatClock(session.durationSec)}*`,
    "",
  ];
  if (notes) {
    lines.push(`## ${preset.summaryLabel}`, "", notes.summary, "");
    if (notes.highlights.length) {
      lines.push(`## ${preset.highlightsLabel}`, "", ...notes.highlights.map((item) => `- ${item}`), "");
    }
    if (notes.decisions?.length) {
      lines.push(`## ${preset.decisionsLabel}`, "", ...notes.decisions.map((item) => `- ${item}`), "");
    }
    if (notes.actions.length) {
      lines.push(
        `## ${preset.actionsLabel}`,
        "",
        ...notes.actions.map((item) => `- [${item.done ? "x" : " "}] ${item.owner}: ${item.text}`),
        "",
      );
    }
    for (const section of notes.sections) {
      lines.push(`## ${section.heading}`, "", ...section.bullets.map((item) => `- ${item}`), "");
    }
  }
  if (session.scratch.trim()) {
    lines.push("## What you jotted", "", session.scratch.trim(), "");
  }
  if (session.transcript.length) {
    lines.push("## Spoken words", "");
    for (const line of session.transcript) {
      const stamp = formatClock(line.at);
      lines.push(line.speaker ? `**${line.speaker}** (${stamp}) ${line.text}` : `(${stamp}) ${line.text}`, "");
    }
  }
  return lines.join("\n");
}

export function notesLookEmpty(notes: SessionNotes | null) {
  if (!notes) return true;
  return !notes.summary && notes.highlights.length === 0 && notes.sections.length === 0;
}
