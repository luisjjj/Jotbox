import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  freeSessionsEstimate,
  getHabit,
  getRegion,
  getSavedPeople,
  getSessionLength,
  languageOptionsForRegion,
  normalizeLanguage,
  SAMPLE_DEMOS,
  savePeople,
  setHabit,
  setPreferredKind,
  setRegion,
  setSessionLength,
  takePendingKind,
} from "./onboarding";

let store: Map<string, string>;

beforeEach(() => {
  store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => store.get(name) ?? null,
    setItem: (name: string, value: string) => store.set(name, value),
    removeItem: (name: string) => store.delete(name),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("onboarding region", () => {
  it("keeps every language when no region has been chosen yet", () => {
    expect(getRegion()).toBeNull();
    expect(languageOptionsForRegion().map((option) => option.value)).toEqual(["en", "pcm", "yo", "ha", "ig"]);
  });

  it("gives an international account English only", () => {
    setRegion("international");
    expect(getRegion()).toBe("international");
    const options = languageOptionsForRegion();
    expect(options.map((option) => option.value)).toEqual(["en"]);
    expect(options[0].hint).not.toMatch(/Nigeria/);
    expect(normalizeLanguage("pcm")).toBe("en");
    expect(normalizeLanguage("en")).toBe("en");
  });

  it("keeps Pidgin and the Nigerian languages for a Nigerian account", () => {
    setRegion("nigeria");
    expect(languageOptionsForRegion().map((option) => option.value)).toEqual(["en", "pcm", "yo", "ha", "ig"]);
    expect(normalizeLanguage("pcm")).toBe("pcm");
  });
});

describe("onboarding preferences", () => {
  it("keeps clean, unique people", () => {
    expect(savePeople([" Ada ", "ada", "", "Chinedu"])).toEqual(["Ada", "Chinedu"]);
    expect(getSavedPeople().map((person) => person.name)).toEqual(["Ada", "Chinedu"]);
    expect(getSavedPeople().every((person) => person.external)).toBe(true);
  });

  it("remembers the record habit and its length", () => {
    setHabit("lecture");
    setSessionLength("long");
    expect(getHabit()).toBe("lecture");
    expect(getSessionLength()).toBe("long");
  });

  it("hands the preferred capture kind to Listen once", () => {
    setPreferredKind("seminar");
    expect(takePendingKind()).toBe("seminar");
    expect(takePendingKind()).toBeNull();
  });

  it("estimates how far the free minutes go", () => {
    expect(freeSessionsEstimate("short")).toMatch(/four/);
    expect(freeSessionsEstimate("medium")).toMatch(/two/);
    expect(freeSessionsEstimate("long")).toMatch(/one/);
  });
});

describe("sample rooms", () => {
  it("keeps Pidgin lines verbatim for the Nigerian path", () => {
    const demo = SAMPLE_DEMOS.nigeria;
    expect(demo.lines.some((line) => /Make we no dey promise/.test(line.text))).toBe(true);
    expect(demo.summary).toMatch(/I go send the merchant note/);
    expect(demo.highlights.length).toBeGreaterThan(1);
  });

  it("uses plain English for the international path", () => {
    const demo = SAMPLE_DEMOS.international;
    expect(demo.lines.every((line) => !/wetin|dey|na the|go send/.test(line.text))).toBe(true);
    expect(demo.summary.length).toBeGreaterThan(20);
  });
});
