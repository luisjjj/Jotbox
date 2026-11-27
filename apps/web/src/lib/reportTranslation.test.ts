import { describe, expect, it } from "vitest";
import type { TranslatedReport } from "./api";
import { mergeTranslatedReport, reportLanguageLabel, reportTranslationInput } from "./reportTranslation";
import type { SessionNotes } from "./types";

function notes(overrides: Partial<SessionNotes> = {}): SessionNotes {
  return {
    source: "studio",
    summary: "The room agreed to pause the same-day promise.",
    highlights: ["The bank acknowledged the file late.", "Support carried one settlement problem."],
    decisions: ["Pause the same-day promise."],
    blockers: ["The bank window slipped to 4pm."],
    followUps: [{ to: "Ada", subject: "Merchant note", body: "Send it before four." }],
    actions: [
      { id: "a1", text: "Send the merchant note", owner: "Ada", due: "2026-11-20", done: false },
      { id: "a2", text: "Re-pull the failed batches", owner: "Chinedu", done: true },
    ],
    sections: [{ heading: "What changed", bullets: ["Same-day wording went out.", "Support got a reply."] }],
    ...overrides,
  };
}

function translated(overrides: Partial<TranslatedReport> = {}): TranslatedReport {
  return {
    title: "",
    summary: "Ìgbìmọ̀ gbà láti dá ìlérí owó ọjọ́ kan dúró.",
    highlights: ["Báńkì náà gbà fọ́ọ̀mù náà pẹ́.", ""],
    decisions: ["Dá ìlérí owó ọjọ́ kan dúró."],
    blockers: [""],
    actions: [
      { text: "Fi ìwé ránṣẹ́ sí oníṣòwò", owner: "Ada", due: "2026-11-20" },
      { text: "Tún àwọn ìsàn tí ó kùnà ṣe", owner: "Chinedu", due: "" },
    ],
    followUps: [{ to: "Ada", subject: "Ìwé oníṣòwò", body: "Fi ránṣẹ́ kí ó tó 4pm." }],
    sections: [{ heading: "Àyípadà", bullets: ["Ọ̀rọ̀ owó ọjọ́ kan kúrò."] }],
    ...overrides,
  };
}

describe("reportTranslationInput", () => {
  it("sends the report prose without ids, done flags or the source tag", () => {
    const input = reportTranslationInput(notes());

    expect(input.title).toBe("");
    expect(input.actions[0]).toEqual({ text: "Send the merchant note", owner: "Ada", due: "2026-11-20" });
    expect(input.actions[1].due).toBe("");
    expect(input.followUps[0].to).toBe("Ada");
    expect("source" in input).toBe(false);
  });
});

describe("mergeTranslatedReport", () => {
  it("keeps ids, owners, deadlines, done flags and recipients while replacing prose", () => {
    const merged = mergeTranslatedReport(notes(), translated());

    expect(merged.summary).toBe("Ìgbìmọ̀ gbà láti dá ìlérí owó ọjọ́ kan dúró.");
    expect(merged.highlights[0]).toBe("Báńkì náà gbà fọ́ọ̀mù náà pẹ́.");
    expect(merged.highlights[1]).toBe("Support carried one settlement problem.");
    expect(merged.decisions).toEqual(["Dá ìlérí owó ọjọ́ kan dúró."]);
    expect(merged.blockers).toEqual(["The bank window slipped to 4pm."]);
    expect(merged.actions[0]).toEqual({
      id: "a1",
      text: "Fi ìwé ránṣẹ́ sí oníṣòwò",
      owner: "Ada",
      due: "2026-11-20",
      done: false,
    });
    expect(merged.actions[1]).toMatchObject({
      id: "a2",
      owner: "Chinedu",
      done: true,
      text: "Tún àwọn ìsàn tí ó kùnà ṣe",
    });
    expect(merged.followUps?.[0]).toEqual({ to: "Ada", subject: "Ìwé oníṣòwò", body: "Fi ránṣẹ́ kí ó tó 4pm." });
    expect(merged.sections[0]).toEqual({
      heading: "Àyípadà",
      bullets: ["Ọ̀rọ̀ owó ọjọ́ kan kúrò.", "Support got a reply."],
    });
    expect(merged.source).toBe("studio");
  });

  it("returns the source report unchanged when there is no translation", () => {
    const source = notes();

    expect(mergeTranslatedReport(source, null)).toBe(source);
  });
});

describe("reportLanguageLabel", () => {
  it("names the four supported languages", () => {
    expect(reportLanguageLabel("pcm")).toBe("Pidgin");
    expect(reportLanguageLabel("yo")).toBe("Yoruba");
    expect(reportLanguageLabel("ig")).toBe("Igbo");
    expect(reportLanguageLabel("ha")).toBe("Hausa");
    expect(reportLanguageLabel(null)).toBe("");
  });
});
