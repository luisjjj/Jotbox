import assert from "node:assert/strict";
import { test } from "node:test";

import {
  correctNigerianText,
  correctNigerianTranscript,
  correctNigerianWords,
} from "../server/api/nigerian-corrections.mjs";

test("fixes the name variants that the Nigerian bench exposed", () => {
  assert.equal(
    correctNigerianText("she don come again con dey beg wey skit for", "pcm"),
    "she don come again con dey beg Wizkid for",
  );
  assert.equal(correctNigerianText("according to Paul Uppwide", "en"), "according to Paul Arkwright");
  assert.equal(correctNigerianText("storms in Aquafu", "en"), "storms in Akpawfu");
  assert.equal(correctNigerianText("the shift shaft song", "en"), "the Chiffchaff song");
  assert.equal(correctNigerianText("flight from Campor to Munich", "en"), "flight from Kanpur to Munich");
  assert.equal(correctNigerianText("according to obi annu dumont", "pcm"), "according to Obiano");
  assert.equal(correctNigerianText("the ejurutu people", "en"), "the Eburutu people");
});

test("leaves Pidgin register and ambiguous names alone", () => {
  assert.equal(correctNigerianText("dem say money dey", "pcm"), "dem say money dey");
  assert.equal(correctNigerianText("from campo to Munich", "en"), "from campo to Munich");
  assert.equal(correctNigerianText("Ogbe said", "en"), "Ogbe said");
  assert.equal(correctNigerianText("Wizkid sang", "en"), "Wizkid sang");
});

test("does not touch other languages", () => {
  const text = "wey skit and uppwide";
  assert.equal(correctNigerianText(text, "yo"), text);
  assert.equal(correctNigerianText(text, "ha"), text);
  assert.equal(correctNigerianText(text, "ig"), text);
  assert.equal(correctNigerianText(text, ""), text);
});

test("keeps word timing, speaker and trailing punctuation", () => {
  const words = [
    { text: "she", start: 0, end: 0.2, speaker: 0 },
    { text: "beg", start: 0.2, end: 0.4, speaker: 0 },
    { text: "wey", start: 0.4, end: 0.6, speaker: 0 },
    { text: "skit,", start: 0.6, end: 0.9, speaker: 0 },
    { text: "for", start: 0.9, end: 1.1, speaker: 0 },
  ];
  const corrected = correctNigerianWords(words, "pcm");
  assert.deepEqual(corrected, [
    { text: "she", start: 0, end: 0.2, speaker: 0 },
    { text: "beg", start: 0.2, end: 0.4, speaker: 0 },
    { text: "Wizkid,", start: 0.4, end: 0.9, speaker: 0 },
    { text: "for", start: 0.9, end: 1.1, speaker: 0 },
  ]);
});

test("corrects text and words together", () => {
  const result = correctNigerianTranscript(
    {
      text: "the shift shaft song",
      words: [
        { text: "the", start: 0, end: 0.2 },
        { text: "shift", start: 0.2, end: 0.4 },
        { text: "shaft", start: 0.4, end: 0.6 },
        { text: "song", start: 0.6, end: 0.8 },
      ],
      filtered: 0,
    },
    "en",
  );
  assert.equal(result.text, "the Chiffchaff song");
  assert.deepEqual(
    result.words.map((word) => word.text),
    ["the", "Chiffchaff", "song"],
  );
  assert.equal(result.words[1].start, 0.2);
  assert.equal(result.words[1].end, 0.6);
  assert.equal(result.filtered, 0);
});
