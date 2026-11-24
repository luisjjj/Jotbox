import { describe, expect, it } from "vitest";
import {
  LIVE_SPEECH_RMS,
  chunkHasSpeech,
  createLevelWindow,
  isPauseForBoundary,
  noteLevel,
} from "./liveGate";

describe("live silence gate", () => {
  it("keeps a segment that contains a voice", () => {
    const window = createLevelWindow();
    noteLevel(window, 0.002);
    noteLevel(window, 0.09);
    noteLevel(window, 0.001);
    expect(chunkHasSpeech(window)).toBe(true);
  });

  it("skips a segment that never rises above the gate", () => {
    const window = createLevelWindow();
    noteLevel(window, 0.001);
    noteLevel(window, LIVE_SPEECH_RMS / 2);
    expect(chunkHasSpeech(window)).toBe(false);
  });

  it("keeps one loud word inside a mostly quiet segment", () => {
    const window = createLevelWindow();
    for (let index = 0; index < 300; index += 1) noteLevel(window, 0.001);
    noteLevel(window, 0.05);
    expect(chunkHasSpeech(window)).toBe(true);
  });

  it("fails open when the browser gives no level samples", () => {
    expect(chunkHasSpeech(createLevelWindow())).toBe(true);
  });

  it("ignores values that cannot be a level", () => {
    const window = createLevelWindow();
    noteLevel(window, Number.NaN);
    noteLevel(window, -0.1);
    expect(window.samples).toBe(0);
    expect(chunkHasSpeech(window)).toBe(true);
  });

  it("accepts a custom threshold", () => {
    const window = createLevelWindow();
    noteLevel(window, 0.02);
    expect(chunkHasSpeech(window, 0.03)).toBe(false);
    expect(chunkHasSpeech(window, 0.01)).toBe(true);
  });
});

describe("live segment boundary", () => {
  it("cuts in a gap below the speech level", () => {
    expect(isPauseForBoundary(0.002)).toBe(true);
    expect(isPauseForBoundary(LIVE_SPEECH_RMS / 2)).toBe(true);
  });

  it("never cuts while speech is at or above the gate", () => {
    expect(isPauseForBoundary(LIVE_SPEECH_RMS)).toBe(false);
    expect(isPauseForBoundary(0.08)).toBe(false);
  });

  it("does not treat a missing level as a pause", () => {
    expect(isPauseForBoundary(Number.NaN)).toBe(false);
    expect(isPauseForBoundary(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("accepts a custom threshold", () => {
    expect(isPauseForBoundary(0.02, 0.03)).toBe(true);
    expect(isPauseForBoundary(0.02, 0.01)).toBe(false);
  });
});
