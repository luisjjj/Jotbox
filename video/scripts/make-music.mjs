import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Original minimal ambient score for the JotBox walkthrough.
// Warm major pads, soft felt mallets, distant bells, and air. No samples, no vocals.

const SAMPLE_RATE = 48_000;
const DURATION = 168;
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const CHORDS = [
  { name: "Cmaj9", bass: 36, notes: [48, 52, 55, 59, 62] },
  { name: "Gadd9", bass: 43, notes: [55, 59, 62, 64, 67] },
  { name: "Am7", bass: 45, notes: [57, 60, 64, 67, 72] },
  { name: "Fmaj9", bass: 41, notes: [53, 57, 60, 64, 67] },
];

const TOTAL = Math.floor(DURATION * SAMPLE_RATE);
const left = new Float32Array(TOTAL);
const right = new Float32Array(TOTAL);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20261117);

const TABLE_SIZE = 4096;
const SINE = new Float32Array(TABLE_SIZE);
for (let index = 0; index < TABLE_SIZE; index += 1) {
  SINE[index] = Math.sin((index / TABLE_SIZE) * Math.PI * 2);
}

function wave(phase) {
  const wrapped = phase - Math.floor(phase);
  const x = wrapped * TABLE_SIZE;
  const index = x | 0;
  const frac = x - index;
  const a = SINE[index & (TABLE_SIZE - 1)];
  const b = SINE[(index + 1) & (TABLE_SIZE - 1)];
  return a + (b - a) * frac;
}

function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function smooth(x) {
  const clamped = Math.min(1, Math.max(0, x));
  return clamped * clamped * (3 - 2 * clamped);
}

function envelope(t, duration, attack, release) {
  if (t <= 0 || t >= duration) return 0;
  return smooth(t / attack) * smooth((duration - t) / release);
}

function panGains(pan) {
  const angle = ((Math.max(-1, Math.min(1, pan)) + 1) / 4) * Math.PI * 2;
  return { l: Math.cos(angle), r: Math.sin(angle) };
}

function addPad(midi, startSec, durationSec, amp, pan) {
  const frequency = midiToFreq(midi);
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const length = Math.min(TOTAL - start, Math.floor(durationSec * SAMPLE_RATE));
  const attack = 2.6;
  const release = 3.4;
  const layers = [
    { detune: -0.0016, pan: pan - 0.28 },
    { detune: 0.0017, pan: pan + 0.28 },
  ];
  const cutoff = 2600;
  const coef = 1 - Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE);

  for (const layer of layers) {
    const gains = panGains(layer.pan);
    let phase = random();
    let phase2 = random();
    let phase3 = random();
    let lp = 0;
    const base = frequency * (1 + layer.detune);

    for (let i = 0; i < length; i += 1) {
      const t = i / SAMPLE_RATE;
      const env = envelope(t, durationSec, attack, release);
      if (env <= 0) {
        phase += base / SAMPLE_RATE;
        phase2 += (base * 2) / SAMPLE_RATE;
        phase3 += (base * 3) / SAMPLE_RATE;
        continue;
      }
      const vibrato = 1 + 0.0007 * Math.sin(Math.PI * 2 * 0.09 * t + layer.detune * 900);
      const tremolo = 1 + 0.02 * Math.sin(Math.PI * 2 * 0.05 * t + layer.pan * 2);
      phase += (base * vibrato) / SAMPLE_RATE;
      phase2 += (base * 2 * vibrato) / SAMPLE_RATE;
      phase3 += (base * 3 * vibrato) / SAMPLE_RATE;
      const tone = wave(phase) + 0.32 * wave(phase2) + 0.12 * wave(phase3);
      lp += coef * (tone - lp);
      const value = lp * env * tremolo * amp;
      const index = start + i;
      left[index] += value * gains.l;
      right[index] += value * gains.r;
    }
  }
}

