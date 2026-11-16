#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const arg = (name, fallback) => {
  const inline = argv.find((item) => item.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--")) return argv[index + 1];
  return fallback;
};

if (has("mock")) {
  process.env.JOTBOX_AI_MOCK = "1";
  for (const name of ["GROQ_API_KEY", "WHISPER_BASE_URL", "XAI_API_KEY", "OPENROUTER_API_KEY"]) {
    delete process.env[name];
  }
}

const { aiStatus, enhanceSession, sttPrompt, transcribeAudio } = await import("../server/api/ai.mjs");

const manifestPath = resolve(process.cwd(), arg("manifest", join(here, "golden/manifest.json")));
const manifestDir = dirname(manifestPath);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const only = arg("only", "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const ids = arg("id", "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const limit = Number(arg("limit", "0")) || 0;
const pauseMs = Math.max(0, Number(arg("pause", "0")) || 0);
const retries = Math.max(0, Number(arg("retries", "3")) || 0);
const notesEnabled = !has("no-notes");
const wantGlossary = has("glossary");
const wantNormalize = has("normalize");
const mock = has("mock");
const promptFile = arg("prompt", "");

if (promptFile) {
  const promptPath = resolve(process.cwd(), promptFile);
  if (!existsSync(promptPath)) {
    console.error(`Prompt file not found: ${promptPath}`);
    process.exit(1);
  }
  process.env.JOTBOX_STT_PROMPT = readFileSync(promptPath, "utf8").trim();
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = resolve(process.cwd(), arg("out", join(here, "results", stamp)));

const status = aiStatus();

function findOnPath(name) {
  const probe = spawnSync(name, ["-version"], { stdio: "ignore" });
  return probe.status === 0 ? name : null;
}

function findWindowsFfmpeg() {
  if (process.platform !== "win32") return null;
  const candidates = [];
  for (const root of [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env.ProgramData]) {
    if (!root) continue;
    const winget = join(root, "Microsoft", "WinGet", "Packages");
    if (existsSync(winget)) {
      for (const pkg of safeReaddir(winget)) {
        if (!pkg.startsWith("Gyan.FFmpeg")) continue;
        for (const build of safeReaddir(join(winget, pkg))) {
          candidates.push(join(winget, pkg, build, "bin", "ffmpeg.exe"));
        }
      }
    }
    candidates.push(join(root, "ffmpeg", "bin", "ffmpeg.exe"));
    candidates.push(join(root, "chocolatey", "bin", "ffmpeg.exe"));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && spawnSync(candidate, ["-version"], { stdio: "ignore" }).status === 0) {
      return candidate;
    }
  }
  return null;
}

function safeReaddir(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function resolveFfmpeg() {
  const configured = process.env.FFMPEG_PATH;
  if (configured) {
    if (spawnSync(configured, ["-version"], { stdio: "ignore" }).status === 0) return configured;
    return null;
  }
  return findOnPath("ffmpeg") || findWindowsFfmpeg();
}

const ffmpeg = resolveFfmpeg();
const ffmpegAvailable = () => Boolean(ffmpeg);

const CONTENT_TYPES = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
};

const NUMBER_WORDS = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
  thirty: "30",
  forty: "40",
  fifty: "50",
  sixty: "60",
  seventy: "70",
  eighty: "80",
  ninety: "90",
};

function matchTokens(text) {
  const cleaned = String(text || "")
    .toLowerCase()
    .replace(/₦\s*([\d,.]+)/g, " $1 naira ")
    .replace(/ngn\s*([\d,.]+)/g, " $1 naira ")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned.split(/\s+/).map((token) => NUMBER_WORDS[token] ?? token);
}

