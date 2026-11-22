import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STT_PRICES,
  estimatedCost,
  modeForKind,
  normalizePlan,
  routeLiveTranscription,
  routeTranscription,
} from "../server/api/stt-router.mjs";

test("unknown plans fall back to free and kinds map to a recording mode", () => {
  assert.equal(normalizePlan("pro"), "pro");
  assert.equal(normalizePlan("enterprise"), "enterprise");
  assert.equal(normalizePlan("team"), "free");
  assert.equal(normalizePlan(undefined), "free");

  assert.equal(modeForKind("meeting"), "group");
  assert.equal(modeForKind("seminar"), "group");
  assert.equal(modeForKind("lecture"), "lecture");
  assert.equal(modeForKind("voice"), "lecture");
});

test("free captures always run on Groq turbo without keyterms or speakers", () => {
  const route = routeTranscription({
    plan: "free",
    kind: "meeting",
    glossary: ["Chinedu", "PTI"],
  });
  assert.equal(route.tier, "free");
  assert.equal(route.provider, "groq");
  assert.equal(route.model, "whisper-large-v3-turbo");
  assert.equal(route.prompt, "language");
  assert.equal(route.diarize, false);
  assert.deepEqual(route.keyterms, []);
  assert.equal(route.costPerHour, STT_PRICES["groq-turbo"]);
  assert.equal(route.fallback, false);
});

test("pro lectures use Groq large with the personal glossary prompt", () => {
  const route = routeTranscription({ plan: "pro", kind: "lecture" });
  assert.equal(route.mode, "lecture");
  assert.equal(route.provider, "groq");
  assert.equal(route.model, "whisper-large-v3");
  assert.equal(route.prompt, "glossary");
  assert.equal(route.diarize, false);
  assert.deepEqual(route.keyterms, []);
  assert.equal(route.costPerHour, STT_PRICES["groq-large"]);
});

test("pro voice notes stay in the lecture lane", () => {
  const route = routeTranscription({ plan: "pro", kind: "voice" });
  assert.equal(route.mode, "lecture");
  assert.equal(route.provider, "groq");
  assert.equal(route.model, "whisper-large-v3");
});

test("pro group meetings use Scribe with speakers and no paid keyterms", () => {
  for (const kind of ["meeting", "seminar"]) {
    const route = routeTranscription({ plan: "pro", kind, glossary: ["Chinedu"] });
    assert.equal(route.mode, "group");
    assert.equal(route.provider, "elevenlabs");
    assert.equal(route.model, "scribe_v3");
    assert.equal(route.diarize, true);
    assert.deepEqual(route.keyterms, []);
    assert.equal(route.costPerHour, STT_PRICES.scribe);
  }
});

test("an explicit mode wins over the kind", () => {
  const route = routeTranscription({ plan: "pro", kind: "meeting", mode: "lecture" });
  assert.equal(route.mode, "lecture");
  assert.equal(route.provider, "groq");
  assert.equal(route.model, "whisper-large-v3");

  const bad = routeTranscription({ plan: "pro", kind: "lecture", mode: "anything" });
  assert.equal(bad.mode, "lecture");
});

test("enterprise uses Scribe with speakers and cleaned glossary keyterms", () => {
  const route = routeTranscription({
    plan: "enterprise",
    kind: "lecture",
    glossary: ["  PTI  ", "pti", "A", "Chinedu\u0000", "Ọ̀rẹ́"],
  });
  assert.equal(route.tier, "enterprise");
  assert.equal(route.provider, "elevenlabs");
  assert.equal(route.diarize, true);
  assert.deepEqual(route.keyterms, ["PTI", "Chinedu", "Ọ̀rẹ́"]);
  assert.equal(route.costPerHour, STT_PRICES["scribe-keyterms"]);
});

test("Igbo prefers the self-hosted reader, then Scribe", () => {
  const worker = routeTranscription({ plan: "pro", kind: "meeting", language: "ig", available: { worker: true } });
  assert.equal(worker.provider, "worker");
  assert.equal(worker.costPerHour, 0);

  const scribe = routeTranscription({ plan: "pro", kind: "meeting", language: "ig" });
  assert.equal(scribe.provider, "elevenlabs");
  assert.equal(scribe.diarize, true);
  assert.equal(scribe.costPerHour, STT_PRICES.scribe);

  const free = routeTranscription({ plan: "free", kind: "lecture", language: "ig" });
  assert.equal(free.provider, "elevenlabs");
  assert.equal(free.diarize, false);
  assert.equal(free.costPerHour, STT_PRICES.scribe);
});

test("a missing provider falls back but keeps the intended rule visible", () => {
  const group = routeTranscription({ plan: "pro", kind: "meeting", available: { scribe: false } });
  assert.equal(group.provider, "groq");
  assert.equal(group.model, "whisper-large-v3");
  assert.equal(group.fallback, true);
  assert.equal(group.requestedProvider, "elevenlabs");

  const free = routeTranscription({ plan: "free", available: { groq: false } });
  assert.equal(free.provider, "elevenlabs");
  assert.equal(free.diarize, false);
  assert.deepEqual(free.keyterms, []);
  assert.equal(free.fallback, true);

  const enterprise = routeTranscription({ plan: "enterprise", available: { scribe: false } });
  assert.equal(enterprise.provider, "groq");
  assert.equal(enterprise.fallback, true);
  assert.equal(enterprise.requestedProvider, "elevenlabs");
});

test("nothing configured returns a none route instead of throwing", () => {
  const route = routeTranscription({ plan: "free", available: { groq: false, scribe: false } });
  assert.equal(route.provider, "none");
  assert.equal(route.costPerHour, 0);
  assert.equal(route.fallback, true);
});

test("live captions always stay on the cheapest reader", () => {
  const route = routeLiveTranscription();
  assert.equal(route.provider, "groq");
  assert.equal(route.model, "whisper-large-v3-turbo");
  assert.equal(route.diarize, false);
  assert.deepEqual(route.keyterms, []);
  assert.equal(route.costPerHour, STT_PRICES["groq-turbo"]);

  const fallback = routeLiveTranscription({ available: { groq: false } });
  assert.equal(fallback.provider, "elevenlabs");
  assert.equal(fallback.diarize, false);
  assert.deepEqual(fallback.keyterms, []);
});

test("cost estimates follow the public hourly prices", () => {
  assert.equal(estimatedCost(3600, STT_PRICES.scribe), 0.22);
  assert.equal(estimatedCost(1500, STT_PRICES["groq-turbo"]), 0.0167);
  assert.equal(estimatedCost(25 * 3600, STT_PRICES["groq-large"]), 2.775);
  assert.equal(estimatedCost(-30, STT_PRICES.scribe), 0);
  assert.equal(estimatedCost(60, "free"), 0);
});
