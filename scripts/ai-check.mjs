#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = new Set(process.argv.slice(2));
if (args.has("--mock")) process.env.JOTBOX_AI_MOCK = "1";

const { aiStatus, enhanceSession, transcribeAudio } = await import("../server/api/ai.mjs");

const status = aiStatus();
const SAMPLE_TRANSCRIPT = [
  "Speaker 1: Ah, wetin happen to the Friday payout?",
  "Speaker 2: E be like the bank dey slow us down, the file reach them late.",
  "Speaker 1: No wahala, make we pause the same-day promise until the cutoff hold.",
  "Speaker 2: I go send the merchant note before four, plain language, no big words.",
  "Speaker 1: I go re-pull the two failed batches and confirm say nothing duplicate.",
].join("\n");

function line(label, value) {
  console.log(`${label.padEnd(14)} ${value ?? "—"}`);
}

function providerLabel(value) {
  if (value === "groq") return "Groq free tier";
  if (value === "self-hosted") return "Self-hosted Whisper";
  if (value === "openrouter") return "OpenRouter free model";
  if (value === "xai") return "xAI";
  if (value === "demo") return "Local demo (no network)";
  return "not configured";
}

line("Reading", providerLabel(status.transcribe));
line("Writing", providerLabel(status.notes));
line("Pidgin", status.pidgin ? "on · en-NG" : "off");
line("Tone", status.tone);

if (!status.ai) {
  console.log("\nNo reading or writing service is configured.");
  console.log("Add GROQ_API_KEY to .env for the free tier, or run: npm run ai:demo");
  process.exit(1);
}

if (!args.has("--test")) {
  console.log("\nConfiguration looks ready. Run `npm run ai:test` to try a sample.");
  process.exit(0);
}

const audioArg = [...args].find((arg) => arg.startsWith("--audio="))?.slice("--audio=".length);
const samplePath = resolve(audioArg || ".shots/ai-sample.wav");
let audio = null;

if (status.transcribe === "demo") {
  audio = Buffer.from("demo");
} else {
  if (!existsSync(samplePath)) {
    const made = spawnSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/make-sample-audio.ps1", "-Out", samplePath],
      { encoding: "utf8" },
    );
    if (made.status !== 0) {
      console.error("\nCould not create a sample. Pass --audio=path/to/clip.wav");
      console.error(made.stderr || made.stdout || "");
      process.exit(1);
    }
  }
  audio = readFileSync(samplePath);
  console.log(`\nSample         ${samplePath} (${(audio.length / 1024).toFixed(1)} KB)`);
}

console.log("\nReading the sample…");
const started = Date.now();
try {
  const transcript = await transcribeAudio({
    buffer: audio,
    contentType: "audio/wav",
    filename: "jotbox-sample.wav",
  });
  console.log(`\nTranscript (${transcript.provider}, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  console.log(transcript.text || "(no words)");
  console.log(`Words          ${transcript.words.length}`);

  console.log("\nWriting the notes…");
  const notes = await enhanceSession({
    kind: "meeting",
    title: "Friday payout review",
    scratch: "Pause same-day promise\nAda: merchant note before four",
    transcript: transcript.text || SAMPLE_TRANSCRIPT,
    tone: status.tone,
  });
  console.log(`\nNotes (${notes.provider})`);
  console.log(notes.title);
  console.log("");
  console.log(notes.summary);
  for (const highlight of notes.highlights) console.log(`  - ${highlight}`);
  for (const action of notes.actions) console.log(`  [ ] ${action.owner}: ${action.text}`);
} catch (error) {
  console.error(`\nFailed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
