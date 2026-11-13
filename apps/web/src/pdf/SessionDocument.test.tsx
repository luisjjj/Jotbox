import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { SessionDocument } from "@/pdf/SessionDocument";
import type { Session } from "@/lib/types";

const createdAt = new Date(2026, 10, 13, 9, 12).getTime();

const fullSession: Session = {
  id: "pdf-session",
  title: "Friday payout review and the same-day promise",
  kind: "meeting",
  createdAt,
  durationSec: 754,
  status: "ready",
  scratch: "Pause same-day promise\nAda: merchant note before four",
  transcript: Array.from({ length: 18 }, (_, index) => ({
    id: `pdf-line-${index}`,
    text:
      index % 3 === 0
        ? "Ah, wetin happen to the Friday payout?"
        : index % 3 === 1
          ? "The bank acknowledged the file late, so the same-day promise should wait."
          : "We will send the merchant note before four and re-pull the failed batches.",
    at: index * 9,
    speaker: index % 2 === 0 ? "Ada" : "Chinedu",
  })),
  notes: {
    summary:
      "The room agreed that Friday's payout is still partly unsettled because the bank acknowledged the file late. They will pause the same-day promise until the cutoff is reliable, and tell merchants plainly what is happening today.",
    highlights: [
      "Part of Friday's card volume is still unsettled and shows as pending.",
      "The file left on time, but the bank acknowledged it late.",
      'The team agreed: "make we pause the same-day promise" until the cutoff holds.',
    ],
    actions: [
      { id: "a1", text: "Send the merchant note before 4pm in plain language", owner: "Ada", done: false },
      { id: "a2", text: "Re-pull the two failed batches and confirm there are no duplicates", owner: "Chinedu", done: true },
      { id: "a3", text: "Pause same-day payout promises until the cutoff holds", owner: "Team", done: false },
    ],
    sections: [
      {
        heading: "What is happening",
        bullets: ["Merchants see pending and read it as a failure.", "The bank window is landing nearer 4pm."],
      },
      { heading: "What was decided", bullets: ["Same-day language comes out until the window is trustworthy."] },
    ],
    source: "studio",
  },
  hasAudio: false,
};

function previewPath(name: string) {
  const dir = fileURLToPath(new URL("../../../../.shots/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  return `${dir}${name}`;
}

describe("SessionDocument", () => {
  it("renders a branded, multi-page PDF", async () => {
    const buffer = await renderToBuffer(<SessionDocument session={fullSession} />);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(8_000);
    writeFileSync(previewPath("branded-pdf-preview.pdf"), buffer);
  });

  it("renders a session without written notes", async () => {
    const buffer = await renderToBuffer(
      <SessionDocument
        session={{
          ...fullSession,
          notes: null,
          transcript: [{ id: "only-line", text: "Wetin dey happen?", at: 0 }],
        }}
      />,
    );
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(2_000);
  });
});
