import { describe, expect, it } from "vitest";
import { formatClock, isDefaultTitle, notesLookEmpty, notesToMarkdown } from "./format";
import { sessionSlug } from "./exportNotes";
import type { Session } from "./types";

const createdAt = new Date(2026, 10, 13, 9, 12).getTime();

export const session: Session = {
  id: "session-1",
  title: "Friday payout review",
  kind: "meeting",
  createdAt,
  durationSec: 754,
  status: "ready",
  scratch: "Pause same-day promise\nAda: merchant note before four",
  transcript: [
    { id: "line-1", text: "Ah, wetin happen to the Friday payout?", at: 0, speaker: "Ada" },
    { id: "line-2", text: "E be like the bank dey slow us down.", at: 12 },
  ],
  notes: {
    summary: "The room agreed to pause the same-day payout promise until the bank cutoff is reliable.",
    highlights: ["Part of Friday's card volume is still unsettled."],
    actions: [
      { id: "action-1", text: "Send the merchant note before 4pm", owner: "Ada", done: false },
      { id: "action-2", text: "Re-pull the two failed batches", owner: "Chinedu", done: true },
    ],
    sections: [{ heading: "What was decided", bullets: ["Pause same-day language until the window holds."] }],
    source: "studio",
  },
  hasAudio: false,
};

describe("formatClock", () => {
  it("formats minutes, seconds and hours", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(59)).toBe("0:59");
    expect(formatClock(60)).toBe("1:00");
    expect(formatClock(754)).toBe("12:34");
    expect(formatClock(3600)).toBe("1:00:00");
  });

  it("clamps negative values", () => {
    expect(formatClock(-12)).toBe("0:00");
  });
});

describe("notesToMarkdown", () => {
  it("writes the title, meta and summary", () => {
    const markdown = notesToMarkdown(session);
    expect(markdown).toContain("# Friday payout review");
    expect(markdown).toContain("Meeting");
    expect(markdown).toContain("12:34");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain(session.notes?.summary ?? "");
  });

  it("tracks action state and keeps owners", () => {
    const markdown = notesToMarkdown(session);
    expect(markdown).toContain("- [ ] Ada: Send the merchant note before 4pm");
    expect(markdown).toContain("- [x] Chinedu: Re-pull the two failed batches");
  });

  it("keeps Nigerian Pidgin verbatim", () => {
    const markdown = notesToMarkdown(session);
    expect(markdown).toContain("Ah, wetin happen to the Friday payout?");
    expect(markdown).toContain("E be like the bank dey slow us down.");
  });

  it("includes jottings and relative transcript times", () => {
    const markdown = notesToMarkdown(session);
    expect(markdown).toContain("## What you jotted");
    expect(markdown).toContain("Pause same-day promise");
    expect(markdown).toContain("**Ada** (0:00) Ah, wetin happen to the Friday payout?");
    expect(markdown).toContain("(0:12) E be like the bank dey slow us down.");
  });
});

describe("notesLookEmpty", () => {
  it("treats missing or blank notes as empty", () => {
    expect(notesLookEmpty(null)).toBe(true);
    expect(
      notesLookEmpty({ summary: "", highlights: [], actions: [], sections: [], source: "studio" }),
    ).toBe(true);
    expect(notesLookEmpty(session.notes)).toBe(false);
  });
});

describe("isDefaultTitle", () => {
  it("recognises generated titles only", () => {
    expect(isDefaultTitle("Meeting · 13 Nov, 09:12", "meeting")).toBe(true);
    expect(isDefaultTitle("Friday payout review", "meeting")).toBe(false);
  });
});

describe("sessionSlug", () => {
  it("makes a safe file name", () => {
    expect(sessionSlug(session)).toBe("friday-payout-review");
    expect(
      sessionSlug({ ...session, title: "  Payout / Review, Q4!  " }),
    ).toBe("payout-review-q4");
    expect(sessionSlug({ ...session, title: "!!!" })).toBe("jotbox-notes");
  });
});
