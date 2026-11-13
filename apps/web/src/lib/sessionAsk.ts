import { formatClock } from "./format";
import type { Session, SessionNotes, TranscriptLine } from "./types";

export interface AskTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AskResult {
  answer: string;
  provider: string;
}

const STOP = new Set(
  "the and for was were what when where why who how our your their did does with from that this have has had are but not you about into then than them they there been being all any can could should would will just over under after before between across happen happened please tell me about the a an is it to of in on at by as do i we he she".split(
    " ",
  ),
);

function termsFor(text: string) {
  return [...new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((word) => !STOP.has(word)))].slice(0, 12);
}

function notesText(notes: SessionNotes | null) {
  if (!notes) return [];
  return [
    notes.summary,
    ...notes.highlights,
    ...(notes.decisions ?? []),
    ...notes.actions.map((action) => `${action.owner}: ${action.text}`),
    ...notes.sections.flatMap((section) => [section.heading, ...section.bullets]),
  ].filter(Boolean);
}

function scoreLine(line: TranscriptLine, terms: string[]) {
  const haystack = `${line.speaker ?? ""} ${line.text}`.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

export function localAnswer(question: string, session: Pick<Session, "transcript" | "notes" | "scratch">): AskResult {
  const terms = termsFor(question);
  if (!terms.length) {
    return {
      answer: "Ask about a person, a decision, a number, or a moment in the session.",
      provider: "device",
    };
  }

  const ranked = session.transcript
    .map((line) => ({ line, score: scoreLine(line, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (ranked.length) {
    const quotes = ranked.map(({ line }) => {
      const speaker = line.speaker ? `${line.speaker}: ` : "";
      return `[${formatClock(line.at)}] ${speaker}${line.text}`;
    });
    return {
      answer: `This is what was said in this session:\n\n${quotes.join("\n\n")}`,
      provider: "device",
    };
  }

  const notes = notesText(session.notes);
  const scored = notes
    .map((text) => ({ text, score: terms.reduce((score, term) => score + (text.toLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  if (scored.length) {
    return {
      answer: `The written notes say:\n\n${scored.map((item) => `- ${item.text}`).join("\n")}`,
      provider: "device",
    };
  }

  const scratch = session.scratch.trim();
  if (scratch && terms.some((term) => scratch.toLowerCase().includes(term))) {
    return {
      answer: `Your jottings mention this:\n\n${scratch.slice(0, 900)}`,
      provider: "device",
    };
  }

  return {
    answer:
      "I could not find that in this capture. It may not have been said, or the live words may have missed it. Check the spoken words before you rely on it.",
    provider: "device",
  };
}

export async function askSession(input: {
  question: string;
  history: AskTurn[];
  session: Session;
}): Promise<AskResult> {
  const { question, history, session } = input;
  try {
    const response = await fetch("/api/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "ask",
        question,
        history: history.slice(-6),
        session: {
          title: session.title,
          kind: session.kind,
          scratch: session.scratch.slice(0, 8_000),
          notes: session.notes,
          transcript: session.transcript.map((line) => ({
            at: line.at,
            speaker: line.speaker,
            text: line.text,
          })),
        },
      }),
    });
    if (!response.ok) throw new Error("assist");
    const data = (await response.json()) as { answer?: string; provider?: string };
    const answer = (data.answer ?? "").trim();
    if (!answer) throw new Error("empty");
    return { answer, provider: data.provider || "studio" };
  } catch {
    return localAnswer(question, session);
  }
}
