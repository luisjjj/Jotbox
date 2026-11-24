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

test("free captures get labels and keyterms on every kind except voice", () => {
  for (const kind of ["meeting", "seminar", "lecture"]) {
    const route = routeTranscription({
      plan: "free",
      kind,
      glossary: ["Chinedu", "PTI"],
    });
    assert.equal(route.tier, "free");
    assert.equal(route.provider, "elevenlabs");
    assert.equal(route.model, "scribe_v3");
    assert.equal(route.diarize, true);
    assert.deepEqual(route.keyterms, ["Chinedu", "PTI"]);
    assert.equal(route.costPerHour, STT_PRICES["scribe-keyterms"]);
    assert.equal(route.fallback, false);
  }

  const voice = routeTranscription({
    plan: "free",
    kind: "voice",
    glossary: ["Chinedu", "PTI"],
  });
  assert.equal(voice.diarize, false);
  assert.deepEqual(voice.keyterms, ["Chinedu", "PTI"]);
  assert.equal(voice.costPerHour, STT_PRICES["scribe-keyterms"]);
});

test("pro lectures use Scribe with labels, and voice notes skip labels", () => {
  const lecture = routeTranscription({ plan: "pro", kind: "lecture" });
  assert.equal(lecture.mode, "lecture");
  assert.equal(lecture.provider, "elevenlabs");
  assert.equal(lecture.model, "scribe_v3");
  assert.equal(lecture.diarize, true);
  assert.deepEqual(lecture.keyterms, []);
  assert.equal(lecture.costPerHour, STT_PRICES.scribe);
  assert.equal(lecture.fallback, false);

  const voice = routeTranscription({ plan: "pro", kind: "voice" });
  assert.equal(voice.mode, "lecture");
  assert.equal(voice.diarize, false);
  assert.deepEqual(voice.keyterms, []);
  assert.equal(voice.costPerHour, STT_PRICES.scribe);
});

test("pro meetings and seminars use Scribe and both get speakers", () => {
  const meeting = routeTranscription({ plan: "pro", kind: "meeting", glossary: ["Chinedu"] });
  assert.equal(meeting.mode, "group");
  assert.equal(meeting.provider, "elevenlabs");
  assert.equal(meeting.model, "scribe_v3");
  assert.equal(meeting.diarize, true);
  assert.deepEqual(meeting.keyterms, ["Chinedu"]);
  assert.equal(meeting.costPerHour, STT_PRICES["scribe-keyterms"]);

  const seminar = routeTranscription({ plan: "pro", kind: "seminar", glossary: ["Chinedu"] });
  assert.equal(seminar.mode, "group");
  assert.equal(seminar.provider, "elevenlabs");
  assert.equal(seminar.diarize, true);
  assert.deepEqual(seminar.keyterms, ["Chinedu"]);
});

test("an explicit mode wins over the kind without moving off Scribe", () => {
  const route = routeTranscription({ plan: "pro", kind: "meeting", mode: "lecture" });
  assert.equal(route.mode, "lecture");
  assert.equal(route.provider, "elevenlabs");
  assert.equal(route.model, "scribe_v3");

  const bad = routeTranscription({ plan: "pro", kind: "lecture", mode: "anything" });
  assert.equal(bad.mode, "lecture");
});

test("enterprise sends the glossary keyterms and diarizes lectures too", () => {
  const lecture = routeTranscription({
    plan: "enterprise",
    kind: "lecture",
    glossary: ["  PTI  ", "pti", "A", "Chinedu\u0000", "Ọ̀rẹ́"],
  });
  assert.equal(lecture.tier, "enterprise");
  assert.equal(lecture.provider, "elevenlabs");
  assert.equal(lecture.diarize, true);
  assert.deepEqual(lecture.keyterms, ["PTI", "Chinedu", "Ọ̀rẹ́"]);
  assert.equal(lecture.costPerHour, STT_PRICES["scribe-keyterms"]);

  const meeting = routeTranscription({ plan: "enterprise", kind: "meeting", glossary: ["PTI"] });
  assert.equal(meeting.diarize, true);
  assert.deepEqual(meeting.keyterms, ["PTI"]);
});

