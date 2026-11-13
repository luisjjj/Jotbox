import { describe, expect, it } from "vitest";
import { insightsCount, localInsights, mergeInsights } from "./insights";
import type { TranscriptLine } from "./types";

function line(text: string, at = 0, speaker?: string): TranscriptLine {
  return { id: `${at}-${text}`, text, at, speaker };
}

describe("live insights", () => {
  it("picks decisions and actions from spoken words", () => {
    const insights = localInsights([
      line("We agreed to move the launch to Friday."),
      line("I will send the bank file before noon."),
      line("No wahala, make we confirm the venue tomorrow."),
    ]);

    expect(insights.decisions.some((item) => item.includes("move the launch"))).toBe(true);
    expect(insights.actions.some((item) => item.text.includes("send the bank file"))).toBe(true);
    expect(insightsCount(insights)).toBeGreaterThan(0);
  });

  it("ignores short noise", () => {
    const insights = localInsights([line("okay"), line("yes"), line("hmm")]);
    expect(insights.decisions).toHaveLength(0);
    expect(insights.actions).toHaveLength(0);
  });

  it("merges without repeating a line", () => {
    const current = { decisions: ["We agreed on Friday"], actions: [{ text: "Send the file", owner: "Ada" }] };
    const next = {
      decisions: ["we agreed on friday", "We agreed on the budget"],
      actions: [
        { text: "send the file", owner: "Ada" },
        { text: "Book the room", owner: "You" },
      ],
    };
    const merged = mergeInsights(current, next);

    expect(merged.decisions).toEqual(["We agreed on Friday", "We agreed on the budget"]);
    expect(merged.actions.map((item) => item.text)).toEqual(["Send the file", "Book the room"]);
  });
});
