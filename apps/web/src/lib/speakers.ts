import type { TranscriptLine } from "./types";

export function speakerLabels(lines: TranscriptLine[]) {
  return [...new Set(lines.map((line) => line.speaker?.trim()).filter((value): value is string => Boolean(value)))];
}

export function renameSpeaker(lines: TranscriptLine[], from: string, to: string) {
  const next = to.trim();
  if (!next || next === from) return lines;
  return lines.map((line) => (line.speaker === from ? { ...line, speaker: next } : line));
}

export function hasDiarizedLines(lines: TranscriptLine[]) {
  return lines.some((line) => Boolean(line.speaker?.trim()) && !/^Speaker \d+$/.test(line.speaker?.trim() ?? ""));
}
