import { describe, expect, it } from "vitest";
import { LIVE_SPEECH_RMS, chunkHasSpeech, createLevelWindow, noteLevel } from "./liveGate";

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
