import type { ActionItem, SessionKind, SessionNotes, TranscriptLine } from "./types";

const STOP = new Set(
  "a an the and or but if to of in on for with at by from as is are was were be been being it this that these those i you we they he she them our your their not no so than then just about into over after before".split(
    " ",
  ),
);

const ACTION =
  /\b(i'll|i will|we'll|we will|let's|let us|please|need to|needs to|follow up|send|share|schedule|book|confirm|review|prepare|submit|email|call|finish|write|read|bring|make sure|by monday|by tuesday|by wednesday|by thursday|by friday|by tomorrow|next week)\b/i;

const DECISION =
  /\b(we agreed|we decided|we settled|the decision|decision is|make we|we go|no wahala|conclusion|final word|we will go with|we are going with)\b/i;

function sentencesFrom(lines: TranscriptLine[]) {
  return lines
    .map((line) => line.text.replace(/\s+/g, " ").trim())
    .join(" ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 24);
}

function scratchLines(scratch: string) {
  return scratch
    .split("\n")
    .map((line) => line.replace(/^(?:[-*•]+|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

function splitSpeaker(line: string) {
  const match = line.match(/^([A-Z][A-Za-z .'-]{1,24}):\s+(.+)$/);
  return match ? { owner: match[1].trim(), text: match[2].trim() } : null;
}

function joinSentences(parts: string[]) {
  const cleaned = parts.map((part) => part.trim().replace(/[.!?]+$/, "")).filter(Boolean);
  return cleaned.length ? `${cleaned.join(". ")}.` : "";
}

function ownerFrom(sentence: string, fromScratch: boolean) {
  if (fromScratch) return "You";
  const named = sentence.match(/^([A-Z][a-z]{2,})\b/);
  if (named && !STOP.has(named[1].toLowerCase()) && /\b(will|should|to)\b/i.test(sentence)) return named[1];
  if (/\b(i'll|i will|i need to)\b/i.test(sentence)) return "You";
  if (/\b(we'll|we will|let's|let us)\b/i.test(sentence)) return "Team";
  return "Unassigned";
}

function scoreSentences(sentences: string[]) {
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    for (const word of sentence.toLowerCase().split(/[^a-z0-9']+/)) {
      if (word.length < 4 || STOP.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return sentences
    .map((sentence) => {
      const words = sentence.toLowerCase().split(/[^a-z0-9']+/).filter((word) => word.length > 3 && !STOP.has(word));
      const frequency = words.reduce((total, word) => total + (counts.get(word) ?? 0), 0);
      const boost = /\d/.test(sentence) || /[A-Z][a-z]+/.test(sentence) ? 2 : 0;
      return { sentence, score: frequency / Math.sqrt(words.length || 1) + boost };
    })
    .sort((a, b) => b.score - a.score);
}

function headingFrom(sentence: string) {
  const body = splitSpeaker(sentence)?.text ?? sentence;
  const words = body.replace(/[.!?]+$/, "").split(/\s+/).slice(0, 6);
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function localNotes(input: {
  kind: SessionKind;
  scratch: string;
  lines: TranscriptLine[];
}): SessionNotes {
  const marked = scratchLines(input.scratch);
  const spoken = sentencesFrom(input.lines);
  const actions: ActionItem[] = [];
  const seen = new Set<string>();

  const pushAction = (text: string, fromScratch: boolean, owner?: string) => {
    const clean = text.replace(/\s+/g, " ").trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key) || actions.length >= 6) return;
    seen.add(key);
    actions.push({
      id: crypto.randomUUID(),
      text: clean.replace(/[.]+$/, ""),
      owner: owner ?? ownerFrom(clean, fromScratch),
      done: false,
    });
  };

  for (const line of marked) {
    if (!ACTION.test(line) && !/^(todo|action|follow)/i.test(line)) continue;
    const speaker = splitSpeaker(line);
    pushAction(speaker?.text ?? line, true, speaker?.owner);
  }
  for (const sentence of spoken) {
    if (!ACTION.test(sentence)) continue;
    const speaker = splitSpeaker(sentence);
    pushAction(speaker?.text ?? sentence, false, speaker?.owner);
  }

  const decisions: string[] = [];
  const decisionSeen = new Set<string>();
  for (const sentence of [...marked, ...spoken]) {
    if (!DECISION.test(sentence) || decisions.length >= 5) continue;
    const clean = sentence.replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
    const key = clean.toLowerCase();
    if (!clean || decisionSeen.has(key)) continue;
    decisionSeen.add(key);
    decisions.push(clean);
  }

  const ranked = scoreSentences(spoken);
  const highlights = (marked.length ? marked : ranked.map((item) => item.sentence)).slice(0, 5);

  let summary = "";
  if (marked.length && ranked[0]) {
    summary = joinSentences([...marked.slice(0, 2), ranked[0].sentence]);
  } else if (marked.length) {
    summary = joinSentences(marked.slice(0, 3));
  } else if (ranked.length) {
    summary = joinSentences(ranked.slice(0, 2).map((item) => item.sentence));
  } else {
    summary =
      input.kind === "voice"
        ? "The voice note was too short to shape into notes."
        : "Nothing clear was captured. Try the microphone again, or share the call tab and include its audio.";
  }

  const sections: { heading: string; bullets: string[] }[] = [];
  const pool = spoken.filter((sentence) => !highlights.includes(sentence));
  for (let index = 0; index < pool.length && sections.length < 4; index += 3) {
    const chunk = pool.slice(index, index + 3);
    if (!chunk.length) continue;
    sections.push({ heading: headingFrom(chunk[0]), bullets: chunk });
  }

  return {
    summary,
    highlights,
    decisions,
    actions: input.kind === "lecture" ? actions.slice(0, 4) : actions,
    sections,
    source: "browser",
  };
}
