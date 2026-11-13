import { format } from "date-fns";
import { KIND_META } from "./format";
import type { Participant, SessionKind } from "./types";

export interface NoticeInput {
  title: string;
  kind: SessionKind;
  createdAt: number;
  participants?: Participant[];
}

export function noticeText(input: NoticeInput) {
  const guests = (input.participants ?? []).filter((person) => person.external && person.name.trim());
  return [
    "JotBox is listening",
    "",
    input.title,
    `${KIND_META[input.kind].label} · ${format(input.createdAt, "d MMMM yyyy, HH:mm")}`,
    "",
    "What is captured",
    "Spoken words and notes for this session.",
    "The recording stays on the device that started it and is not uploaded for storage.",
    "Notes may be shared with the people in this room or on this call.",
    ...(guests.length ? [`Guests on the list: ${guests.map((person) => person.name).join(", ")}.`] : []),
    "",
    "If you do not want to be recorded, please say so now, before the session continues.",
  ].join("\n");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printListeningNotice(input: NoticeInput) {
  const rows = [
    ["Session", input.title],
    ["Type", KIND_META[input.kind].label],
    ["Started", format(input.createdAt, "d MMMM yyyy, HH:mm")],
  ];
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Listening notice</title>
  <style>
    @page { margin: 24mm 22mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #1b1d1a; line-height: 1.6; font-size: 12pt; }
    .badge { display: inline-flex; align-items: center; gap: 8px; border: 1px solid #d8d6cc; border-radius: 999px; padding: 6px 12px; font-size: 9pt; letter-spacing: .14em; text-transform: uppercase; color: #16483a; font-weight: 700; }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: #b42318; }
    h1 { font-family: Georgia, serif; font-weight: 500; font-size: 30pt; margin: 22px 0 6px; letter-spacing: -.02em; }
    .sub { color: #6d726c; margin: 0 0 26px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    td { padding: 9px 0; border-bottom: 1px solid #e6e4dc; vertical-align: top; }
    td:first-child { width: 28%; color: #6d726c; font-size: 9.5pt; text-transform: uppercase; letter-spacing: .08em; }
    h2 { font-size: 10pt; letter-spacing: .12em; text-transform: uppercase; color: #16483a; margin: 22px 0 8px; }
    ul { margin: 0; padding-left: 20px; }
    li { margin: 7px 0; }
    .callout { margin-top: 26px; border: 1px solid #e6e4dc; background: #faf8f2; border-radius: 8px; padding: 14px 16px; }
    footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e6e4dc; color: #91978f; font-size: 8.5pt; }
  </style></head><body>
  <span class="badge"><span class="dot"></span> JotBox is listening</span>
  <h1>This session is being recorded.</h1>
  <p class="sub">Please read this before the conversation continues.</p>
  <table>${rows
    .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join("")}</table>
  <h2>What is captured</h2>
  <ul>
    <li>Spoken words and notes for this session.</li>
    <li>The recording stays on the device that started it and is not uploaded for storage.</li>
    <li>Notes may be shared with the people in this room or on this call.</li>
  </ul>
  <div class="callout">If you do not want to be recorded, please say so now, before the session continues.</div>
  <footer>JotBox keeps the words and writes the notes. Audio stays on the recording device.</footer>
  </body></html>`;

  const win = window.open("", "_blank", "width=820,height=960");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  window.setTimeout(() => win.print(), 350);
  return true;
}

export async function copyListeningNotice(input: NoticeInput) {
  await navigator.clipboard.writeText(noticeText(input));
}
