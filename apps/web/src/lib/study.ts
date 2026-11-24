import type { StudyItem } from "./api";
import type { Session, SessionNotes } from "./types";

function sharedBy(item: StudyItem) {
  const author = item.authorName.trim() || "a classmate";
  const group = item.groupName.trim() ? ` in ${item.groupName}` : "";
  return `${author}${group}`;
}

function notesFromItem(item: StudyItem): SessionNotes {
  const payload = item.payload;

  if (payload.kind === "note") return payload.notes;

  if (payload.kind === "quiz") {
    return {
      summary: `A quiz shared by ${sharedBy(item)}. The answers are written in, so you can check yourself.`,
      highlights: [],
      actions: [],
      source: "browser",
      sections: payload.questions.map((question, index) => ({
        heading: `${index + 1}. ${question.question}`,
        bullets: [
          ...question.options.map((option, optionIndex) => `${"ABCD"[optionIndex]}. ${option}`),
          `Answer: ${"ABCD"[question.answer] ?? ""}${question.explanation ? ` (${question.explanation})` : ""}`,
        ],
      })),
    };
  }

  return {
    summary: `Flashcards shared by ${sharedBy(item)}. The prompt and the answer sit together so you can read them back.`,
    highlights: [],
    actions: [],
    source: "browser",
    sections: payload.cards.map((card, index) => ({
      heading: `Card ${index + 1}: ${card.front}`,
      bullets: [card.back],
    })),
  };
}

/**
 * Turn a shared study item into a local note. The copy is a snapshot: the
 * original item can be deleted or changed without touching this note.
 */
export function studyItemToSession(item: StudyItem): Session {
  return {
    id: crypto.randomUUID(),
    title: item.title.trim() || "Shared study set",
    kind: item.sourceKind || "seminar",
    createdAt: Date.now(),
    durationSec: 0,
    status: "ready",
    scratch: "",
    transcript: [],
    notes: notesFromItem(item),
    hasAudio: false,
  };
}
