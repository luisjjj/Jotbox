import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { audioExtension, audioKeyFor, storageConfig } from "../server/api/storage.mjs";

const MANAGED = [
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_ACCOUNT_ID",
  "R2_ENDPOINT",
  "R2_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_ENDPOINT",
  "S3_REGION",
];
const original = new Map(MANAGED.map((name) => [name, process.env[name]]));

beforeEach(() => {
  for (const name of MANAGED) delete process.env[name];
});

afterEach(() => {
  for (const name of MANAGED) {
    const value = original.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("storageConfig stays off until a full backend is present", () => {
  assert.equal(storageConfig(), null);
  process.env.R2_BUCKET = "jotbox-audio";
  assert.equal(storageConfig(), null);
  process.env.R2_ACCESS_KEY_ID = "access";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
  assert.equal(storageConfig(), null);

  process.env.R2_ACCOUNT_ID = "account123";
  assert.deepEqual(storageConfig(), {
    bucket: "jotbox-audio",
    accessKeyId: "access",
    secretAccessKey: "secret",
    endpoint: "https://account123.r2.cloudflarestorage.com",
    region: "auto",
  });
});

test("an explicit endpoint wins and trailing slashes are dropped", () => {
  process.env.R2_BUCKET = "jotbox-audio";
  process.env.R2_ACCESS_KEY_ID = "access";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
  process.env.R2_ENDPOINT = "https://s3.eu-west-1.amazonaws.com/";
  process.env.R2_REGION = "eu-west-1";

  const config = storageConfig();
  assert.equal(config.endpoint, "https://s3.eu-west-1.amazonaws.com");
  assert.equal(config.region, "eu-west-1");
});

test("the S3 family works without an account id and R2 wins when both are set", () => {
  process.env.S3_BUCKET = "s3-bucket";
  process.env.S3_ACCESS_KEY_ID = "s3-access";
  process.env.S3_SECRET_ACCESS_KEY = "s3-secret";
  process.env.S3_ENDPOINT = "https://s3.example.com";
  assert.equal(storageConfig().bucket, "s3-bucket");

  process.env.R2_BUCKET = "r2-bucket";
  process.env.R2_ACCESS_KEY_ID = "r2-access";
  process.env.R2_SECRET_ACCESS_KEY = "r2-secret";
  process.env.R2_ACCOUNT_ID = "account123";
  assert.equal(storageConfig().bucket, "r2-bucket");
});

test("audio keys keep a safe extension", () => {
  assert.equal(audioExtension("audio/webm;codecs=opus"), "webm");
  assert.equal(audioExtension("audio/x-m4a"), "m4a");
  assert.equal(audioExtension(""), "bin");
  assert.equal(
    audioKeyFor("user-1", "capture-1", "audio/mpeg"),
    "audio/user-1/capture-1.mp3",
  );
});
