import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildIntegrationAuthUrl,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  integrationEncryptionReady,
  jiraIssuePayload,
} from "../server/api/integrations.mjs";

const KEY_BASE64 = Buffer.alloc(32, 7).toString("base64");
const KEY_HEX = Buffer.alloc(32, 11).toString("hex");

test("OAuth tokens round trip through the encrypted payload", () => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY = KEY_BASE64;
  assert.equal(integrationEncryptionReady(), true);

  const payload = encryptIntegrationSecret("refresh-token-123");
  assert.match(payload, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(decryptIntegrationSecret(payload), "refresh-token-123");

  process.env.INTEGRATIONS_ENCRYPTION_KEY = KEY_HEX;
  const hexPayload = encryptIntegrationSecret("second-token");
  assert.equal(decryptIntegrationSecret(hexPayload), "second-token");
  process.env.INTEGRATIONS_ENCRYPTION_KEY = KEY_BASE64;
});

test("a tampered or re-versioned payload is rejected", () => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY = KEY_BASE64;
  const payload = encryptIntegrationSecret("access-token");
  const [version, iv, tag, data] = payload.split(".");
  const index = Math.floor(data.length / 2);
  const flipped = `${data.slice(0, index)}${data[index] === "A" ? "B" : "A"}${data.slice(index + 1)}`;

  assert.throws(() => decryptIntegrationSecret(`${version}.${iv}.${tag}.${flipped}`));
  assert.throws(() => decryptIntegrationSecret(`v2.${iv}.${tag}.${data}`));
  assert.throws(() => decryptIntegrationSecret("not-a-payload"));
});

test("a missing or wrong-sized key disables integrations", () => {
  delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
  assert.equal(integrationEncryptionReady(), false);
  assert.throws(() => encryptIntegrationSecret("token"));

  process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
  assert.equal(integrationEncryptionReady(), false);
  assert.throws(() => encryptIntegrationSecret("token"));

  process.env.INTEGRATIONS_ENCRYPTION_KEY = KEY_BASE64;
});

test("Google auth URLs carry the redirect, scopes, and state", () => {
  process.env.JOTBOX_PUBLIC_URL = "https://example.test";
  process.env.GOOGLE_CLIENT_ID = "google-client";
  process.env.GOOGLE_CLIENT_SECRET = "google-secret";

  const url = new URL(buildIntegrationAuthUrl("google", "state-123"));
  assert.equal(`${url.origin}${url.pathname}`, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), "google-client");
  assert.equal(url.searchParams.get("redirect_uri"), "https://example.test/api/integrations/google/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "state-123");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.match(url.searchParams.get("scope") || "", /calendar\.readonly/);
});

test("unconfigured providers fail with a setup message", () => {
  process.env.JOTBOX_PUBLIC_URL = "https://example.test";
  delete process.env.ATLASSIAN_CLIENT_ID;
  delete process.env.ATLASSIAN_CLIENT_SECRET;
  delete process.env.MICROSOFT_CLIENT_ID;
  delete process.env.MICROSOFT_CLIENT_SECRET;

  assert.throws(() => buildIntegrationAuthUrl("jira", "state"), /not configured/);
  assert.throws(() => buildIntegrationAuthUrl("outlook", "state"), /not configured/);
});

test("Jira issues use ADF and carry the action, owner, and session context", () => {
  process.env.JOTBOX_PUBLIC_URL = "https://example.test";
  const payload = jiraIssuePayload({
    action: { id: "a1", text: "Send the signed contract to Ada", owner: "Tunde", done: false },
    session: { id: "s1", title: "Kickoff with Lagos team", notes: { summary: "We agreed to start on Monday." } },
    projectKey: "OPS",
    issueType: "Task",
  });

  assert.equal(payload.fields.project.key, "OPS");
  assert.equal(payload.fields.summary, "Send the signed contract to Ada");
  assert.equal(payload.fields.issuetype.name, "Task");
  assert.deepEqual(payload.fields.labels, ["jotbox"]);
  assert.equal(payload.fields.description.type, "doc");

  const text = payload.fields.description.content
    .flatMap((block) => block.content.map((node) => node.text))
    .join("\n");
  assert.match(text, /Owner: Tunde/);
  assert.match(text, /Kickoff with Lagos team/);
  assert.match(text, /We agreed to start on Monday\./);
  assert.match(text, /https:\/\/example\.test\/session\/s1/);
});

test("Jira issues leave out context on request and cap long summaries", () => {
  const payload = jiraIssuePayload({
    action: { id: "a2", text: "x".repeat(400), owner: "", done: false },
    session: { id: "s2", title: "Standup", notes: {} },
    projectKey: "ENG",
    issueType: "Bug",
    includeContext: false,
  });

  assert.equal(payload.fields.issuetype.name, "Bug");
  assert.equal(payload.fields.description.content.length, 1);
  assert.equal(payload.fields.summary.length, 240);
  assert.ok(payload.fields.summary.endsWith("…"));
});
