import { describe, expect, it } from "vitest";
import { keepMatches, renameSpeaker, renameSpeakerInNotes, unlabeledSpeakers } from "./speakers";
import type { Participant, SessionNotes, TranscriptLine } from "./types";

function line(speaker: string | undefined, text: string): TranscriptLine {
  return { id: `${speaker}-${text}`, text, at: 0, speaker };
}

const roster: Participant[] = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Chinedu" },
];

describe("speaker naming", () => {
  it("only suggests roster names for speakers that have no name yet", () => {
    const lines = [line("Speaker 1", "Hello"), line("Ada", "Hi"), line("Speaker 2", "Morning")];

    const kept = keepMatches(lines, roster, [
      { speaker: "Speaker 1", name: "Ada", confidence: "high", quote: "Hello" },
      { speaker: "Speaker 2", name: "Bola", confidence: "high", quote: "Morning" },
      { speaker: "Speaker 2", name: "chinedu", confidence: "low", quote: "Morning" },
      { speaker: "Speaker 1", name: "Chinedu", confidence: "low", quote: "Hello" },
    ]);

    expect(kept).toEqual([
      { speaker: "Speaker 2", name: "Chinedu", confidence: "low", quote: "Morning" },
    ]);
  });

  it("finds the labels that still need a name", () => {
    const lines = [line("Speaker 1", "One"), line("Ada", "Two"), line("Speaker 12", "Three")];

    expect(unlabeledSpeakers(lines)).toEqual(["Speaker 1", "Speaker 12"]);
  });

  it("carries a chosen name into every part of the notes", () => {
    const notes: SessionNotes = {
      summary: "Speaker 1 owns the cutoff fix, and Speaker 10 keeps the log.",
      highlights: ["Speaker 1 will call the bank."],
      decisions: ["Speaker 1 takes the merchant note."],
      actions: [
        { id: "1", text: "Speaker 1 sends the note", owner: "Speaker 1", done: false },
        { id: "2", text: "Check the batch", owner: "Chinedu", done: false },
      ],
      sections: [{ heading: "Speaker 1", bullets: ["Speaker 1: no same-day promise."] }],
      source: "studio",
    };

    const next = renameSpeakerInNotes(notes, "Speaker 1", "Ada");

    expect(next?.summary).toBe("Ada owns the cutoff fix, and Speaker 10 keeps the log.");
    expect(next?.highlights).toEqual(["Ada will call the bank."]);
    expect(next?.decisions).toEqual(["Ada takes the merchant note."]);
    expect(next?.actions[0]).toMatchObject({ owner: "Ada", text: "Ada sends the note" });
    expect(next?.actions[1].owner).toBe("Chinedu");
    expect(next?.sections[0]).toEqual({ heading: "Ada", bullets: ["Ada: no same-day promise."] });
  });

  it("renames only the exact speaker label", () => {
    const lines = [line("Speaker 1", "One"), line("Speaker 10", "Ten")];
    const next = renameSpeaker(lines, "Speaker 1", "Ada");

    expect(next.map((item) => item.speaker)).toEqual(["Ada", "Speaker 10"]);
  });
});
