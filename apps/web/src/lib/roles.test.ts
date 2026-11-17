import assert from "node:assert/strict";
import { test } from "vitest";
import { DASHBOARD_ROLES, ROLE_META, isDashboardRole, isLeanRole, roleLabel } from "./roles";

test("four dashboard roles are offered, and only known values pass", () => {
  assert.deepEqual([...DASHBOARD_ROLES], ["student", "seminar", "hobbyist", "team"]);
  for (const role of DASHBOARD_ROLES) {
    assert.equal(isDashboardRole(role), true);
    assert.ok(ROLE_META[role].label.length > 0);
  }
  assert.equal(isDashboardRole("admin"), false);
  assert.equal(isDashboardRole(""), false);
  assert.equal(isDashboardRole(null), false);
});

test("student, seminar, and hobbyist get the lean dashboard, team keeps the full one", () => {
  assert.equal(isLeanRole("student"), true);
  assert.equal(isLeanRole("seminar"), true);
  assert.equal(isLeanRole("hobbyist"), true);
  assert.equal(isLeanRole("team"), false);
  assert.equal(isLeanRole(null), false);
});

test("an unknown or missing role is described as the full workspace", () => {
  assert.equal(roleLabel("student"), "Student");
  assert.equal(roleLabel("team"), "Work and teams");
  assert.equal(roleLabel(null), "Work and teams");
});
