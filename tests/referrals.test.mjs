import assert from "node:assert/strict";
import { test } from "node:test";
import { commissionFor, isReferralSlug, maskEmail } from "../server/api/referrals.mjs";

test("partner commission is 20% of a Pro payment in kobo", () => {
  assert.equal(commissionFor(800_000, 2000), 160_000);
  assert.equal(commissionFor(950_000, 2000), 190_000);
});

test("commission rounds to whole kobo and ignores empty values", () => {
  assert.equal(commissionFor(12_345, 2000), 2_469);
  assert.equal(commissionFor(0, 2000), 0);
  assert.equal(commissionFor(800_000, 0), 0);
  assert.equal(commissionFor(-5, 2000), 0);
  assert.equal(commissionFor(Number.NaN, 2000), 0);
});

test("a custom partner share is respected", () => {
  assert.equal(commissionFor(800_000, 2500), 200_000);
  assert.equal(commissionFor(800_000, 1000), 80_000);
});

test("referral slugs are short, lowercase, and link safe", () => {
  assert.equal(isReferralSlug("cephas"), true);
  assert.equal(isReferralSlug("  Cephas  "), true);
  assert.equal(isReferralSlug("cephas-01"), true);
  assert.equal(isReferralSlug("c"), false);
  assert.equal(isReferralSlug("cephas/extra"), false);
  assert.equal(isReferralSlug("cephas?x=1"), false);
  assert.equal(isReferralSlug("cephas%2F"), false);
  assert.equal(isReferralSlug(""), false);
});

test("partner dashboard masks customer emails", () => {
  assert.equal(maskEmail("student@example.com"), "s***@example.com");
  assert.equal(maskEmail("Cephas@Example.com"), "C***@Example.com");
  assert.equal(maskEmail("not-an-email"), "hidden");
  assert.equal(maskEmail(""), "hidden");
});