function addBass(midi, startSec, durationSec, amp) {
  const frequency = midiToFreq(midi);
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const length = Math.min(TOTAL - start, Math.floor(durationSec * SAMPLE_RATE));
  let phase = 0;
  let warm = 0;
  const coef = 1 - Math.exp((-2 * Math.PI * 320) / SAMPLE_RATE);

  for (let i = 0; i < length; i += 1) {
    const t = i / SAMPLE_RATE;
    const env = envelope(t, durationSec, 2.2, 2.8);
    phase += (frequency * (1 + 0.0007 * Math.sin(Math.PI * 2 * 0.07 * t))) / SAMPLE_RATE;
    const tone = wave(phase) + 0.22 * wave(phase * 2);
    warm += coef * (tone - warm);
    const value = warm * env * amp;
    const index = start + i;
    left[index] += value * 0.5;
    right[index] += value * 0.5;
  }
}

function addBell(midi, startSec, amp, pan, decay = 2.6) {
  const frequency = midiToFreq(midi);
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const length = Math.min(TOTAL - start, Math.floor(6.5 * SAMPLE_RATE));
  const gains = panGains(pan);
  let phase = 0;

  for (let i = 0; i < length; i += 1) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t / decay) * smooth(t / 0.02);
    phase += frequency / SAMPLE_RATE;
    const tone = wave(phase) + 0.42 * wave(phase * 2.01) + 0.18 * wave(phase * 3.99);
    const value = tone * env * amp;
    const index = start + i;
    left[index] += value * gains.l;
    right[index] += value * gains.r;
  }
}

function addPluck(midi, startSec, amp, pan, decay = 1.7) {
  const frequency = midiToFreq(midi);
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const length = Math.min(TOTAL - start, Math.floor(7 * SAMPLE_RATE));
  const gains = panGains(pan);
  let phase = 0;
  let phase2 = 0;
  let phase3 = 0;
  let lp = 0;
  const coef = 1 - Math.exp((-2 * Math.PI * 2400) / SAMPLE_RATE);

  for (let i = 0; i < length; i += 1) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t / decay) * smooth(t / 0.012);
    phase += frequency / SAMPLE_RATE;
    phase2 += (frequency * 2.002) / SAMPLE_RATE;
    phase3 += (frequency * 3.001) / SAMPLE_RATE;
    const tone = wave(phase) + 0.3 * wave(phase2) + 0.1 * wave(phase3);
    lp += coef * (tone - lp);
    const value = lp * env * amp;
    const index = start + i;
    left[index] += value * gains.l;
    right[index] += value * gains.r;
  }
}

function addAir() {
  const noise = mulberry32(77123);
  let lpL = 0;
  let lpR = 0;
  const coef = 1 - Math.exp((-2 * Math.PI * 1500) / SAMPLE_RATE);
  for (let i = 0; i < TOTAL; i += 1) {
    const t = i / SAMPLE_RATE;
    const swell = 0.55 + 0.45 * Math.sin(Math.PI * 2 * 0.018 * t + 1.2);
    const nL = noise() * 2 - 1;
    const nR = noise() * 2 - 1;
    lpL += coef * (nL - lpL);
    lpR += coef * (nR - lpR);
    left[i] += lpL * 0.006 * swell;
    right[i] += lpR * 0.006 * swell;
  }
}

function addEcho(source, delaySec, feedback, wet) {
  const delay = Math.floor(delaySec * SAMPLE_RATE);
  const copy = new Float32Array(source.length);
  for (let i = delay; i < source.length; i += 1) {
    copy[i] = source[i - delay] + copy[i - delay] * feedback;
  }
  for (let i = 0; i < source.length; i += 1) {
    source[i] += copy[i] * wet;
  }
}

function reverbChannel(input) {
  const combs = [1694, 1759, 1622, 1547];
  const allpass = [245, 605];
  const output = new Float32Array(input.length);
  const sum = new Float32Array(input.length);

  for (const delay of combs) {
    const buffer = new Float32Array(delay);
    let index = 0;
    let damp = 0;
    for (let i = 0; i < input.length; i += 1) {
      const delayed = buffer[index];
      damp = delayed * 0.82 + damp * 0.18;
      buffer[index] = input[i] + damp * 0.86;
      sum[i] += delayed * 0.25;
      index = (index + 1) % delay;
    }
  }

  for (const delay of allpass) {
    const buffer = new Float32Array(delay);
    let index = 0;
    for (let i = 0; i < input.length; i += 1) {
      const delayed = buffer[index];
      const current = sum[i];
      buffer[index] = current + delayed * 0.5;
      sum[i] = delayed - current * 0.5;
      index = (index + 1) % delay;
    }
  }

  output.set(sum);
  return output;
}

