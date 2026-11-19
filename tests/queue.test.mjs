import assert from "node:assert/strict";
import { test } from "node:test";
import { OVERAGE_GRACE_SECONDS, decideQuota, overLimitMessage } from "../server/api/quota.mjs";
import { chunkCapture, citationsFrom, fuseRanks } from "../server/api/memory-index.mjs";
import { audioKeyFor, presignAudio, retentionDays, storageConfigured } from "../server/api/storage.mjs";
import { linesFromWords } from "../server/api/jobs.mjs";

test("quota decisions count reserved time and keep the grace window", () => {
  const allowed = decideQuota({ usedSeconds: 1000, reservedSeconds: 500, limitSeconds: 3600, seconds: 2000 });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.remainingSeconds, 2100);

  const blocked = decideQuota({ usedSeconds: 3000, reservedSeconds: 500, limitSeconds: 3600, seconds: 200 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.requestedSeconds, 200);

  const grace = decideQuota({
    usedSeconds: 3600 - 5,
    reservedSeconds: 0,
    limitSeconds: 3600,
    seconds: OVERAGE_GRACE_SECONDS,
  });
  assert.equal(grace.allowed, true);
});

test("quota decisions clamp impossible input instead of going negative", () => {
  const decision = decideQuota({ usedSeconds: -300, reservedSeconds: "x", limitSeconds: 600, seconds: 99_999 });
  assert.equal(decision.usedSeconds, 0);
  assert.equal(decision.reservedSeconds, 0);
  assert.equal(decision.requestedSeconds, 4 * 3600);
  assert.equal(decision.allowed, false);
});

test("the Pro limit message is written in hours", () => {
  assert.match(overLimitMessage("pro", 25 * 3600, true), /25 hours/);
  assert.match(overLimitMessage("pro", 25 * 3600, false), /Pro listening time/);
  assert.match(overLimitMessage("free", 6000, true), /free listening minutes/);
  assert.match(overLimitMessage("enterprise", 1000 * 3600, true), /workspace/);
});

test("capture chunks follow speaker turns and keep timestamps", () => {
  const chunks = chunkCapture({
    transcript: [
      { text: "Morning everyone, we need to settle the rollout.", at: 5, speaker: "Ada" },
      { text: "I can own the migration.", at: 12, speaker: "Ada" },
      { text: "Make it Friday so support can prepare.", at: 20, speaker: "Bola" },
    ],
  });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].speaker, "Ada");
  assert.equal(chunks[0].startSec, 5);
  assert.ok(chunks[0].endSec >= 12);
  assert.equal(chunks[1].speaker, "Bola");
  assert.equal(chunks[1].startSec, 20);
  assert.deepEqual(chunks.map((chunk) => chunk.chunkIndex), [0, 1]);
});

test("capture chunks split long single lines and fall back to notes", () => {
  const long = `${"This sentence explains the decision. ".repeat(40)}`.trim();
  const split = chunkCapture({ transcript: [{ text: long, at: 0, speaker: "Ada" }] });
  assert.ok(split.length > 1);
  assert.ok(split.every((chunk) => chunk.text.length <= 900));

  const fromNotes = chunkCapture({ transcript: [], notes: { summary: "The team agreed to ship on Friday.", highlights: [] } });
  assert.equal(fromNotes.length, 1);
  assert.equal(fromNotes[0].speaker, "Notes");
  assert.match(fromNotes[0].text, /Friday/);
});

test("rank fusion rewards chunks found by both searches", () => {
  const lexical = [
    { id: "a", score: 0.9 },
    { id: "b", score: 0.5 },
  ];
  const vector = [
    { id: "b", score: 0.8 },
    { id: "c", score: 0.7 },
  ];
  const fused = fuseRanks(lexical, vector);
  assert.equal(fused[0].id, "b");
  assert.ok(fused[0].lexicalScore > 0 && fused[0].vectorScore > 0);
  assert.deepEqual(new Set(fused.map((item) => item.id)), new Set(["a", "b", "c"]));
});

