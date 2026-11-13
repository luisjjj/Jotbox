import assert from "node:assert/strict";
import { test } from "node:test";
import { freeMonthlySeconds, usageSnapshot } from "../server/api/usage.mjs";

test("free listening defaults to 60 minutes and can be changed", () => {
  assert.equal(freeMonthlySeconds({}), 3600);
  assert.equal(freeMonthlySeconds({ JOTBOX_FREE_MONTH_MINUTES: "45" }), 2700);
  assert.equal(freeMonthlySeconds({ JOTBOX_FREE_MONTH_MINUTES: "0" }), 3600);
  assert.equal(freeMonthlySeconds({ JOTBOX_FREE_MONTH_MINUTES: "" }), 3600);
  assert.equal(freeMonthlySeconds({ JOTBOX_FREE_MONTH_MINUTES: "not-a-number" }), 3600);
});

test("usage reports the remainder and never goes below zero", () => {
  const start = "2026-11-01T00:00:00.000Z";
  const end = "2026-12-01T00:00:00.000Z";
  const usage = usageSnapshot(1200, { limitSeconds: 3600 }, { start, end });
  assert.equal(usage.unlimited, false);
  assert.equal(usage.usedSeconds, 1200);
  assert.equal(usage.limitSeconds, 3600);
  assert.equal(usage.remainingSeconds, 2400);
  assert.equal(usage.periodStart, Date.parse(start));
  assert.equal(usage.periodEnd, Date.parse(end));

  const over = usageSnapshot(4000.2, { limitSeconds: 3600 });
  assert.equal(over.usedSeconds, 4001);
  assert.equal(over.remainingSeconds, 0);
});

test("Pro usage is unlimited", () => {
  const usage = usageSnapshot(99_999, { unlimited: true, limitSeconds: 3600 });
  assert.equal(usage.unlimited, true);
  assert.equal(usage.limitSeconds, null);
  assert.equal(usage.remainingSeconds, null);
  assert.equal(usage.usedSeconds, 99_999);
});
