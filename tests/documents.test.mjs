import assert from "node:assert/strict";
import { test } from "node:test";

import {
  documentMimeType,
  documentParagraphs,
  documentTitle,
  extractDocumentText,
  safeFilename,
} from "../server/api/documents.mjs";
import { citationsFrom } from "../server/api/memory-index.mjs";

test("safeFilename keeps the base name and drops control characters", () => {
  assert.equal(safeFilename("C:\\Users\\ama\\Board Pack_Q3.pdf"), "Board Pack_Q3.pdf");
  assert.equal(safeFilename("../secret\u0000.txt"), "secret.txt");
  assert.equal(safeFilename(""), "Document");
});

test("documentTitle turns a filename into a readable title", () => {
  assert.equal(documentTitle("board_pack-q3.pdf"), "board pack q3");
  assert.equal(documentTitle("Pricing.Policy.docx"), "Pricing.Policy");
  assert.equal(documentTitle(".md"), "Document");
});

test("documentMimeType trusts a supported type and guesses otherwise", () => {
  assert.equal(documentMimeType("notes.txt", "application/pdf"), "application/pdf");
  assert.equal(documentMimeType("notes.md", ""), "text/markdown");
  assert.equal(documentMimeType("plan.docx", "application/octet-stream"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(documentMimeType("archive.zip", "application/zip"), "application/zip");
});

test("documentParagraphs become transcript lines the chunker already understands", () => {
  const lines = documentParagraphs("First paragraph.\n\nSecond paragraph.\nStill the second.");
  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines.map((line) => ({ text: line.text, at: line.at, speaker: line.speaker })),
    [
      { text: "First paragraph.", at: 0, speaker: "Document" },
      { text: "Second paragraph. Still the second.", at: 0, speaker: "Document" },
    ],
  );
  assert.equal(new Set(lines.map((line) => line.id)).size, 2);
});

test("documentParagraphs split a very long block into readable pieces", () => {
  const sentence = "This sentence explains the decision in plain words. ";
  const lines = documentParagraphs(sentence.repeat(80));
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(line.text.length <= 1_200);
});

test("extractDocumentText reads plain text and normalises whitespace", async () => {
  const result = await extractDocumentText({
    buffer: Buffer.from("  Pricing policy for the year.\r\n\r\nKeep it simple.  "),
    filename: "policy.txt",
    mimeType: "text/plain",
  });
  assert.equal(result.mimeType, "text/plain");
  assert.equal(result.text, "Pricing policy for the year.\n\nKeep it simple.");
});

test("extractDocumentText refuses empty text and unsupported files", async () => {
  await assert.rejects(
    extractDocumentText({ buffer: Buffer.from("short"), filename: "a.txt", mimeType: "text/plain" }),
    (error) => error.status === 422,
  );
  await assert.rejects(
    extractDocumentText({ buffer: Buffer.from("anything"), filename: "a.zip", mimeType: "application/zip" }),
    (error) => error.status === 415,
  );
  await assert.rejects(
    extractDocumentText({ buffer: Buffer.alloc(0), filename: "a.txt", mimeType: "text/plain" }),
    (error) => error.status === 400,
  );
});

test("document citations link back to the memory source and keep each passage", () => {
  const sourceMap = new Map([
    ["doc-1", { title: "Board pack", date: "2026-03-01T00:00:00.000Z", document: true }],
    ["meeting-1", { title: "Pricing review", date: "2026-03-02T00:00:00.000Z", document: false }],
  ]);
  const citations = citationsFrom(
    [
      { id: "c1", captureId: "doc-1", speaker: "Document", startSec: 0, text: "Passage one." },
      { id: "c2", captureId: "doc-1", speaker: "Document", startSec: 0, text: "Passage two." },
      { id: "c3", captureId: "meeting-1", speaker: "Ada", startSec: 75, text: "We moved the launch." },
    ],
    sourceMap,
  );

  assert.equal(citations.length, 3);
  assert.equal(citations[0].href, "/memory?doc=doc-1");
  assert.equal(citations[0].document, true);
  assert.equal(citations[1].excerpt, "Passage two.");
  assert.equal(citations[2].href, "/session/meeting-1?t=75");
  assert.equal(citations[2].document, false);
});
