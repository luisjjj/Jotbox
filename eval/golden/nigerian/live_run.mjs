#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const MAX_SECONDS = 180;
const SCRIBE_PER_HOUR = 0.2;

const SETS = {
  english: {
    manifest: "eval/golden/nigerian/bench-english.json",
    out: "eval/results/scribe-nigerian-english",
    language: "en",
  },
  pidgin: {
    manifest: "eval/golden/nigerian/bench-pidgin.json",
    out: "eval/results/scribe-pidgin-fresh-17",
    language: "pcm",
  },
};

const PREDICTIONS = {
  english: "eval/results/scribe-nigerian-english/predictions.json",
  pidgin: "eval/results/scribe-pidgin-fresh-17/predictions.json",
  combined: "eval/results/scribe-nigerian-combined/predictions.json",
};

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function hasKey() {
  if (process.env.ELEVENLABS_API_KEY) return true;
  for (const file of [".env", ".env.local"]) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    if (/^ELEVENLABS_API_KEY\s*=\s*\S+/m.test(readFileSync(path, "utf8"))) return true;
  }
  return false;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
  if (result.error) fail(`Could not start ${command}: ${result.error.message}`, 1);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const setName = argValue("--set");
if (!SETS[setName]) {
  fail("Usage: node eval/golden/nigerian/live_run.mjs --set english|pidgin");
}

if (process.env.ALLOW_PAID_EVAL !== "1") {
  fail(
    "This check spends paid Scribe audio. Set ALLOW_PAID_EVAL=1 after approving the run.\n" +
      "Each set is capped at 180 seconds; the script refuses a manifest above that.",
  );
}
if (!hasKey()) {
  fail("No ELEVENLABS_API_KEY in the environment, .env or .env.local.");
}

const spec = SETS[setName];
const manifest = JSON.parse(readFileSync(join(ROOT, spec.manifest), "utf8"));
const seconds = (manifest.clips ?? []).reduce((total, clip) => total + (Number(clip.seconds) || 0), 0);
if (seconds > MAX_SECONDS) {
  fail(
    `The ${setName} manifest is ${seconds.toFixed(1)} seconds, above the ${MAX_SECONDS}s paid-test cap. ` +
      "Shrink the slice before running.",
  );
}
console.log(
  `Paid check: ${manifest.clips.length} ${setName} clips, ${seconds.toFixed(1)}s, ` +
      `about $${((seconds / 3600) * SCRIBE_PER_HOUR).toFixed(3)} of Scribe audio.`,
);

run(process.execPath, [
  "--env-file-if-exists=.env",
  "--env-file-if-exists=.env.local",
  "eval/run_pipeline.mjs",
  "--manifest",
  spec.manifest,
  "--no-notes",
  "--out",
  spec.out,
  "--language",
  spec.language,
]);

const haveBoth = existsSync(join(ROOT, PREDICTIONS.english)) && existsSync(join(ROOT, PREDICTIONS.pidgin));
if (haveBoth) {
  run(process.execPath, [
    "eval/py.mjs",
    "eval/golden/nigerian/combine_bench.py",
    "--pidgin",
    PREDICTIONS.pidgin,
    "--english",
    PREDICTIONS.english,
  ]);
}

const liveBaseline = "eval/results/naija-live-baseline";
const setNameArg = haveBoth ? "all" : setName;
run(process.execPath, [
  "eval/py.mjs",
  "eval/golden/nigerian/freeze_baseline.py",
  "--out",
  liveBaseline,
  "--set",
  setNameArg,
]);

run(process.execPath, [
  "eval/py.mjs",
  "eval/golden/nigerian/gate.py",
  "--baseline-dir",
  liveBaseline,
  "--set",
  setNameArg,
  "--list",
  "5",
]);