test("citations dedupe moments and deep link to the second", () => {
  const source = new Map([
    ["cap-1", { title: "Rollout review", date: 1_760_000_000_000 }],
  ]);
  const citations = citationsFrom(
    [
      { captureId: "cap-1", speaker: "Ada", startSec: 92.4, text: "We ship on Friday." },
      { captureId: "cap-1", speaker: "Ada", startSec: 92.8, text: "Same moment." },
      { captureId: "missing", speaker: "Bola", startSec: 10, text: "No source." },
    ],
    source,
  );
  assert.equal(citations.length, 1);
  assert.equal(citations[0].title, "Rollout review");
  assert.equal(citations[0].href, "/session/cap-1?t=92");
});

test("audio keys are scoped by user and capture", () => {
  assert.equal(audioKeyFor("user-1", "cap-1", "audio/webm;codecs=opus"), "audio/user-1/cap-1.webm");
  assert.equal(audioKeyFor("user-1", "cap-1", "audio/mp4"), "audio/user-1/cap-1.m4a");
  assert.equal(audioKeyFor("user-1", "cap-1", "application/octet-stream"), "audio/user-1/cap-1.bin");
  assert.equal(retentionDays({}), 30);
  assert.equal(retentionDays({ JOTBOX_AUDIO_RETENTION_DAYS: "0" }), 0);
  assert.equal(retentionDays({ JOTBOX_AUDIO_RETENTION_DAYS: "9999" }), 3650);
});

test("presigning needs storage configuration and signs the object path", () => {
  const saved = {};
  const names = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"];
  for (const name of names) saved[name] = process.env[name];
  try {
    for (const name of names) delete process.env[name];
    assert.equal(storageConfigured(), false);
    assert.throws(() => presignAudio("audio/u/c.webm"), /not configured/);

    process.env.R2_ACCOUNT_ID = "acc123";
    process.env.R2_BUCKET = "jotbox-audio";
    process.env.R2_ACCESS_KEY_ID = "AKIATEST";
    process.env.R2_SECRET_ACCESS_KEY = "secret-test";
    assert.equal(storageConfigured(), true);
    const signed = presignAudio("audio/u/c.webm", 900);
    assert.match(signed.url, /^https:\/\/acc123\.r2\.cloudflarestorage\.com\/jotbox-audio\/audio\/u\/c\.webm\?/);
    assert.match(signed.url, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
    assert.match(signed.url, /X-Amz-Expires=900/);
    assert.match(signed.url, /X-Amz-Signature=[0-9a-f]{64}$/);
    assert.ok(signed.expiresAt > Date.now());
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test("job lines group words by speaker and pause", () => {
  const lines = linesFromWords(
    [
      { text: "We", start: 0, end: 0.2, speaker: 0 },
      { text: "ship", start: 0.3, end: 0.5, speaker: 0 },
      { text: "Friday.", start: 0.6, end: 1, speaker: 0 },
      { text: "I", start: 1.2, end: 1.3, speaker: 1 },
      { text: "agree.", start: 1.4, end: 1.8, speaker: 1 },
      { text: "Then", start: 5.5, end: 5.7, speaker: 1 },
      { text: "we", start: 5.8, end: 5.9, speaker: 1 },
      { text: "rest.", start: 6, end: 6.3, speaker: 1 },
    ],
  );
  assert.ok(lines.length >= 3);
  assert.equal(lines[0].text, "We ship Friday.");
  assert.equal(lines[0].speaker, "Speaker 1");
  assert.equal(lines[1].speaker, "Speaker 2");
  assert.equal(lines[1].text, "I agree.");

  const flat = linesFromWords([], "  Just a pasted note.  ");
  assert.equal(flat.length, 1);
  assert.equal(flat[0].text, "Just a pasted note.");
  assert.equal(flat[0].speaker, "Speaker 1");
});
