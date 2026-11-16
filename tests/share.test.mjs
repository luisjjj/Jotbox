import assert from "node:assert/strict";
import { test } from "node:test";
import { linkSharingAllowed } from "../server/api/share.mjs";
import { effectiveVisibility } from "../server/api/orgs.mjs";

test("confidential sessions never get a public share link", () => {
  assert.equal(linkSharingAllowed({ sensitivity: "confidential" }), false);
  assert.equal(linkSharingAllowed({ sensitivity: "standard" }), true);
  assert.equal(linkSharingAllowed({}), true);
});

test("confidential sharing is forced back to private visibility", () => {
  assert.equal(effectiveVisibility("confidential", "organisation"), "private");
  assert.equal(effectiveVisibility("confidential", "department"), "private");
  assert.equal(effectiveVisibility("standard", "organisation"), "organisation");
  assert.equal(effectiveVisibility("standard", "department"), "department");
});