const chordStarts = [];
for (let t = 0; t < DURATION; t += 8) chordStarts.push(t);

chordStarts.forEach((start, chordIndex) => {
  const chord = CHORDS[chordIndex % CHORDS.length];
  const duration = Math.min(9.2, DURATION - start + 1);
  chord.notes.forEach((midi, noteIndex) => {
    const pan = (noteIndex / (chord.notes.length - 1)) * 1.2 - 0.6;
    addPad(midi, start, duration, 0.042, pan);
  });
  addBass(chord.bass, start, duration, 0.06);

  const arp = [chord.notes[1] + 12, chord.notes[3] + 12, chord.notes[2] + 12, chord.notes[4] + 12];
  addPluck(arp[0], start + 1.2, 0.026, -0.35);
  addPluck(arp[1], start + 2.9, 0.02, 0.3);
  addPluck(arp[2], start + 4.6, 0.024, -0.15);
  addPluck(arp[3], start + 6.2, 0.018, 0.4);

  const bellChoices = [chord.notes[3] + 12, chord.notes[4] + 12, chord.notes[2] + 24];
  const bell = bellChoices[chordIndex % bellChoices.length];
  addBell(bell, start + 2.2, 0.02, chordIndex % 2 === 0 ? -0.55 : 0.55);
  if (chordIndex % 3 === 1) {
    addBell(bell + 7, start + 5.1, 0.013, 0.25, 3.4);
  }
});

addAir();

// Slow arrangement moves so the score follows the cuts.
addEcho(left, 0.75, 0.34, 0.12);
addEcho(right, 1.125, 0.3, 0.1);

const wetL = reverbChannel(left);
const wetR = reverbChannel(right);
for (let i = 0; i < TOTAL; i += 1) {
  left[i] += wetL[i] * 0.28;
  right[i] += wetR[i] * 0.28;
}

function sectionGain(t) {
  const points = [
    [0, 0.55],
    [6, 0.72],
    [24, 0.9],
    [30, 1],
    [54, 1],
    [58, 0.94],
    [82, 0.94],
    [86, 1],
    [106, 1],
    [110, 0.96],
    [130, 0.96],
    [134, 1],
    [146, 1],
    [150, 0.92],
    [160, 0.8],
    [168, 0],
  ];
  for (let index = 1; index < points.length; index += 1) {
    const [t1, g1] = points[index];
    if (t <= t1) {
      const [t0, g0] = points[index - 1];
      const progress = smooth((t - t0) / Math.max(0.001, t1 - t0));
      return g0 + (g1 - g0) * progress;
    }
  }
  return 0;
}

let peak = 0;
for (let i = 0; i < TOTAL; i += 1) {
  const t = i / SAMPLE_RATE;
  const gain = sectionGain(t);
  left[i] *= gain;
  right[i] *= gain;
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
}

const target = 0.86;
const scale = peak > 0 ? target / peak : 1;
for (let i = 0; i < TOTAL; i += 1) {
  left[i] *= scale;
  right[i] *= scale;
}

function writeWav(filename, channels) {
  const buffer = Buffer.alloc(44 + TOTAL * channels.length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + TOTAL * channels.length * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels.length, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * channels.length * 2, 28);
  buffer.writeUInt16LE(channels.length * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(TOTAL * channels.length * 2, 40);

  let offset = 44;
  for (let i = 0; i < TOTAL; i += 1) {
    for (const channel of channels) {
      const value = Math.max(-1, Math.min(1, channel[i]));
      buffer.writeInt16LE(Math.round(value * 32767), offset);
      offset += 2;
    }
  }
  fs.writeFileSync(filename, buffer);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const wavPath = path.join(OUT_DIR, "music.wav");
writeWav(wavPath, [left, right]);
console.log(`Wrote ${wavPath} (${DURATION}s, peak ${target.toFixed(2)})`);
