import type { PickupMode } from "./listening";

export interface ConditioningProfile {
  highpassHz: number;
  thresholdDb: number;
  kneeDb: number;
  ratio: number;
  attackSec: number;
  releaseSec: number;
  makeupGain: number;
}

export function conditioningProfile(mode: PickupMode): ConditioningProfile {
  if (mode === "far") {
    return {
      highpassHz: 75,
      thresholdDb: -24,
      kneeDb: 18,
      ratio: 3,
      attackSec: 0.004,
      releaseSec: 0.26,
      makeupGain: 2.3,
    };
  }
  return {
    highpassHz: 90,
    thresholdDb: -18,
    kneeDb: 12,
    ratio: 3,
    attackSec: 0.004,
    releaseSec: 0.22,
    makeupGain: 1.8,
  };
}

export function shapeRoomAudio(input: AudioNode, context: AudioContext, mode: PickupMode): AudioNode {
  const profile = conditioningProfile(mode);
  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = profile.highpassHz;

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = profile.thresholdDb;
  compressor.knee.value = profile.kneeDb;
  compressor.ratio.value = profile.ratio;
  compressor.attack.value = profile.attackSec;
  compressor.release.value = profile.releaseSec;

  const makeup = context.createGain();
  makeup.gain.value = profile.makeupGain;

  input.connect(highpass);
  highpass.connect(compressor);
  compressor.connect(makeup);
  return makeup;
}

export function conditionStream(stream: MediaStream, context: AudioContext, mode: PickupMode): MediaStream {
  const source = context.createMediaStreamSource(stream);
  const destination = context.createMediaStreamDestination();
  shapeRoomAudio(source, context, mode).connect(destination);
  return destination.stream;
}