test("the keyterms price applies only when a keyterm list is sent", () => {
  const plain = routeTranscription({ plan: "pro", kind: "meeting" });
  assert.equal(plain.costPerHour, STT_PRICES.scribe);
  assert.equal(plain.costKey, "scribe");

  const boosted = routeTranscription({ plan: "free", kind: "meeting", glossary: ["Chinedu"] });
  assert.equal(boosted.costPerHour, STT_PRICES["scribe-keyterms"]);
  assert.equal(boosted.costKey, "scribe-keyterms");
});

test("Igbo goes to Scribe first even when the self-hosted reader is configured", () => {
  const both = routeTranscription({ plan: "pro", kind: "meeting", language: "ig", available: { worker: true } });
  assert.equal(both.provider, "elevenlabs");
  assert.equal(both.diarize, true);
  assert.equal(both.costPerHour, STT_PRICES.scribe);

  const worker = routeTranscription({
    plan: "pro",
    kind: "meeting",
    language: "ig",
    available: { scribe: false, worker: true },
  });
  assert.equal(worker.provider, "worker");
  assert.equal(worker.costPerHour, 0);

  const free = routeTranscription({ plan: "free", kind: "lecture", language: "ig" });
  assert.equal(free.provider, "elevenlabs");
  assert.equal(free.diarize, true);
  assert.equal(free.costPerHour, STT_PRICES.scribe);
});

test("a missing provider falls back but keeps the intended rule visible", () => {
  const group = routeTranscription({ plan: "pro", kind: "meeting", available: { scribe: false } });
  assert.equal(group.provider, "groq");
  assert.equal(group.model, "whisper-large-v3");
  assert.equal(group.fallback, true);
  assert.equal(group.requestedProvider, "elevenlabs");

  const free = routeTranscription({ plan: "free", available: { scribe: false, groq: false, worker: true } });
  assert.equal(free.provider, "worker");
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

test("live captions use Scribe first and never ask for speakers", () => {
  const route = routeLiveTranscription();
  assert.equal(route.provider, "elevenlabs");
  assert.equal(route.model, "scribe_v3");
  assert.equal(route.diarize, false);
  assert.deepEqual(route.keyterms, []);
  assert.equal(route.costPerHour, STT_PRICES.scribe);
  assert.equal(route.fallback, false);

  const groq = routeLiveTranscription({ available: { scribe: false } });
  assert.equal(groq.provider, "groq");
  assert.equal(groq.model, "whisper-large-v3-turbo");
  assert.equal(groq.fallback, true);

  const worker = routeLiveTranscription({ available: { scribe: false, groq: false, worker: true } });
  assert.equal(worker.provider, "worker");

  const xai = routeLiveTranscription({ available: { scribe: false, groq: false, xai: true } });
  assert.equal(xai.provider, "xai");
  assert.equal(xai.fallback, true);

  const demo = routeLiveTranscription({ available: { scribe: false, groq: false, demo: true } });
  assert.equal(demo.provider, "demo");

  const none = routeLiveTranscription({ available: { scribe: false, groq: false } });
  assert.equal(none.provider, "none");
});

test("cost estimates follow the public hourly prices", () => {
  assert.equal(estimatedCost(3600, STT_PRICES.scribe), 0.2);
  assert.equal(estimatedCost(1500, STT_PRICES["groq-turbo"]), 0.0167);
  assert.equal(estimatedCost(25 * 3600, STT_PRICES["groq-large"]), 2.775);
  assert.equal(estimatedCost(-30, STT_PRICES.scribe), 0);
  assert.equal(estimatedCost(60, "free"), 0);
});
