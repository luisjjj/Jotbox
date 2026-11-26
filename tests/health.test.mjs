import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

const MANAGED = [
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "ELEVENLABS_API_KEY",
  "WHISPER_BASE_URL",
  "WHISPER_API_KEY",
  "JOTBOX_AI_MOCK",
  "VERCEL",
];
const original = new Map(MANAGED.map((name) => [name, process.env[name]]));

function resetEnv() {
  for (const name of MANAGED) {
    const value = original.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

beforeEach(() => {
  for (const name of MANAGED) delete process.env[name];
});
afterEach(resetEnv);

const { handleHealth } = await import("../server/api/health.mjs");

async function health(url) {
  const headers = {};
  const res = {
    statusCode: 0,
    payload: "",
    setHeader(name, value) {
      headers[name] = value;
    },
    end(payload) {
      this.payload = payload;
    },
  };
  await handleHealth({ method: "GET", url }, res);
  return { status: res.statusCode, headers, body: JSON.parse(res.payload) };
}

test("fast health reports AI without a database round trip", async () => {
  process.env.GROQ_API_KEY = "test-key";
  const { status, headers, body } = await health("/api/health?fast=1");

  assert.equal(status, 200);
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(body.db, null);
  assert.equal(body.ai, true);
  assert.equal(body.reading, "groq");
  assert.equal(body.writing, "groq");
});

test("fast health still reports when nothing is configured", async () => {
  const { body } = await health("/api/health?fast=1");

  assert.equal(body.ai, false);
  assert.equal(body.reading, null);
  assert.equal(body.writing, null);
});
