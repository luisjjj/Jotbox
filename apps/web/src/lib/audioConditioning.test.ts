import { describe, expect, it, vi } from "vitest";
import { conditioningProfile, shapeRoomAudio } from "./audioConditioning";

function param(value = 0) {
  return { value };
}

function node() {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

function fakeContext() {
  const filters: ReturnType<typeof fakeFilter>[] = [];
  const compressors: ReturnType<typeof fakeCompressor>[] = [];
  const gains: ReturnType<typeof fakeGain>[] = [];
  const context = {
    createBiquadFilter: () => {
      const item = fakeFilter();
      filters.push(item);
      return item;
    },
    createDynamicsCompressor: () => {
      const item = fakeCompressor();
      compressors.push(item);
      return item;
    },
    createGain: () => {
      const item = fakeGain();
      gains.push(item);
      return item;
    },
  };
  return { context: context as unknown as AudioContext, filters, compressors, gains };
}

function fakeFilter() {
  return { ...node(), type: "", frequency: param() };
}

function fakeCompressor() {
  return {
    ...node(),
    threshold: param(),
    knee: param(),
    ratio: param(),
    attack: param(),
    release: param(),
  };
}

function fakeGain() {
  return { ...node(), gain: param(1) };
}

describe("audio conditioning", () => {
  it("lifts far voices harder than balanced pickup", () => {
    const balanced = conditioningProfile("balanced");
    const far = conditioningProfile("far");

    expect(far.makeupGain).toBeGreaterThan(balanced.makeupGain);
    expect(far.thresholdDb).toBeLessThan(balanced.thresholdDb);
    expect(far.highpassHz).toBeLessThan(balanced.highpassHz);
    expect(balanced.ratio).toBeGreaterThan(1);
    expect(far.ratio).toBeGreaterThan(1);
    expect(far.attackSec).toBeGreaterThan(0);
    expect(far.releaseSec).toBeGreaterThan(far.attackSec);
  });

  it("wires a high-pass, compressor and makeup gain in order", () => {
    const { context, filters, compressors, gains } = fakeContext();
    const input = node() as unknown as AudioNode;

    const output = shapeRoomAudio(input, context, "far");
    const profile = conditioningProfile("far");

    expect(filters).toHaveLength(1);
    expect(compressors).toHaveLength(1);
    expect(gains).toHaveLength(1);
    expect(filters[0].type).toBe("highpass");
    expect(filters[0].frequency.value).toBe(profile.highpassHz);
    expect(compressors[0].threshold.value).toBe(profile.thresholdDb);
    expect(compressors[0].knee.value).toBe(profile.kneeDb);
    expect(compressors[0].ratio.value).toBe(profile.ratio);
    expect(compressors[0].attack.value).toBe(profile.attackSec);
    expect(compressors[0].release.value).toBe(profile.releaseSec);
    expect(gains[0].gain.value).toBe(profile.makeupGain);
    expect(input.connect).toHaveBeenCalledWith(filters[0]);
    expect(filters[0].connect).toHaveBeenCalledWith(compressors[0]);
    expect(compressors[0].connect).toHaveBeenCalledWith(gains[0]);
    expect(output).toBe(gains[0]);
  });
});
