import { randomUUID } from "node:crypto";

/**
 * Text extraction for documents that are mapped into organisation memory.
 *
 * The extracted text becomes the hidden capture's transcript, so chunking,
 * permission checks, retrieval and citations stay in one code path. Scanned
 * PDFs have no selectable text and are refused with a clear message.
 */

const MAX_TEXT_CHARS = 300_000;
const MAX_PARAGRAPH_CHARS = 1_200;
const MAX_PARAGRAPHS = 600;

const BY_EXTENSION = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
};

export const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
]);

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

export function safeFilename(value) {
  const name = String(value || "").trim().split(/[\\/]/).pop() || "Document";
  return name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "Document";
}

export function documentMimeType(filename, declared) {
  const clean = String(declared || "").split(";")[0].trim().toLowerCase();
  if (DOCUMENT_MIME_TYPES.has(clean)) return clean;
  const extension = safeFilename(filename).split(".").pop()?.toLowerCase() || "";
  return BY_EXTENSION[extension] || clean || "application/octet-stream";
}

export function documentTitle(filename) {
  const base = safeFilename(filename).replace(/\.[a-z0-9]{1,8}$/i, "");
  const spaced = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (spaced || "Document").slice(0, 180);
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

async function pdfText(buffer) {
  try {
    const { extractText } = await import("unpdf");
    const result = await extractText(new Uint8Array(buffer), { mergePages: true });
    return typeof result.text === "string" ? result.text : (result.text || []).join("\n");
  } catch {
    throw failure(422, "That PDF could not be read. Try another copy or export it as text.");
  }
}

async function docxText(buffer) {
  try {
    const mammoth = await import("mammoth");
    const extract = mammoth.default?.extractRawText ?? mammoth.extractRawText;
    const result = await extract({ buffer });
    return result.value || "";
  } catch {
    throw failure(422, "That Word file could not be read. Save it again and retry.");
  }
}

export async function extractDocumentText({ buffer, filename, mimeType }) {
  if (!buffer?.length) throw failure(400, "That file was empty.");
  const type = documentMimeType(filename, mimeType);
  let text = "";
  if (type === "application/pdf") text = await pdfText(buffer);
  else if (type.endsWith("wordprocessingml.document")) text = await docxText(buffer);
  else if (type.startsWith("text/") || type === "application/json") text = buffer.toString("utf8");
  else throw failure(415, "Upload a PDF, Word file, text, Markdown or CSV file.");
  const cleaned = cleanText(text);
  if (cleaned.length < 20) {
    throw failure(
      422,
      "No readable text was found. A scanned PDF has no text to search, so upload the original document or a text export.",
    );
  }
  return { text: cleaned, mimeType: type };
}

/**
 * Paragraphs become transcript lines. They keep the shapes the chunker and the
 * source dialog already expect.
 */
export function documentParagraphs(text) {
  const blocks = String(text || "")
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines = [];
  const push = (part) => {
    const clean = part.trim();
    if (!clean || lines.length >= MAX_PARAGRAPHS) return;
    lines.push({ id: randomUUID(), text: clean.slice(0, MAX_PARAGRAPH_CHARS), at: 0, speaker: "Document" });
  };
  for (const block of blocks) {
    if (block.length <= MAX_PARAGRAPH_CHARS) {
      push(block);
      continue;
    }
    const sentences = block.match(/[^.!?]+[.!?]*/g) || [block];
    let piece = "";
    for (const sentence of sentences) {
      const clean = sentence.trim();
      if (!clean) continue;
      if (piece && piece.length + clean.length + 1 > MAX_PARAGRAPH_CHARS) {
        push(piece);
        piece = "";
      }
      piece = piece ? `${piece} ${clean}` : clean;
    }
    if (piece) push(piece);
    if (lines.length >= MAX_PARAGRAPHS) break;
  }
  return lines;
}
