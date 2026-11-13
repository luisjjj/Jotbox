import { afterEach, describe, expect, it, vi } from "vitest";
import {
  filterLines,
  focusContext,
  focusTerms,
  getFocusMode,
  getPickupMode,
  isNoiseLine,
  isOffTopic,
  knownNames,
  pickupConstraints,
  setFocusMode,
  setPickupMode,
} from "./listening";
import type { Participant, TranscriptLine } from "./types";

const ada: Participant = { id: "p1", name: "Ada" };
const obi: Participant = { id: "p2", name: "Obi" };
const chinedu: Participant = { id: "p3", name: "Chinedu" };

function context(overrides: Partial<Parameters<typeof focusContext>[0]> = {}) {
  return focusContext({
    title: "Quarterly earnings review",
    kind: "meeting",
    participants: [ada, obi, chinedu],
    scratch: "",
    ...overrides,
  });
}

function line(text: string, id = text): TranscriptLine {
  return { id, text, at: 0 };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listening profile", () => {
  it("defaults to balanced focus and pickup when nothing is stored", () => {
    expect(getFocusMode()).toBe("balanced");
    expect(getPickupMode()).toBe("balanced");
  });

  it("remembers focus and pickup choices", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (name: string) => store.get(name) ?? null,
      setItem: (name: string, value: string) => store.set(name, value),
    });

    setFocusMode("strict");
    setPickupMode("far");
    expect(getFocusMode()).toBe("strict");
    expect(getPickupMode()).toBe("far");

    setFocusMode("off");
    expect(getFocusMode()).toBe("off");
  });

  it("keeps noise suppression off only for far voices", () => {
    const balanced = pickupConstraints("balanced");
    expect(balanced.noiseSuppression).toBe(true);
    expect(balanced.echoCancellation).toBe(true);
    expect(balanced.autoGainControl).toBe(true);

    const far = pickupConstraints("far");
    expect(far.noiseSuppression).toBe(false);
    expect(far.echoCancellation).toBe(true);
    expect(far.autoGainControl).toBe(true);
  });
});

describe("focusTerms", () => {
  it("keeps short roster names and topic words", () => {
    const terms = focusTerms(context());
    expect(terms).toContain("ada");
    expect(terms).toContain("obi");
    expect(terms).toContain("quarterly");
    expect(terms).toContain("earnings");
  });

  it("ignores a default session title and aside lines in scratch", () => {
    const terms = focusTerms(
      focusContext({
        title: "Meeting · Friday sync",
        kind: "meeting",
        participants: [ada],
        scratch: "Pause the same-day promise\nwifi password is on the router",
      }),
    );
    expect(terms).not.toContain("meeting");
    expect(terms).not.toContain("friday");
    expect(terms).toContain("pause");
    expect(terms).not.toContain("wifi");
    expect(terms).not.toContain("router");
  });
});

describe("off-topic and noise lines", () => {
  it("treats media tags and repeated filler as noise in every mode", () => {
    expect(isNoiseLine("[music]")).toBe(true);
    expect(isNoiseLine("Thank you for watching.")).toBe(true);
    expect(isNoiseLine("yeah yeah yeah yeah yeah")).toBe(true);
    expect(isOffTopic("[applause]", context(), "off")).toBe(true);
  });

  it("drops clear side talk in balanced mode, even behind a speaker label", () => {
    expect(isOffTopic("Speaker 1: Can somebody share the wifi password?", context(), "balanced")).toBe(true);
    expect(isOffTopic("Ada: What is for lunch today?", context(), "balanced")).toBe(true);
  });

  it("keeps lines that carry a decision, a number, or a roster name", () => {
    expect(isOffTopic("We decided to pause the same-day promise until Friday.", context(), "balanced")).toBe(false);
    expect(
      isOffTopic("The quarterly revenue came in at 12 percent above plan.", context(), "balanced"),
    ).toBe(false);
    expect(isOffTopic("Obi said the file reached the bank late.", context(), "balanced")).toBe(false);
    expect(isOffTopic("Chinedu will send the merchant note before four.", context(), "strict")).toBe(false);
  });

  it("keeps every line when focus is off, except noise", () => {
    expect(isOffTopic("Can somebody share the wifi password?", context(), "off")).toBe(false);
    expect(isOffTopic("[laughter]", context(), "off")).toBe(true);
  });

  it("strict also drops lines that never touch the title or the room", () => {
    const unrelated = "We watched a film about a lighthouse keeper last night.";
    expect(isOffTopic(unrelated, context(), "balanced")).toBe(false);
    expect(isOffTopic(unrelated, context(), "strict")).toBe(true);
  });

  it("strict keeps an unrelated line when a roster name is in it", () => {
    expect(isOffTopic("Obi laughed at a film about a lighthouse keeper.", context(), "strict")).toBe(false);
  });
});

describe("filterLines", () => {
  it("counts what it hides and keeps the rest in order", () => {
    const lines = [
      line("Speaker 1: Revenue is up 12 percent on the quarter."),
      line("Speaker 2: Who has the wifi password?"),
      line("[music]"),
      line("Ada: We agreed to pause the promise until Friday."),
    ];
    const result = filterLines(lines, context(), "balanced");
    expect(result.kept.map((item) => item.id)).toEqual([
      "Speaker 1: Revenue is up 12 percent on the quarter.",
      "Ada: We agreed to pause the promise until Friday.",
    ]);
    expect(result.hidden).toBe(2);
  });

  it("keeps every non-noise line when focus is off", () => {
    const lines = [line("Who has the wifi password?"), line("[applause]")];
    const result = filterLines(lines, context(), "off");
    expect(result.kept).toHaveLength(1);
    expect(result.hidden).toBe(1);
  });
});

describe("knownNames", () => {
  it("trims names, drops blanks and caps the list", () => {
    const people = [
      { id: "a", name: " Ada " },
      { id: "b", name: "" },
      ...Array.from({ length: 30 }, (_, index) => ({ id: `x${index}`, name: `Person ${index}` })),
    ];
    const names = knownNames(people);
    expect(names[0]).toBe("Ada");
    expect(names).not.toContain("");
    expect(names).toHaveLength(20);
  });
});