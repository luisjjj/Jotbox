import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  emailConfigured,
  sendEmail,
  sendFounderNoteEmail,
  sendReferralPartnerEmail,
  sendRenewalReminderEmail,
  sendWelcomeEmail,
} from "../server/api/email.mjs";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const originalLog = console.log;
let calls;

function respond(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
  process.env.SENDLY_API_KEY = "sendly_test_key";
  process.env.EMAIL_FROM = "JotBox <hello@jotbox.online>";
  process.env.JOTBOX_PUBLIC_URL = "https://www.jotbox.online";
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return respond(202, { id: "msg_1", accepted: 1, copied: 0, skipped: 0, status: "queued" });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
  for (const key of ["SENDLY_API_KEY", "EMAIL_FROM", "JOTBOX_PUBLIC_URL"]) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test("email is configured by the Sendly key only", () => {
  assert.equal(emailConfigured({ SENDLY_API_KEY: "sendly_live_abc" }), true);
  assert.equal(emailConfigured({ SENDLY_API_KEY: "  " }), false);
  assert.equal(emailConfigured({ RESEND_API_KEY: "re_old" }), false);
});

test("sendEmail posts the documented Sendly payload", async () => {
  const result = await sendEmail({
    to: "Ada@Example.com",
    subject: "Hello there",
    text: "Plain body",
    replyTo: "JotBox Founder <founder@jotbox.online>",
    idempotencyKey: "order-1043",
  });

  assert.equal(result.delivered, true);
  assert.equal(result.id, "msg_1");
  assert.equal(calls.length, 1);
  const { url, init, body } = calls[0];
  assert.equal(url, "https://api.sendlyai.com/v1/messages");
  assert.equal(init.headers.Authorization, "Bearer sendly_test_key");
  assert.equal(init.headers["Idempotency-Key"], "order-1043");
  assert.deepEqual(body.to, ["ada@example.com"]);
  assert.equal(body.from, "JotBox <hello@jotbox.online>");
  assert.equal(body.replyTo, "founder@jotbox.online");
  assert.equal(body.subject, "Hello there");
  assert.equal(body.text, "Plain body");
  assert.match(body.html, /Hello there/);
  assert.match(body.html, /apple-touch-icon\.png/);
  assert.match(body.html, /#181b18/);
  assert.equal(body.unsubscribe, undefined);
});

test("a suppressed recipient is not reported as delivered", async () => {
  globalThis.fetch = async () =>
    respond(202, { id: "msg_2", accepted: 0, copied: 0, skipped: 1, status: "skipped" });
  const result = await sendEmail({ to: "gone@example.com", subject: "Hi", text: "Body" });
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "suppressed");
});

test("a provider refusal is reported, not swallowed", async () => {
  globalThis.fetch = async () => respond(402, { message: "Out of credit" });
  const result = await sendEmail({ to: "ada@example.com", subject: "Hi", text: "Body" });
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "provider");
  assert.equal(result.status, 402);
});

test("missing recipient and missing key are safe no-ops", async () => {
  const noRecipient = await sendEmail({ to: "  ", subject: "Hi", text: "Body" });
  assert.equal(noRecipient.delivered, false);
  assert.equal(noRecipient.reason, "no_recipient");
  assert.equal(calls.length, 0);

  delete process.env.SENDLY_API_KEY;
  console.log = () => {};
  const preview = await sendEmail({ to: "ada@example.com", subject: "Hi", text: "Body" });
  assert.equal(preview.delivered, false);
  assert.equal(preview.reason, "not_configured");
  assert.equal(preview.preview, true);
  assert.equal(calls.length, 0);
});

test("partner invite carries both links and the commission share", async () => {
  const result = await sendReferralPartnerEmail({
    to: "cephas@example.com",
    name: "Cephas Omorogbe",
    referralUrl: "https://www.jotbox.online/r/cephas",
    dashboardUrl: "https://www.jotbox.online/partner/token123",
    commissionPercent: 20,
  });

  assert.equal(result.delivered, true);
  const { body } = calls[0];
  assert.equal(body.subject, "Cephas Omorogbe, your JotBox partner dashboard");
  assert.match(body.text, /Hi Cephas Omorogbe/);
  assert.match(body.text, /https:\/\/www\.jotbox\.online\/r\/cephas/);
  assert.match(body.text, /https:\/\/www\.jotbox\.online\/partner\/token123/);
  assert.match(body.text, /20% of every Pro payment/);
  assert.match(body.html, /Open your dashboard/);
  assert.match(body.html, /apple-touch-icon\.png/);
});

test("renewal reminder names the date, the charge and the period key", async () => {
  const result = await sendRenewalReminderEmail(
    { id: "user-1", email: "ada@example.com", name: "Ada Lovelace" },
    { amount: 800_000, currency: "NGN", nextPaymentAt: "2026-12-01T10:00:00.000Z" },
  );

  assert.equal(result.delivered, true);
  const { init, body } = calls[0];
  assert.equal(init.headers["Idempotency-Key"], `renewal-user-1-${new Date("2026-12-01T10:00:00.000Z").getTime()}`);
  assert.match(body.subject, /Ada Lovelace, JotBox Pro renews on 1 December 2026/);
  assert.match(body.text, /Hi Ada Lovelace/);
  assert.match(body.text, /8,000/);
  assert.match(body.text, /cancel before 1 December 2026/);
  assert.match(body.html, /Manage your plan/);
});

test("founder note is personal, mentions usage and sets reply-to", async () => {
  const result = await sendFounderNoteEmail({
    to: "ada@example.com",
    name: "Ada Lovelace",
    sessions: 3,
    callUrl: "https://cal.com/jotbox",
    replyTo: "founder@jotbox.online",
    founderName: "Luis",
  });

  assert.equal(result.delivered, true);
  const { init, body } = calls[0];
  assert.match(init.headers["Idempotency-Key"], /^founder-ada_example_com-[0-9a-f]{16}$/);
  assert.equal(body.replyTo, "founder@jotbox.online");
  assert.equal(body.from, "Luis from JotBox <hello@jotbox.online>");
  assert.equal(body.subject, "A quick note from Luis");
  assert.match(body.text, /Hi Ada Lovelace/);
  assert.match(body.text, /I am Luis, the founder of JotBox/);
  assert.match(body.text, /3 sessions/);
  assert.match(body.text, /https:\/\/cal\.com\/jotbox/);
  assert.match(body.text, /Luis\nFounder, JotBox/);
  assert.match(body.html, /A note from Luis/);
});

test("welcome email addresses the person by their full name", async () => {
  const result = await sendWelcomeEmail({ email: "ada.lovelace@example.com", name: "" });
  assert.equal(result.delivered, true);
  const { body } = calls[0];
  assert.equal(body.subject, "Ada Lovelace, your JotBox account is ready");
  assert.match(body.text, /Hi Ada Lovelace/);
  assert.match(body.html, /Welcome, Ada Lovelace\./);
  assert.match(body.html, /apple-touch-icon\.png/);
});
