import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enterpriseMonthlySeconds,
  freeAllowanceSeconds,
  legacyProMonthlySeconds,
  planMonthlySeconds,
  powerMonthlySeconds,
  starterMonthlySeconds,
  usageSnapshot,
} from "../server/api/usage.mjs";

test("free listening is a lifetime 100 minutes and can be changed", () => {
  assert.equal(freeAllowanceSeconds({}), 6000);
  assert.equal(freeAllowanceSeconds({ JOTBOX_FREE_MONTH_MINUTES: "45" }), 2700);
  assert.equal(freeAllowanceSeconds({ JOTBOX_FREE_MONTH_MINUTES: "0" }), 6000);
  assert.equal(freeAllowanceSeconds({ JOTBOX_FREE_MONTH_MINUTES: "" }), 6000);
  assert.equal(freeAllowanceSeconds({ JOTBOX_FREE_MONTH_MINUTES: "not-a-number" }), 6000);
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

test("Starter is 10 hours, Power is 25, legacy Pro keeps 20, enterprise 1000", () => {
  assert.equal(starterMonthlySeconds({}), 10 * 3600);
  assert.equal(starterMonthlySeconds({ JOTBOX_STARTER_MONTH_HOURS: "8" }), 8 * 3600);
  assert.equal(starterMonthlySeconds({ JOTBOX_STARTER_MONTH_HOURS: "0" }), 10 * 3600);

  assert.equal(powerMonthlySeconds({}), 25 * 3600);
  assert.equal(powerMonthlySeconds({ JOTBOX_POWER_MONTH_HOURS: "40" }), 40 * 3600);
  assert.equal(powerMonthlySeconds({ JOTBOX_POWER_MONTH_HOURS: "0" }), 25 * 3600);

  assert.equal(legacyProMonthlySeconds({}), 20 * 3600);
  assert.equal(legacyProMonthlySeconds({ JOTBOX_PRO_MONTH_HOURS: "12" }), 12 * 3600);
  assert.equal(legacyProMonthlySeconds({ JOTBOX_PRO_MONTH_HOURS: "not-a-number" }), 20 * 3600);

  assert.equal(enterpriseMonthlySeconds({}), 1000 * 3600);
  assert.equal(enterpriseMonthlySeconds({ JOTBOX_ENTERPRISE_MONTH_HOURS: "2000" }), 1000 * 3600);

  assert.equal(planMonthlySeconds("free", {}), 6000);
  assert.equal(planMonthlySeconds("starter", {}), 10 * 3600);
  assert.equal(planMonthlySeconds("power", {}), 25 * 3600);
  assert.equal(planMonthlySeconds("pro", {}), 20 * 3600);
  assert.equal(planMonthlySeconds("enterprise", {}), 1000 * 3600);
});

test("enterprise usage hides a larger cap as unlimited", () => {
  const usage = usageSnapshot(99_999, { unlimited: true, limitSeconds: 3600 });
  assert.equal(usage.unlimited, true);
  assert.equal(usage.limitSeconds, null);
  assert.equal(usage.remainingSeconds, null);
  assert.equal(usage.usedSeconds, 99_999);
});
