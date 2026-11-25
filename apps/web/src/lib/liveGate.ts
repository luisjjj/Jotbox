// Live chunks with no speech in them still bill as audio if they are sent, so
// the engine watches the room level of each segment and keeps the paid pass for
// segments that actually carry a voice. The peak, not the average, decides:
// one soft word inside a short, mostly quiet chunk must not be dropped.
export const LIVE_SPEECH_RMS = 0.012;

export interface LiveLevelWindow {
  peak: number;
  samples: number;
}

export function createLevelWindow(): LiveLevelWindow {
  return { peak: 0, samples: 0 };
}

export function noteLevel(window: LiveLevelWindow, rms: number) {
  if (!Number.isFinite(rms) || rms <= 0) return;
  window.samples += 1;
  if (rms > window.peak) window.peak = rms;
}

// Fail open: when the browser gives no level samples, send the chunk rather
// than lose words the person actually said.
export function chunkHasSpeech(window: LiveLevelWindow, threshold = LIVE_SPEECH_RMS) {
  return window.samples === 0 || window.peak >= threshold;
}

// A cut through a word costs accuracy in both halves, so the segment keeps
// recording past its target until the room drops below speech level and the
// cut lands in that gap. Speech that never pauses is closed by the engine's
// hard deadline instead.
export function isPauseForBoundary(rms: number, threshold = LIVE_SPEECH_RMS) {
  return Number.isFinite(rms) && rms < threshold;
}
