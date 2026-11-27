import type { SessionKind } from "./types";

export interface OutputPreset {
  summaryLabel: string;
  highlightsLabel: string;
  decisionsLabel: string;
  blockersLabel: string;
  actionsLabel: string;
  followUpsLabel: string;
  emptyHint: string;
  followUpSubject: string;
  suggestions: string[];
  // One click from the recipe row sends this to the session chat, so the
  // wording follows the room instead of sounding like a generic assistant.
  explainQuestion: string;
}

export const OUTPUT_PRESETS: Record<SessionKind, OutputPreset> = {
  meeting: {
    summaryLabel: "Summary",
    highlightsLabel: "Key points",
    decisionsLabel: "Decisions",
    blockersLabel: "Blockers",
    actionsLabel: "Action items",
    followUpsLabel: "Drafts to send",
    emptyHint: "Record a meeting and JotBox will write the decisions, owners, and open actions.",
    followUpSubject: "Recap and next steps",
    suggestions: [
      "What did we decide?",
      "Who owns the follow-up?",
      "What is still open?",
    ],
    explainQuestion: "Explain this meeting simply, as if I missed it.",
  },
  seminar: {
    summaryLabel: "Summary",
    highlightsLabel: "Ideas worth keeping",
    decisionsLabel: "Agreements",
    blockersLabel: "Open questions",
    actionsLabel: "Follow-ups",
    followUpsLabel: "Drafts to send",
    emptyHint: "Record a seminar and JotBox will keep the arguments, questions, and follow-ups.",
    followUpSubject: "Seminar recap",
    suggestions: [
      "What was the main argument?",
      "Which questions were left open?",
      "What should I follow up on?",
    ],
    explainQuestion: "Explain the main argument of this seminar simply.",
  },
  lecture: {
    summaryLabel: "In short",
    highlightsLabel: "What was taught",
    decisionsLabel: "Key definitions",
    blockersLabel: "Still unclear",
    actionsLabel: "Study tasks",
    followUpsLabel: "Drafts to send",
    emptyHint: "Record a lecture and JotBox will keep the concepts, definitions, and study pointers.",
    followUpSubject: "Lecture recap",
    suggestions: [
      "What did the lecturer define?",
      "What did they say about the exam?",
      "Explain the main idea simply.",
    ],
    explainQuestion: "Explain the key ideas from this lecture simply, as if I am revising.",
  },
  voice: {
    summaryLabel: "The point",
    highlightsLabel: "What to remember",
    decisionsLabel: "Calls I made",
    blockersLabel: "What is in the way",
    actionsLabel: "Next moves",
    followUpsLabel: "Drafts to send",
    emptyHint: "Record a voice note and JotBox will keep the thought and the next move.",
    followUpSubject: "Voice note recap",
    suggestions: [
      "What was the main point?",
      "What did I say I would do?",
      "Give me a short recap.",
    ],
    explainQuestion: "Give me a simple recap of this note.",
  },
};
