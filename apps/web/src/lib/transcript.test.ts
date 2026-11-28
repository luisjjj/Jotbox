import { describe, expect, it } from "vitest";
import { isJunkLine, linesFromText, spokenLines, wordsToLines } from "./transcript";
import type { SttWord, TranscriptLine } from "./types";

function word(text: string, start: number, end: number, speaker?: number): SttWord {
  return { text, start, end, ...(speaker === undefined ? {} : { speaker }) };
}

describe("wordsToLines", () => {
  it("returns nothing for empty input", () => {
    expect(wordsToLines(undefined, "   ")).toEqual([]);
  });

  it("falls back to one line when there are no word timings", () => {
    const lines = wordsToLines(undefined, "  We agreed to pause the promise.  ");
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("We agreed to pause the promise.");
    expect(lines[0].at).toBe(0);
    expect(lines[0].speaker).toBe("Speaker 1");
  });

  it("splits when a new speaker starts and labels them", () => {
    const lines = wordsToLines(
      [
        word("Wetin", 0, 0.3, 0),
        word("happen", 0.3, 0.6, 0),
        word("We", 0.7, 1, 1),
        word("pause", 1, 1.2, 1),
      ],
      "",
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ text: "Wetin happen", speaker: "Speaker 1", at: 0 });
    expect(lines[1]).toMatchObject({ text: "We pause", speaker: "Speaker 2", at: 0.7 });
  });

  it("splits on a long silence", () => {
    const lines = wordsToLines(
      [word("One", 0, 0.4), word("two", 0.5, 0.9), word("three", 2.2, 2.5)],
      "",
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe("One two");
    expect(lines[1].text).toBe("three");
  });

  it("tightens punctuation spacing", () => {
    const lines = wordsToLines(
      [word("Hello", 0, 0.2), word(",", 0.2, 0.3), word("world", 0.3, 0.6)],
      "",
    );
    expect(lines[0].text).toBe("Hello, world");
  });

  it("splits very long chunks at 220 characters", () => {
    const words = Array.from({ length: 80 }, (_, index) => word(`word${index}`, index, index + 0.5));
    const lines = wordsToLines(words, "");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.text.length).toBeLessThanOrEqual(230);
  });

  it("labels an undiarised recording as Speaker 1", () => {
    const lines = wordsToLines([word("Hello", 0, 0.2), word("there", 0.3, 0.5)], "");
    expect(lines[0].speaker).toBe("Speaker 1");
  });
});

describe("isJunkLine", () => {
  it("drops reader hallucinations and symbol salad from the PDF evidence", () => {
    for (const line of [
      "[2 >$>0 ,>$ @$ @ 5>[]",
      "[2 >$>0 * M7?/K @ 5>[]",
      "@d [* M7?/K @ 5>[]",
      "[notification @ 5>[]",
      "[ 8M*7M ]",
      "|, P. tp...",
      "Bunu zaten dedin.",
      "आप कैसे हैं",
      "सब्सक्राइब करें",
      "[music playing]",
      "(inaudible)",
      "Amara.org",
    ]) {
      expect(isJunkLine(line), line).toBe(true);
    }
  });

  it("keeps Nigerian languages, Pidgin and ordinary speech", () => {
    for (const line of [
      "make we pause the same-day promise until the cutoff hold",
      "Ẹ káàárọ̀, ṣé àwọn ọmọ wa wà?",
      "Muna son zuwa makaranta gobe",
      "Anyị ga-ezute n’abalị a",
      "Revenue is up 12 percent.",
      "Ada will send the file at 4pm.",
      "Use C++ and C# for the parser.",
    ]) {
      expect(isJunkLine(line), line).toBe(false);
    }
  });
});

describe("spokenLines", () => {
  it("hides junk that is already stored in a transcript", () => {
    const lines: TranscriptLine[] = [
      { id: "1", text: "We still have fourteen percent pending.", at: 4 },
      { id: "2", text: "[2 >$>0 ,>$ @$ @ 5>[]", at: 143 },
      { id: "3", text: "Bunu zaten dedin.", at: 579 },
      { id: "4", text: "The bank acknowledged the file late.", at: 601 },
    ];
    expect(spokenLines(lines).map((line) => line.text)).toEqual([
      "We still have fourteen percent pending.",
      "The bank acknowledged the file late.",
    ]);
  });
});

describe("wordsToLines junk screen", () => {
  it("does not build a line from a hallucinated word run", () => {
    const words: SttWord[] = [
      { text: "The", start: 0, end: 0.2 },
      { text: "bank", start: 0.3, end: 0.5 },
      { text: "was", start: 0.6, end: 0.8 },
      { text: "late.", start: 0.9, end: 1.2 },
      { text: "[2", start: 3, end: 3.2 },
      { text: ">$>0", start: 3.3, end: 3.5 },
      { text: "@$", start: 3.6, end: 3.8 },
      { text: "5>[]", start: 3.9, end: 4.1 },
    ];
    const lines = wordsToLines(words, "");
    expect(lines.map((line) => line.text)).toEqual(["The bank was late."]);
  });
});

describe("linesFromText", () => {
  it("returns one clean line per pasted line", () => {
    const lines = linesFromText("  Ada: Friday's volume is pending.\n\nChinedu: The bank was late.  ");
    expect(lines.map((line) => line.text)).toEqual([
      "Ada: Friday's volume is pending.",
      "Chinedu: The bank was late.",
    ]);
    expect(lines.every((line) => line.at === 0)).toBe(true);
  });

  it("splits long paragraphs into readable sentences", () => {
    const text = `${"First sentence here. ".repeat(15)}Second sentence.`;
    const lines = linesFromText(text);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.text.length).toBeLessThanOrEqual(260);
  });

  it("chunks very long sentences without punctuation", () => {
    const text = Array.from({ length: 100 }, () => "word").join(" ");
    const lines = linesFromText(text);
    expect(lines.length).toBe(3);
    expect(lines.every((line) => line.text.split(/\s+/).length <= 45)).toBe(true);
  });

  it("returns nothing for blank input", () => {
    expect(linesFromText(" \n ")).toEqual([]);
  });
});
