import { describe, expect, it } from "vitest";
import { localFollowUp } from "./followUp";
import { localAnswer } from "./sessionAsk";
import { expiredAudio } from "./retention";
import { noticeText } from "./listeningNotice";
import { OUTPUT_PRESETS } from "./presets";
import { renameSpeaker, speakerLabels } from "./speakers";
import type { Session } from "./types";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Weekly product sync",
    kind: "meeting",
    createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    durationSec: 600,
    status: "ready",
    scratch: "- Ada will send the file",
    transcript: [
      { id: "a", text: "We agreed to move the launch to Friday.", at: 12 },
      { id: "b", text: "The bank file is still pending.", at: 30, speaker: "Ada" },
    ],
    notes: {
      summary: "The team moved the launch to Friday.",
      highlights: ["The bank file is pending"],
      decisions: ["Launch moves to Friday"],
      actions: [{ id: "1", text: "Send the bank file", owner: "Ada", done: false }],
      sections: [],
      source: "browser",
    },
    hasAudio: true,
    ...overrides,
  };
}

describe("session helpers", () => {
  it("answers from the spoken words and admits when something is missing", () => {
    const found = localAnswer("What did we agree about the launch?", session());
    expect(found.answer).toContain("move the launch to Friday");

    const missing = localAnswer("What about the ferry timetable?", session());
    expect(missing.answer).toContain("could not find");
  });

  it("drafts a Pidgin follow-up without em dashes", () => {
    const result = localFollowUp(session(), "whatsapp", "pidgin");
    expect(result.text).toContain("How far");
    expect(result.text).toContain("Ada: Send the bank file");
    expect(result.text).not.toContain("\u2014");
  });

  it("expires audio after the chosen window", () => {
    const old = session({ createdAt: Date.now() - 40 * 24 * 60 * 60 * 1000 });
    const fresh = session({ id: "22222222-2222-4222-8222-222222222222" });
    expect(expiredAudio([old, fresh], 30).map((item) => item.id)).toEqual([old.id]);
    expect(expiredAudio([old, fresh], 0)).toEqual([]);
  });

  it("writes a clear listening notice", () => {
    const text = noticeText({
      title: "Product sync",
      kind: "meeting",
      createdAt: Date.now(),
      participants: [{ id: "1", name: "Ada", external: true }],
    });
    expect(text).toContain("JotBox is listening");
    expect(text).toContain("If you do not want to be recorded");
    expect(text).toContain("Guests on the list: Ada");
    expect(text).not.toContain("\u2014");
  });

  it("renames a speaker across every line", () => {
    const lines = [
      { id: "1", text: "One", at: 0, speaker: "Speaker 1" },
      { id: "2", text: "Two", at: 2, speaker: "Speaker 2" },
    ];
    expect(speakerLabels(lines)).toEqual(["Speaker 1", "Speaker 2"]);
    expect(renameSpeaker(lines, "Speaker 1", "Ada")[0].speaker).toBe("Ada");
    expect(renameSpeaker(lines, "Speaker 1", "Ada")[1].speaker).toBe("Speaker 2");
  });
});

describe("output presets", () => {
  it("gives every session shape its own labels and questions", () => {
    for (const preset of Object.values(OUTPUT_PRESETS)) {
      expect(preset.summaryLabel.length).toBeGreaterThan(0);
      expect(preset.decisionsLabel.length).toBeGreaterThan(0);
      expect(preset.suggestions.length).toBeGreaterThan(0);
      expect(preset.followUpSubject.length).toBeGreaterThan(0);
    }
    expect(OUTPUT_PRESETS.lecture.decisionsLabel).toBe("Key definitions");
    expect(OUTPUT_PRESETS.voice.actionsLabel).toBe("Next moves");
  });
});
