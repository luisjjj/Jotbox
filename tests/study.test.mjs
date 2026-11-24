import assert from "node:assert/strict";
import { test } from "node:test";
import { FREE_STUDY_GENERATIONS, makeGroupCode, studyQuota } from "../server/api/study.mjs";
import { normalizeCards, normalizeQuestions, studySourceText } from "../server/api/study-ai.mjs";

test("group codes are six characters without look-alike letters", () => {
  const code = makeGroupCode(() => 0);
  assert.equal(code, "AAAAAA");
  for (let index = 0; index < 40; index += 1) {
    const sample = makeGroupCode();
    assert.match(sample, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  }
});

test("free accounts get three sets a month and paid plans are uncapped", () => {
  assert.equal(FREE_STUDY_GENERATIONS, 3);

  assert.deepEqual(studyQuota({ plan: "free", used: 0 }), {
    plan: "free",
    limit: 3,
    used: 0,
    remaining: 3,
  });
  assert.equal(studyQuota({ plan: "free", used: 3 }).remaining, 0);
  assert.equal(studyQuota({ plan: "free", used: 9 }).remaining, 0);

  for (const plan of ["pro", "enterprise"]) {
    assert.deepEqual(studyQuota({ plan, used: 42 }), {
      plan,
      limit: null,
      used: 42,
      remaining: null,
    });
  }
});

test("quiz questions keep only well-formed four-option items", () => {
  const questions = normalizeQuestions({
    questions: [
      {
        question: "Which court hears the case?",
        options: ["High Court", "Magistrate Court", "Sharia Court", "Customary Court"],
        answer: 0,
        explanation: "The note names the High Court.",
      },
      { question: "Too few options", options: ["One", "Two"], answer: 0 },
      { question: "", options: ["A", "B", "C", "D"], answer: 0 },
      {
        question: "Out of range",
        options: ["A", "B", "C", "D"],
        answer: 7,
      },
      {
        question: "Repeated options",
        options: ["Same", "same", "C", "D"],
        answer: 0,
      },
    ],
  });
  assert.equal(questions.length, 1);
  assert.equal(questions[0].answer, 0);
  assert.equal(questions[0].options.length, 4);
});

test("flashcards keep only cards with both sides", () => {
  const cards = normalizeCards({
    cards: [
      { front: "Wetin be demurrage?", back: "Money paid when a container stays too long." },
      { front: "", back: "No prompt" },
      { front: "No answer", back: "" },
    ],
  });
  assert.equal(cards.length, 1);
  assert.match(cards[0].back, /container/);
});

test("the study source keeps Pidgin words and falls back to the transcript", () => {
  const capture = {
    notes: {
      summary: "Dem talk about how container go sit for port.",
      highlights: [],
      sections: [],
    },
    transcript: [
      { speaker: "Speaker 1", text: "The agent say make we pay demurrage before Friday." },
      { speaker: "Speaker 2", text: "No be small money o." },
    ],
  };
  const source = studySourceText(capture).replace(/\s+/g, " ");
  assert.match(source, /Dem talk about how container go sit for port/);
  assert.match(source, /pay demurrage before Friday/);
  assert.match(source, /No be small money o/);
});

test("a source with no words stays empty", () => {
  assert.equal(studySourceText({ notes: null, transcript: [] }), "");
});
