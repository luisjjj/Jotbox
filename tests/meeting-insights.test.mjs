import assert from "node:assert/strict";
import { test } from "node:test";
import { insightsFromNotes, syncMeetingInsights } from "../server/api/meeting-insights.mjs";
import { cleanGlossaryTerm, glossaryTerms } from "../server/api/org-glossary.mjs";

test("decisions are recorded as completed and actions keep their status", () => {
  const items = insightsFromNotes({
    decisions: ["Ship the pilot in Port Harcourt"],
    actions: [
      { text: "Send the pricing deck", owner: "Chinedu", due: "2026-12-01", done: false },
      { text: "Book the hall", owner: "Amaka", due: "2026-11-30", done: true },
    ],
  });

  assert.deepEqual(items, [
    {
      kind: "decision",
      text: "Ship the pilot in Port Harcourt",
      ownerLabel: "",
      dueDate: null,
      status: "completed",
    },
    { kind: "action", text: "Send the pricing deck", ownerLabel: "Chinedu", dueDate: "2026-12-01", status: "open" },
    { kind: "action", text: "Book the hall", ownerLabel: "Amaka", dueDate: "2026-11-30", status: "completed" },
  ]);
});

test("missing, empty, and malformed notes produce no insights", () => {
  assert.deepEqual(insightsFromNotes(null), []);
  assert.deepEqual(insightsFromNotes("notes"), []);
  assert.deepEqual(insightsFromNotes({}), []);
  assert.deepEqual(insightsFromNotes({ decisions: ["  "], actions: [{ text: "" }, null, "send it"] }), []);
});

test("text and owner labels are cleaned and due dates must be real calendar dates", () => {
  const [decision, action] = insightsFromNotes({
    decisions: ["  Ship\u0000   it  now "],
    actions: [{ text: "Call\u0007 the bank", owner: "  Amaka\nObi  ", due: "2026-13-01" }],
  });

  assert.equal(decision.text, "Ship it now");
  assert.equal(action.text, "Call the bank");
  assert.equal(action.ownerLabel, "Amaka Obi");
  assert.equal(action.dueDate, null);

  const bad = insightsFromNotes({ actions: [{ text: "Late", due: "next friday" }] });
  assert.equal(bad[0].dueDate, null);
});

test("syncMeetingInsights rebuilds a capture's rows", async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql: sql.trim().split(/\s+/)[0], params });
      return { rows: [] };
    },
  };

  const count = await syncMeetingInsights(db, {
    id: "capture-1",
    org_id: "org-1",
    user_id: "user-1",
    notes: { decisions: ["Decide A"], actions: [{ text: "Do B", owner: "Tunde" }] },
  });

  assert.equal(count, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].sql, "delete");
  assert.equal(calls[1].sql, "insert");
  assert.deepEqual(calls[1].params.slice(0, 3), ["capture-1", "org-1", "user-1"]);
  const rows = JSON.parse(calls[1].params[3]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], {
    kind: "action",
    text: "Do B",
    owner_label: "Tunde",
    due_date: null,
    status: "open",
  });
});

test("syncMeetingInsights never writes rows outside an organisation", async () => {
  const calls = [];
  const db = { query: async (sql) => calls.push(sql) };

  const count = await syncMeetingInsights(db, { id: "capture-1", notes: { decisions: ["A"] } });
  assert.equal(count, 0);
  assert.equal(calls.length, 1);

  assert.equal(await syncMeetingInsights(db, {}), 0);
});

test("glossary terms are cleaned, deduped, and kept short", () => {
  assert.equal(cleanGlossaryTerm("  PTI  "), "PTI");
  assert.equal(cleanGlossaryTerm("Chinedu\u0000Obi"), "Chinedu Obi");
  assert.equal(cleanGlossaryTerm("x".repeat(80)).length, 50);

  assert.deepEqual(
    glossaryTerms([
      { term: "PTI" },
      { term: " pti " },
      "A",
      { term: "Chinedu" },
      { term: "  " },
    ]),
    ["PTI", "Chinedu"],
  );
  assert.deepEqual(glossaryTerms([{ term: "One" }, { term: "Two" }, { term: "Three" }], 2), ["One", "Two"]);
});