function containsSequence(haystack, needle) {
  if (!needle.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let hit = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}

function keywordFound(keyword, text) {
  const alternatives = Array.isArray(keyword) ? keyword : [keyword];
  const haystack = matchTokens(text);
  return alternatives.some((alternative) => containsSequence(haystack, matchTokens(alternative)));
}

function flattenKeywords(clip) {
  return (clip.keywords || []).flatMap((keyword) => (Array.isArray(keyword) ? keyword : [keyword]));
}

function loadGlossary() {
  const terms = [];
  if (manifest.glossary) {
    const glossaryPath = resolve(manifestDir, manifest.glossary);
    if (existsSync(glossaryPath)) {
      for (const line of readFileSync(glossaryPath, "utf8").split(/\r?\n/)) {
        const term = line.trim();
        if (term && !term.startsWith("#")) terms.push(term);
      }
    }
  }
  return terms;
}

const glossary = loadGlossary();

function clipGlossary(clip) {
  return [...glossary, ...(clip.glossary || []), ...flattenKeywords(clip), ...(clip.names || [])];
}

function coverage(clip, prompt) {
  const targets = clip.keywords || [];
  if (!targets.length) return null;
  const hits = targets.filter((keyword) => keywordFound(keyword, prompt)).length;
  return hits / targets.length;
}

function normalizeClip(source, destination) {
  const result = spawnSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      source,
      "-af",
      "highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11,dynaudnorm=f=150:g=15",
      "-ar",
      "16000",
      "-ac",
      "1",
      destination,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${(result.stderr || result.stdout || "unknown error").trim().slice(0, 300)}`);
  }
}

let clips = manifest.clips || [];
if (only.length) clips = clips.filter((clip) => only.includes(clip.category));
if (ids.length) clips = clips.filter((clip) => ids.includes(clip.id));
if (limit) clips = clips.slice(0, limit);

if (!clips.length) {
  console.log(`No clips selected in ${manifestPath}.`);
  console.log("Add entries to the manifest, or drop recordings into eval/golden/audio/ and reference them.");
  for (const [key, category] of Object.entries(manifest.categories || {})) {
    console.log(`  ${key.padEnd(10)} target ${category.target ?? "?"}  ${category.label}`);
  }
  process.exit(0);
}

if (!status.transcribe && !mock) {
  console.error("No reading service is configured. Add GROQ_API_KEY to .env, or run with --mock.");
  process.exit(1);
}

if (wantNormalize && !ffmpegAvailable()) {
  console.error(
    "No ffmpeg found. Install it, set FFMPEG_PATH, or run without --normalize. On Windows: winget install Gyan.FFmpeg",
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const normalizeDir = join(outDir, "normalized");
if (wantNormalize) mkdirSync(normalizeDir, { recursive: true });

const run = {
  run: outDir.split(/[\\/]/).pop(),
  startedAt: new Date().toISOString(),
  manifest: manifestPath,
  variant: { glossary: wantGlossary, normalize: wantNormalize, mock },
  providers: { reading: status.transcribe, writing: status.notes },
  clips: [],
};

function save() {
  writeFileSync(join(outDir, "predictions.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

console.log(`Manifest     ${manifestPath}`);
console.log(`Clips        ${clips.length}`);
console.log(`Reading      ${status.transcribe ?? "none"}`);
console.log(`Writing      ${status.notes ?? "none"}`);
console.log(`Variant      glossary=${wantGlossary} normalize=${wantNormalize} mock=${mock}`);
console.log(`Output       ${outDir}`);
console.log("");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequestAt = 0;

async function transcribePaced(options, label) {
  if (pauseMs && lastRequestAt) {
    const wait = pauseMs - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
  }
  for (let attempt = 0; ; attempt += 1) {
    lastRequestAt = Date.now();
    try {
      return await transcribeAudio(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /\b(429|500|502|503|504)\b|rate limit|timed? ?out/i.test(message);
      if (!retryable || attempt >= retries) throw error;
      const wait = 5000 * 2 ** attempt;
      console.log(`${label.padEnd(24)} waiting  ${Math.round(wait / 1000)}s, ${message.slice(0, 90)}`);
      await sleep(wait);
      lastRequestAt = 0;
    }
  }
}

for (const clip of clips) {
  const entry = {
    id: clip.id,
    category: clip.category,
    status: "ok",
    transcript: "",
    words: 0,
    provider: null,
    seconds: 0,
    prompt: null,
    promptCoverage: null,
    glossaryTerms: null,
    normalized: false,
    notes: null,
  };

  const audioPath = clip.audio ? resolve(manifestDir, clip.audio) : "";
  if (!audioPath || !existsSync(audioPath)) {
    if (!mock) {
      entry.status = "missing-audio";
      entry.error = audioPath ? `Missing audio: ${audioPath}` : "No audio path in the manifest";
      run.clips.push(entry);
      save();
      console.log(`${clip.id.padEnd(24)} skipped  ${entry.error}`);
      continue;
    }
    console.log(`${clip.id.padEnd(24)} mock     audio file missing, using the demo reader`);
  }

  try {
    let source = audioPath;
    if (wantNormalize && audioPath) {
      source = join(normalizeDir, `${clip.id}.wav`);
      normalizeClip(audioPath, source);
      entry.normalized = true;
    }

    const buffer = source && existsSync(source) ? readFileSync(source) : Buffer.from("demo");
    const contentType = CONTENT_TYPES[extname(source || ".wav").toLowerCase()] || "audio/wav";
    const terms = clipGlossary(clip);
    if (wantGlossary) {
      process.env.JOTBOX_STT_VOCAB = terms.join(", ");
      entry.glossaryTerms = terms.length;
    }

    const context = {
      title: clip.title || "",
      kind: "meeting",
      names: clip.names || [],
      focus: "balanced",
    };
    entry.prompt = sttPrompt(context);

    const started = Date.now();
    const result = await transcribePaced(
      {
        buffer,
        contentType,
        filename: source ? source.split(/[\\/]/).pop() : "sample.wav",
        context,
      },
      clip.id,
    );
    entry.seconds = Number(((Date.now() - started) / 1000).toFixed(1));
    entry.transcript = result.text || "";
    entry.words = result.words?.length ?? (entry.transcript.trim() ? entry.transcript.trim().split(/\s+/).length : 0);
    entry.provider = result.provider;
    entry.promptCoverage = coverage(clip, entry.prompt);

    if (notesEnabled && !clip.noise && entry.transcript.trim()) {
      try {
        const notes = await enhanceSession({
          kind: "meeting",
          title: clip.title || clip.id,
          scratch: "",
          transcript: entry.transcript,
          participants: clip.names || [],
        });
        entry.notes = notes;
      } catch (error) {
        entry.notesError = error instanceof Error ? error.message : String(error);
      }
    }
  } catch (error) {
    entry.status = "error";
    entry.error = error instanceof Error ? error.message : String(error);
  }

  run.clips.push(entry);
  save();
  const suffix = entry.status === "ok" ? `${entry.words} words` : entry.status;
  console.log(`${clip.id.padEnd(24)} ${String(entry.provider ?? "").padEnd(8)} ${suffix}`);
}

save();
const failed = run.clips.filter((clip) => clip.status !== "ok").length;
console.log("");
console.log(`Wrote ${join(outDir, "predictions.json")}`);
console.log(`Now score it: python eval/score.py --predictions "${join(outDir, "predictions.json")}"`);
if (failed) {
  console.error(`${failed} clip${failed === 1 ? "" : "s"} did not run. See the status in predictions.json.`);
  process.exit(1);
}
