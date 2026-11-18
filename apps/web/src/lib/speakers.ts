import type { Participant, SessionNotes, TranscriptLine } from "./types";

export interface SpeakerMatch {
  speaker: string;
  name: string;
  confidence: "high" | "low";
  quote: string;
}

export function speakerLabels(lines: TranscriptLine[]) {
  return [...new Set(lines.map((line) => line.speaker?.trim()).filter((value): value is string => Boolean(value)))];
}

export function unlabeledSpeakers(lines: TranscriptLine[]) {
  return speakerLabels(lines).filter((label) => /^Speaker \d+$/i.test(label));
}

export function renameSpeaker(lines: TranscriptLine[], from: string, to: string) {
  const next = to.trim();
  if (!next || next === from) return lines;
  return lines.map((line) => (line.speaker === from ? { ...line, speaker: next } : line));
}

export function keepMatches(lines: TranscriptLine[], people: Participant[], matches: SpeakerMatch[]) {
  const labels = new Map(unlabeledSpeakers(lines).map((label) => [label.toLowerCase(), label]));
  const names = new Map(people.map((person) => [person.name.trim().toLowerCase(), person.name.trim()]));
  const usedNames = new Set(
    speakerLabels(lines)
      .filter((label) => !/^Speaker \d+$/i.test(label))
      .map((label) => label.toLowerCase()),
  );
  const usedSpeakers = new Set<string>();
  const kept: SpeakerMatch[] = [];

  for (const match of matches) {
    const speaker = labels.get(match.speaker.trim().toLowerCase());
    const name = names.get(match.name.trim().toLowerCase());
    if (!speaker || !name) continue;
    if (usedSpeakers.has(speaker) || usedNames.has(name.toLowerCase())) continue;
    usedSpeakers.add(speaker);
    usedNames.add(name.toLowerCase());
    kept.push({ ...match, speaker, name });
  }
  return kept;
}

function swapName(value: string, from: string, to: string) {
  const pattern = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  return value.replace(pattern, () => to);
}

export function renameSpeakerInNotes(notes: SessionNotes | null, from: string, to: string) {
  const next = to.trim();
  if (!notes || !next || next === from) return notes;
  const swap = (value: string) => swapName(value, from, next);
  return {
    ...notes,
    summary: swap(notes.summary),
    highlights: notes.highlights.map(swap),
    decisions: notes.decisions?.map(swap),
    actions: notes.actions.map((action) => ({
      ...action,
      owner: action.owner === from ? next : action.owner,
      text: swap(action.text),
    })),
    sections: notes.sections.map((section) => ({
      heading: swap(section.heading),
      bullets: section.bullets.map(swap),
    })),
  };
}

export function hasDiarizedLines(lines: TranscriptLine[]) {
  return lines.some((line) => Boolean(line.speaker?.trim()) && !/^Speaker \d+$/.test(line.speaker?.trim() ?? ""));
}
