import assert from "node:assert/strict";
import test from "node:test";
import * as ai from "../server/api/ai.mjs";
import { isProfane, suppressProfanity } from "../server/api/profanity.mjs";

const word = (text, logprob) => ({ text, start: 0, end: 0.3, type: "word", ...(logprob !== undefined ? { logprob } : {}) });

test("live previews never show profanity", () => {
  const result = ai.normalizeTranscription(
    {
      text: "Fuck, that is the plan.",
      words: [word("Fuck,", -0.05), word("that"), word("is"), word("the"), word("plan.")],
    },
    "elevenlabs",
    { live: true },
  );

  assert.equal(result.text, "that is the plan.");
  assert.equal(result.words.length, 4);
});

test("the final transcript keeps a profanity the reader was confident about", () => {
  const result = ai.normalizeTranscription(
    {
      text: "That is a fucking mess.",
      words: [word("That"), word("is"), word("a"), word("fucking", -0.08), word("mess.")],
    },
    "elevenlabs",
  );

  assert.equal(result.text, "That is a fucking mess.");
  assert.equal(result.words.length, 5);
});

test("the final transcript drops a guessed profanity", () => {
  const result = ai.normalizeTranscription(
    {
      text: "The folder is fuck.",
      words: [word("The", -0.1), word("folder", -0.1), word("is", -0.1), word("fuck.", -1.4)],
    },
    "elevenlabs",
  );

  assert.equal(result.text, "The folder is.");
  assert.equal(result.words.length, 3);
});

test("a lone guessed profanity does not survive without confidence", () => {
  const result = ai.normalizeTranscription({ text: "Fuck.", words: [word("Fuck.")] }, "groq");

  assert.equal(result.text, "");
  assert.equal(result.words.length, 0);
});

test("a provider without confidence keeps real profanity in a sentence", () => {
  const result = ai.normalizeTranscription(
    { text: "I no go fuck this up.", words: [word("I"), word("no"), word("go"), word("fuck"), word("this"), word("up.")] },
    "groq",
  );

  assert.equal(result.text, "I no go fuck this up.");
});

test("profanity inside a longer word is left alone", () => {
  const result = ai.normalizeTranscription(
    { text: "The Scunthorpe report.", words: [word("The"), word("Scunthorpe"), word("report.")] },
    "groq",
  );

  assert.equal(result.text, "The Scunthorpe report.");
  assert.equal(isProfane("Scunthorpe"), false);
});

test("suppression tolerates punctuation around the word", () => {
  const result = suppressProfanity(
    {
      text: "Well, shit, that failed.",
      words: [word("Well,"), word("shit,", -1.2), word("that"), word("failed.")],
    },
    {},
  );

  assert.equal(result.text, "Well, that failed.");
});