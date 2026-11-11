import { notesToMarkdown } from "./format";
import type { Session } from "./types";

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function slugFor(session: Session) {
  const base = session.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "jotbox-notes";
}

export function downloadMarkdown(session: Session) {
  download(`${slugFor(session)}.md`, notesToMarkdown(session), "text/markdown");
}

export function downloadText(session: Session) {
  download(`${slugFor(session)}.txt`, notesToMarkdown(session), "text/plain");
}

export async function copyNotes(session: Session) {
  await navigator.clipboard.writeText(notesToMarkdown(session));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printSession(session: Session) {
  const notes = session.notes;
  const parts: string[] = [];
  parts.push(
    `<header><p class="eyebrow">JotBox</p><h1>${escapeHtml(session.title)}</h1><p class="meta">${escapeHtml(
      new Date(session.createdAt).toLocaleString(undefined, {
        dateStyle: "long",
        timeStyle: "short",
      }),
    )}</p></header>`,
  );

  if (notes) {
    parts.push(`<h2>Summary</h2><p class="lead">${escapeHtml(notes.summary)}</p>`);
    if (notes.highlights.length) {
      parts.push(`<h2>Key points</h2><ul>${notes.highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
    }
    if (notes.actions.length) {
      parts.push(
        `<h2>Action items</h2><ul class="actions">${notes.actions
          .map((item) => `<li><span class="owner">${escapeHtml(item.owner)}</span> ${escapeHtml(item.text)}</li>`)
          .join("")}</ul>`,
      );
    }
    for (const section of notes.sections) {
      parts.push(
        `<h2>${escapeHtml(section.heading)}</h2><ul>${section.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
      );
    }
  }

  if (session.scratch.trim()) {
    parts.push(`<h2>What you jotted</h2><pre class="scratch">${escapeHtml(session.scratch.trim())}</pre>`);
  }

  if (session.transcript.length) {
    parts.push(
      `<h2 class="break">Transcript</h2><div class="transcript">${session.transcript
        .map(
          (line) =>
            `<p><span class="time">${escapeHtml(
              new Date(session.createdAt + line.at * 1000).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            )}</span>${line.speaker ? `<strong>${escapeHtml(line.speaker)}</strong> ` : ""}${escapeHtml(line.text)}</p>`,
        )
        .join("")}</div>`,
    );
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(session.title)}</title>
  <style>
    @page { margin: 22mm 20mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #1b1d1a; line-height: 1.6; font-size: 11.5pt; }
    header { border-bottom: 2px solid #16483a; padding-bottom: 14px; margin-bottom: 26px; }
    .eyebrow { font-size: 8pt; letter-spacing: .18em; text-transform: uppercase; color: #16483a; margin: 0 0 8px; font-weight: 600; }
    h1 { font-family: Georgia, serif; font-weight: 500; font-size: 25pt; margin: 0 0 8px; line-height: 1.15; letter-spacing: -.01em; }
    .meta { color: #6d726c; font-size: 9.5pt; margin: 0; }
    h2 { font-size: 9pt; letter-spacing: .12em; text-transform: uppercase; color: #16483a; margin: 26px 0 8px; }
    .lead { font-size: 12.5pt; line-height: 1.65; }
    ul { margin: 0; padding-left: 18px; }
    li { margin: 5px 0; }
    .actions { list-style: none; padding: 0; }
    .actions li { border-bottom: 1px solid #e6e4dc; padding: 7px 0; }
    .owner { display: inline-block; font-size: 8pt; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #8b6b38; margin-right: 6px; }
    .scratch { font-family: Georgia, serif; font-size: 11.5pt; white-space: pre-wrap; background: #faf8f2; border: 1px solid #e6e4dc; border-radius: 6px; padding: 12px 14px; }
    .transcript p { margin: 0 0 8px; }
    .time { color: #91978f; font-size: 8.5pt; margin-right: 8px; font-variant-numeric: tabular-nums; }
    .break { page-break-before: auto; }
    footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e6e4dc; color: #91978f; font-size: 8.5pt; }
  </style></head><body>
  ${parts.join("\n")}
  <footer>Written with JotBox. Notes are a summary of the recording, not a verbatim court record.</footer>
  </body></html>`;

  const win = window.open("", "_blank", "width=880,height=1000");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  window.setTimeout(() => win.print(), 350);
  return true;
}
