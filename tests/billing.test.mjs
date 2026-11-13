import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  billingConfig,
  isEntitled,
  subscriptionView,
  verifyWebhookSignature,
} from "../server/api/billing.mjs";

test("Pro defaults to $7 converted into Naira kobo", () => {
  const config = billingConfig({});
  assert.equal(config.usd, 7);
  assert.equal(config.ngnPerUsd, 1600);
  assert.equal(config.naira, 11_200);
  assert.equal(config.amountKobo, 1_120_000);
  assert.equal(config.currency, "NGN");
  assert.equal(config.interval, "monthly");
  assert.equal(config.configured, false);
});

test("Naira amount and rate can be set without changing the plan currency", () => {
  const config = billingConfig({
    PAYSTACK_SECRET_KEY: "sk_test_example",
    PAYSTACK_PRO_AMOUNT_NGN: "9500",
    JOTBOX_USD_TO_NGN: "1500",
    PAYSTACK_PLAN_CODE: "PLN_existing",
  });
  assert.equal(config.naira, 9_500);
  assert.equal(config.amountKobo, 950_000);
  assert.equal(config.ngnPerUsd, 1_500);
  assert.equal(config.planCode, "PLN_existing");
  assert.equal(config.configured, true);
});

test("blank or broken pricing env falls back instead of charging zero", () => {
  const config = billingConfig({
    PAYSTACK_PRO_AMOUNT_NGN: "",
    JOTBOX_USD_TO_NGN: "not-a-number",
  });
  assert.equal(config.naira, 11_200);
  assert.equal(config.amountKobo, 1_120_000);
});

test("webhook signatures use the raw body and reject tampering", () => {
  const secret = "sk_test_secret";
  const raw = Buffer.from(JSON.stringify({ event: "charge.success", data: { id: 1 } }));
  const signature = createHmac("sha512", secret).update(raw).digest("hex");

  assert.equal(verifyWebhookSignature(raw, signature, secret), true);
  assert.equal(verifyWebhookSignature(Buffer.from(`${raw.toString()} `), signature, secret), false);
  assert.equal(verifyWebhookSignature(raw, "deadbeef", secret), false);
  assert.equal(verifyWebhookSignature(raw, "", secret), false);
  assert.equal(verifyWebhookSignature(raw, signature, ""), false);
});

test("paid statuses keep Pro, and a cancelled plan keeps the paid period", () => {
  assert.equal(isEntitled(null), false);
  assert.equal(isEntitled({ status: "active" }), true);
  assert.equal(isEntitled({ status: "attention" }), true);
  assert.equal(isEntitled({ status: "non-renewing" }), true);
  assert.equal(isEntitled({ status: "completed" }), false);
  assert.equal(
    isEntitled({ status: "cancelled", next_payment_at: "2026-12-01T00:00:00.000Z" }, Date.parse("2026-11-13")),
    true,
  );
  assert.equal(
    isEntitled({ status: "cancelled", next_payment_at: "2026-11-01T00:00:00.000Z" }, Date.parse("2026-11-13")),
    false,
  );
});

test("subscription view turns database rows into client-safe values", () => {
  const view = subscriptionView({
    plan_key: "pro",
    status: "active",
    currency: "NGN",
    amount: 1_120_000,
    interval: "monthly",
    next_payment_at: "2026-12-13T00:00:00.000Z",
    started_at: "2026-11-13T00:00:00.000Z",
    cancelled_at: null,
  });
  assert.equal(view.planKey, "pro");
  assert.equal(view.amount, 1_120_000);
  assert.equal(view.nextPaymentAt, Date.parse("2026-12-13T00:00:00.000Z"));
  assert.equal(view.cancelledAt, null);
  assert.equal(subscriptionView(null), null);
});
