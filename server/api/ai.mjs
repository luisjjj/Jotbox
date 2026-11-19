import { z } from "zod";
import { requireSession } from "./auth.mjs";
import { isProUser } from "./billing.mjs";
import { HttpError, assertSameOrigin, clientIp, readJson, requireMethod, sendJson } from "./http.mjs";

/**
 * JotBox AI gateway.
 *
 * Free-first provider chain:
 *   speech: ElevenLabs Scribe v3 (diarised) -> Groq Whisper -> self-hosted -> xAI
 *   notes:  Groq GPT-OSS (free tier) -> OpenRouter free model       -> xAI
 *
 * `JOTBOX_AI_MOCK=1` adds a deterministic demo provider for local UI tests.
 * It is never selected when a real provider is configured.
 *
 * The prompts treat Nigerian Pidgin, English, Yoruba, Igbo and Hausa
 * code-switching as normal speech. The transcript is kept verbatim; the notes
 * keep the warmth and directness of the room instead of flattening it into
 * formal English.
 */

const GROQ_BASE = "https://api.groq.com/openai/v1";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const XAI_STT_URL = "https://api.x.ai/v1/stt";
const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
const ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";

const MAX_AUDIO = 80 * 1024 * 1024;
const MAX_LIVE_AUDIO = 2 * 1024 * 1024;
const GROQ_FREE_MAX = 24 * 1024 * 1024;
const MAX_TRANSCRIPT = 80_000;
const MAX_SCRATCH = 12_000;

const DEFAULT_LANGUAGE = "en";
const DEFAULT_TONE = "warm-direct";
const GROQ_NOTES_FALLBACKS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];

const KIND_LABEL = {
  meeting: "meeting",
  seminar: "seminar",
  lecture: "lecture",
  voice: "voice note",
};

// A short hint beats a long instruction list. Long prompts get echoed verbatim
// on noisy audio and push the room vocabulary out of the 896 character budget.
// The Pidgin clause and the marker list come from the 2026-11 Brekete
// mixed-register set, where an English-only prompt translated Pidgin and lost
// turns whenever two people spoke at once.
const STT_PROMPT_EN = [
  "Transcribe verbatim in Nigerian English, including Nigerian Pidgin. Do not translate Pidgin and do not correct grammar.",
  "Keep Pidgin exactly as spoken: wetin dey happen, make we check am, I no fit, dem don go, pikin, abeg, wahala, wey, na im, di, dey, don.",
  "When people talk over each other, keep every clear word and do not invent the unclear part.",
  "Keep names, places and amounts exactly as said. Leave out background media and side talk.",
].join(" ");

// This prompt family won the public Nigerian Pidgin set (39.1% WER with the
// room glossary, against 47.5% for a plain English prompt) and then the
// mixed-register set, where it averaged 7.0% WER against a consensus reference.
const STT_PROMPT_PCM = [
  "Transcribe verbatim in Nigerian English mixed with Nigerian Pidgin. Do not translate to English and do not correct grammar.",
  "Keep Pidgin exactly as spoken: wetin dey happen, make we check am, I no fit, dem don go, pikin, abeg, wahala, sotey, wey, na im, di, dey, don.",
  "When people talk over each other, keep every clear word and do not invent the unclear part.",
  "Keep names, places and amounts exactly as said. Leave out background media and side talk.",
].join(" ");

const STT_PROMPTS = {
  en: STT_PROMPT_EN,
  pcm: STT_PROMPT_PCM,
  yo: "Verbatim Yoruba transcript. Keep Yoruba as spoken and do not translate it to English. Keep names, places, amounts and dates exactly as said.",
  ha: "Verbatim Hausa transcript. Keep Hausa as spoken and do not translate it to English. Keep names, places, amounts and dates exactly as said.",
  ig: "Verbatim Igbo transcript. Keep Igbo as spoken and do not translate it to English. Keep names, places, amounts and dates exactly as said.",
};

// Pidgin runs through Whisper as English audio; the prompt carries the register.
const STT_CODES = { en: "en", pcm: "en", yo: "yo", ha: "ha", ig: "ig" };

// Igbo is missing from Whisper's hosted language list, so it only runs on a
// self-hosted reader with an Igbo model (for example Sunbird's adaptation).
const STT_WORKER_ONLY = new Set(["ig"]);

const STT_PROMPT_LIMIT = 896;
const STT_BASE_LIMIT = 560;
const STT_VOCAB_LIMIT = 720;

const DEFAULT_GROQ_STT = "whisper-large-v3";
// Live captions are a disposable preview: the kept transcript always comes from
// the full-audio pass, so turbo can halve the audio-seconds live previews burn.
const DEFAULT_GROQ_LIVE_STT = "whisper-large-v3-turbo";
const DEFAULT_ELEVENLABS_STT = "scribe_v3";
const WORKER_STT_DEFAULT = "Systran/faster-whisper-small";

// Scribe supports Igbo, Yoruba, Hausa and English, but Nigerian Pidgin is not
// on its language list. Pidgin is sent without a language code so the model
// detects the English/Pidgin mix itself instead of being forced to translate.
const ELEVENLABS_CODES = { en: "en", pcm: null, yo: "yo", ha: "ha", ig: "ig" };
const ELEVENLABS_KEYTERM_LIMIT = 100;

const NOTES_SYSTEM = `You are JotBox, a note writer for meetings, seminars, lectures and voice notes recorded in Nigeria and across West Africa.
The transcript is what was said. The scratch notes are what the listener marked. When scratch notes exist, treat them as the spine and expand them from the transcript.

Language and tone:
- Speakers may use Nigerian Pidgin, standard English, or a mix with Yoruba, Igbo and Hausa. Treat Pidgin as a full language, not as broken English.
- Pidgin is the room's voice, not a problem to fix. Never rewrite or "correct" it. Quote the Pidgin phrase that carries a decision, objection, warning or joke.
- Read idioms, proverbs, sarcasm and understatement for their real intent. A dry "no wahala" can hide a blocker; write the blocker, not just the joke.
- Write the notes in clear, simple English. State each decision plainly, then keep the Pidgin words that carry it in quotation marks.
- Use plain punctuation: commas, colons and full stops. Never use em dashes.
- Never invent names, numbers, decisions, quotes, owners or assignments.
- When words are faint or only partly heard, do not fill the gap with a guess. Write only what is clear.
- Do not add praise, preamble, warnings or filler.
- Leave out greetings, small talk, football, lunch orders, travel and side jokes, unless they change a decision or an action.
- Use the spellings of the people listed for the room. Never invent a person who is not in the transcript or that list.

Shape:
- Title: specific, under 8 words, no quotation marks.
- Summary: one short paragraph a person could send to someone who missed the session.
- Highlights: the points worth keeping. Each one is a full sentence.
- Decisions: choices the room actually settled, in the words that carry the decision. Use an empty list when no decision was made.
- Actions: only real commitments and next steps. Owner is the person named, "You" when the listener took it, or "Unassigned". Use an empty list when there is nothing to do.
- Sections follow the shape of the session.
- If the transcript is thin, write only from what is there.

Return only a JSON object with this exact shape:
{"title":"string","summary":"string","highlights":["string"],"decisions":["string"],"actions":[{"text":"string","owner":"string"}],"sections":[{"heading":"string","bullets":["string"]}]}`;

const TONE_HINT = {
  "warm-direct": "Write like a trusted colleague briefing you: clear, warm and direct. Keep the energy of the room.",
  concise: "Keep the summary and bullets tight. Prefer short sentences and no repeated point.",
  formal: "Use a calm, professional register, but keep Pidgin phrases that carry the decision or the tone.",
};

const KIND_SHAPE = {
  meeting:
    "This is a meeting. Lead with what was decided, who owns each next step, and what is still open. Sections should follow the agenda or the main threads.",
  seminar:
    "This is a seminar. Lead with the arguments, the evidence, and the questions that were left open. Sections should follow the talks or panels. Actions are follow-ups, not meeting chores.",
  lecture:
    "This is a lecture. Lead with the concepts, definitions, worked examples, and what a student should revise. Decisions are key definitions or settled interpretations. Actions are study tasks only when the lecturer set them.",
  voice:
    "This is a voice note. Keep it short. Lead with the point the speaker was making and the next move. Do not invent structure that was not there.",
};

function key(name) {
  return String(process.env[name] || "").trim();
}

function enabled(name) {
  return /^(1|true|yes|on)$/i.test(key(name));
}

function groqKey() {
  return key("GROQ_API_KEY");
}

function openrouterKey() {
  return key("OPENROUTER_API_KEY");
}

function xaiKey() {
  return key("XAI_API_KEY");
}

function elevenLabsKey() {
  return key("ELEVENLABS_API_KEY");
}

function whisperBase() {
  return key("WHISPER_BASE_URL").replace(/\/+$/, "");
}

function sttLanguage(requested) {
  const asked = typeof requested === "string" ? requested.trim().toLowerCase() : "";
  if (STT_CODES[asked]) return asked;
  const value = key("JOTBOX_STT_LANGUAGE").toLowerCase();
  if (value === "auto" || value === "none") return null;
  return value || DEFAULT_LANGUAGE;
}

function sttCode(language) {
  if (!language) return null;
  return STT_CODES[language] || language;
}

function sttHostedLanguages() {
  const languages = ["en", "pcm"];
  if (elevenLabsKey() || groqKey()) languages.push("yo", "ha");
  if (elevenLabsKey() || whisperBase()) languages.push("ig");
  return languages;
}

function sttVocabulary() {
  return key("JOTBOX_STT_VOCAB")
    .split(/[\n;]+|,(?!\d)/)
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 60)
    .join(", ")
    .slice(0, STT_VOCAB_LIMIT);
}

function elevenLabsCode(language) {
  if (!language) return null;
  // Pidgin is deliberately mapped to no code, so hasOwn is used instead of ??
  // to stop the Whisper mapping (pcm -> en) from filling the gap.
  if (Object.hasOwn(ELEVENLABS_CODES, language)) return ELEVENLABS_CODES[language];
  return STT_CODES[language] ?? language;
}

// Scribe takes discrete keyterms instead of a Whisper-style prompt. Names,
// acronyms and room vocabulary are the terms it can actually use, so they are
// sent as separate fields and the tuning prompt is left out of this provider.
function sttKeyterms(context) {
  const room = sanitizeSttContext(context);
  const configured = key("JOTBOX_STT_KEYTERMS")
    .split(/[\n;]+|,(?!\d)/)
    .map((term) => term.trim());
  const vocab = sttVocabulary().split(", ").filter(Boolean);
  const terms = [...new Set([...(room?.names ?? []), ...vocab, ...configured])]
    .map((term) => plainText(term, 50))
    .filter((term) => term.length >= 2);
  return terms.slice(0, ELEVENLABS_KEYTERM_LIMIT);
}

function sttPreference() {
  return key("JOTBOX_STT_PROVIDER")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

function orderSttProviders(providers) {
  const preference = sttPreference();
  if (!preference.length) return providers;
  return [...providers].sort((a, b) => {
    const left = preference.indexOf(a);
    const right = preference.indexOf(b);
    return (left === -1 ? preference.length : left) - (right === -1 ? preference.length : right);
  });
}

function configuredSttProviders({ live = false } = {}) {
  const providers = [];
  if (!live && elevenLabsKey()) providers.push("elevenlabs");
  if (groqKey()) providers.push("groq");
  if (whisperBase()) providers.push("worker");
  if (xaiKey()) providers.push("xai");
  // Live captions stay on Groq turbo by default. The only time Scribe previews
  // live audio is when it is the only provider configured.
  if (live && elevenLabsKey()) providers.push("elevenlabs");
  if (mockEnabled()) providers.push("demo");
  return orderSttProviders(providers);
}

function plainText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function sanitizeSttContext(input) {
  if (!input || typeof input !== "object") return null;
  const names = Array.isArray(input.names)
    ? [...new Set(input.names.map((name) => plainText(name, 80)).filter(Boolean))].slice(0, 20)
    : [];
  const title = plainText(input.title, 120);
  const kind = ["meeting", "seminar", "lecture", "voice"].includes(input.kind) ? input.kind : "";
  const focus = ["off", "balanced", "strict"].includes(input.focus) ? input.focus : "balanced";
  const asked = plainText(input.language, 8).toLowerCase();
  const language = STT_CODES[asked] ? asked : "";
  if (!title && !names.length && !language) return null;
  return { title, kind, names, focus, language };
}

export function sttPrompt(context, options = {}) {
  // Whisper treats the prompt as words it already heard, so on a short or
  // silent live chunk it reads the instructions back as captions. Live previews
  // go without a prompt; the full recording still gets the tuned one.
  if (options?.live === true) return "";

  const language = sanitizeSttContext(context)?.language || sttLanguage();
  const base = (key("JOTBOX_STT_PROMPT") || STT_PROMPTS[language] || STT_PROMPT_EN).slice(0, STT_BASE_LIMIT);
  const vocab = sttVocabulary();
  const room = sanitizeSttContext(context);
  const kind = room?.kind && KIND_LABEL[room.kind] ? KIND_LABEL[room.kind] : "session";
  const topic = room?.title ? `This ${kind} is called "${room.title}".` : "";
  const focus =
    room?.focus === "off" ? "" : "Keep every word you can hear, even in a noisy room.";
  const terms = [...new Set([...(room?.names ?? []), ...vocab.split(", ").filter(Boolean)])];
  const lead = [base, topic, focus].filter(Boolean).join(" ");

  // Groq rejects speech prompts longer than 896 characters, so the room
  // vocabulary is added term by term until the budget is full.
  const hint = "Spell these names and terms the way the room says them: ";
  let names = "";
  if (terms.length) {
    let budget = STT_PROMPT_LIMIT - lead.length - hint.length - 1;
    const picked = [];
    for (const term of terms) {
      const cost = picked.length ? term.length + 2 : term.length;
      if (cost > budget) break;
      picked.push(term);
      budget -= cost;
    }
    if (picked.length) names = `${hint}${picked.join(", ")}.`;
  }

  return [lead, names].filter(Boolean).join(" ").slice(0, STT_PROMPT_LIMIT).trim();
}

function mockEnabled() {
  if (!enabled("JOTBOX_AI_MOCK")) return false;
  if (process.env.VERCEL) {
    console.error("[jotbox-ai] JOTBOX_AI_MOCK is ignored on Vercel deployments.");
    return false;
  }
  return true;
}

function sttModelFor(provider, { live = false } = {}) {
  if (provider === "elevenlabs") return key("ELEVENLABS_STT_MODEL") || DEFAULT_ELEVENLABS_STT;
  if (provider === "worker" || provider === "self-hosted") {
    return key("WHISPER_MODEL") || WORKER_STT_DEFAULT;
  }
  if (provider === "xai") return key("XAI_STT_MODEL") || "grok-voice-transcribe-2.0";
  if (provider === "demo") return "demo";
  return live
    ? key("GROQ_LIVE_STT_MODEL") || DEFAULT_GROQ_LIVE_STT
    : key("GROQ_STT_MODEL") || DEFAULT_GROQ_STT;
}

export function aiStatus() {
  const finalProvider = configuredSttProviders()[0] ?? null;
  const liveProvider = configuredSttProviders({ live: true })[0] ?? null;
  const transcribe = finalProvider === "worker" ? "self-hosted" : finalProvider;
  const notes = mockEnabled()
    ? "demo"
    : groqKey()
      ? "groq"
      : openrouterKey()
        ? "openrouter"
        : xaiKey()
          ? "xai"
          : null;
  const vocabulary = sttVocabulary();
  return {
    ai: Boolean(transcribe || notes),
    transcribe,
    notes,
    pidgin: true,
    diarization: ["elevenlabs", "xai", "demo"].includes(finalProvider),
    tone: key("JOTBOX_AI_TONE") || DEFAULT_TONE,
    sttLanguage: sttLanguage() || "auto",
    sttLanguages: sttHostedLanguages(),
    sttVocabulary: vocabulary ? vocabulary.split(", ").length : 0,
    sttModel: sttModelFor(finalProvider),
    sttLiveModel: sttModelFor(liveProvider, { live: true }),
  };
}

function providerError(provider, response, detail, message) {
  console.error(`[jotbox-ai] ${provider} failed`, response?.status ?? "", String(detail ?? "").slice(0, 500));
  return new HttpError(
    502,
    message || "JotBox could not read that recording. Try again, or add the words by hand.",
  );
}

// Live captions cannot wait for a manual retry, so absorb one transient
// rate-limit or upstream error before giving up on a chunk.
async function fetchWithRetry(url, init, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if ((response.status === 429 || response.status >= 500) && attempt < attempts - 1) {
        lastError = new Error(`retry ${response.status}`);
        await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error("retry exhausted");
}

async function readBody(req, limit) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > limit) throw new HttpError(413, "That recording is too large for JotBox.");
    return req.body;
  }
  if (req.body instanceof Uint8Array) {
    if (req.body.byteLength > limit) throw new HttpError(413, "That recording is too large for JotBox.");
    return Buffer.from(req.body);
  }
  if (typeof req.body === "string") {
    if (Buffer.byteLength(req.body) > limit) throw new HttpError(413, "That recording is too large for JotBox.");
    return Buffer.from(req.body);
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "That recording is too large for JotBox.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function extensionFor(contentType) {
  if (contentType.includes("mp4") || contentType.includes("m4a")) return "m4a";
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("flac")) return "flac";
  return "webm";
}

function cleanWord(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

const HALLUCINATIONS = [
  /^(?:thank you(?: very much)?(?: for watching)?|thanks(?: for watching)?|please subscribe|subscribe|like and subscribe)[.!]?$/i,
  /^\[?(?:music|applause|laughter|silence|noise|background noise|inaudible|crosstalk)\]?[.!]?$/i,
  /^(?:you|uh|um|hmm|mm)[.!]?$/i,
];

function dedupeRepeats(text) {
  let out = cleanWord(text);
  for (let pass = 0; pass < 3; pass += 1) {
    const next = out
      .replace(/\b([\w'’-]+)(?:\s+\1\b){2,}/gi, "$1")
      .replace(/\b([\w'’-]+(?:\s+[\w'’-]+){1,3})\s+\1(?:\s+\1)*\b/gi, "$1");
    if (next === out) break;
    out = next;
  }
  return out;
}

function segmentIsHallucination(segment) {
  const text = cleanWord(segment?.text);
  return !text || HALLUCINATIONS.some((pattern) => pattern.test(text));
}

function speechTokens(text) {
  return cleanWord(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’-]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

// A quiet stretch can make Whisper recite the prompt as if it were speech. Room
// speech almost never repeats five prompt words in a row, so treat that as echo.
function segmentRecitesPrompt(segment, prompt) {
  if (!prompt) return false;
  const said = speechTokens(segment?.text);
  if (said.length < 5) return false;
  const haystack = ` ${speechTokens(prompt).join(" ")} `;
  for (let size = Math.min(said.length, 12); size >= 5; size -= 1) {
    for (let start = 0; start + size <= said.length; start += 1) {
      if (haystack.includes(` ${said.slice(start, start + size).join(" ")} `)) return true;
    }
  }
  return false;
}

export function tidyTranscript(text) {
  const lines = String(text ?? "")
    .split(/\n+/)
    .map((line) => dedupeRepeats(line))
    .filter((line) => line && !HALLUCINATIONS.some((pattern) => pattern.test(line)));
  const kept = [];
  for (const line of lines) {
    const previous = kept[kept.length - 1];
    if (previous && previous.toLowerCase() === line.toLowerCase()) continue;
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

function sttThreshold(name, fallback) {
  const raw = key(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function segmentIsNoise(segment) {
  const text = cleanWord(segment?.text);
  if (!text) return true;
  if (HALLUCINATIONS.some((pattern) => pattern.test(text))) return true;

  const noSpeech = Number(segment?.no_speech_prob);
  const logprob = Number(segment?.avg_logprob);
  const compression = Number(segment?.compression_ratio);
  const noSpeechLimit = sttThreshold("JOTBOX_STT_NO_SPEECH", 0.65);
  const logprobLimit = sttThreshold("JOTBOX_STT_LOGPROB", -1);
  const compressionLimit = sttThreshold("JOTBOX_STT_COMPRESSION", 2.4);

  if (Number.isFinite(compression) && compression >= compressionLimit && text.length > 12) return true;
  if (Number.isFinite(noSpeech) && noSpeech >= noSpeechLimit && (!Number.isFinite(logprob) || logprob <= -0.5)) {
    return true;
  }
  if (Number.isFinite(logprob) && logprob <= -1.6 && Number.isFinite(noSpeech) && noSpeech >= 0.3) {
    return true;
  }
  return false;
}

function speakerIndex(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  // Providers label turns as SPEAKER_00, speaker_1 or Speaker 2.
  const match = String(value).match(/(\d+)\s*$/);
  return match ? Number(match[1]) : undefined;
}

export function normalizeTranscription(data, provider, options = {}) {
  const live = options?.live === true;
  let words = Array.isArray(data?.words)
    ? data.words
        // Scribe returns spacing and audio_event entries beside real words.
        // Only words and their speaker ids belong in the transcript.
        .filter((word) => !word?.type || word.type === "word")
        .map((word) => {
          const text = cleanWord(word?.word ?? word?.text);
          const start = Number(word?.start);
          const end = Number(word?.end);
          const speaker = speakerIndex(word?.speaker ?? word?.speaker_id);
          return {
            text,
            start: Number.isFinite(start) ? start : 0,
            end: Number.isFinite(end) ? end : Number.isFinite(start) ? start : 0,
            ...(speaker !== undefined ? { speaker } : {}),
          };
        })
        .filter((word) => word.text)
    : [];

  const segments = Array.isArray(data?.segments) ? data.segments : [];
  const prompt = typeof options?.prompt === "string" ? options.prompt : "";
  const kept = segments.filter((segment) => {
    if (segmentRecitesPrompt(segment, prompt)) return false;
    return live ? !segmentIsHallucination(segment) : !segmentIsNoise(segment);
  });
  const filtered = segments.length - kept.length;

  // Providers that diarize usually put the speaker on the segment, not on each
  // word. Copy it onto the words so the transcript can group turns.
  if (!words.some((word) => word.speaker !== undefined)) {
    const labeled = segments
      .map((segment) => ({
        start: Number(segment?.start),
        end: Number(segment?.end),
        speaker: speakerIndex(segment?.speaker),
      }))
      .filter((segment) => segment.speaker !== undefined && Number.isFinite(segment.start));
    if (labeled.length) {
      words = words.map((word) => {
        let match = labeled.find(
          (segment) => word.start >= segment.start - 0.05 && word.start <= segment.end + 0.05,
        );
        if (!match) {
          let nearest = Infinity;
          for (const segment of labeled) {
            const distance = Math.min(Math.abs(word.start - segment.start), Math.abs(word.start - segment.end));
            if (distance <= 0.25 && distance < nearest) {
              nearest = distance;
              match = segment;
            }
          }
        }
        return match ? { ...word, speaker: match.speaker } : word;
      });
    }
  }

  let text = "";
  if (segments.length && filtered > 0) {
    text = kept.map((segment) => cleanWord(segment?.text)).filter(Boolean).join(" ");
    if (kept.length) {
      const ranges = kept
        .map((segment) => ({ start: Number(segment?.start), end: Number(segment?.end) }))
        .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end));
      if (ranges.length) {
        words = words.filter((word) =>
          ranges.some((range) => word.start >= range.start - 0.05 && word.start <= range.end + 0.4),
        );
      }
    } else {
      words = [];
    }
  } else if (typeof data?.text === "string") {
    text = data.text.trim();
  }

  if (!text && segments.length && filtered === 0) {
    text = segments.map((segment) => cleanWord(segment?.text)).filter(Boolean).join(" ");
  }
  if (!text) text = words.map((word) => word.text).join(" ");
  text = dedupeRepeats(text);
  if (HALLUCINATIONS.some((pattern) => pattern.test(text)) || segmentRecitesPrompt({ text }, prompt)) {
    text = "";
    words = [];
  }
  text = text.replace(/\s+([,.!?;:])/g, "$1").trim();

  return {
    text,
    words,
    language:
      typeof data?.language === "string"
        ? data.language
        : typeof data?.language_code === "string"
          ? data.language_code
          : null,
    provider,
    filtered,
  };
}

async function transcribeWithGroq(buffer, contentType, filename, context, options = {}, language = null) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), filename);
  form.append(
    "model",
    options.live
      ? key("GROQ_LIVE_STT_MODEL") || DEFAULT_GROQ_LIVE_STT
      : key("GROQ_STT_MODEL") || DEFAULT_GROQ_STT,
  );
  const code = sttCode(language);
  if (code) form.append("language", code);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  const prompt = sttPrompt(context, options);
  if (prompt) form.append("prompt", prompt);
  form.append("temperature", "0");

  const response = await fetchWithRetry(`${GROQ_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${groqKey()}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw providerError("groq-stt", response, await response.text());
  return normalizeTranscription(await response.json(), "groq", { ...options, prompt });
}

async function transcribeWithWorker(buffer, contentType, filename, context, options = {}, language = null) {
  const base = whisperBase();
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), filename);
  form.append("model", key("WHISPER_MODEL") || WORKER_STT_DEFAULT);
  const code = sttCode(language);
  if (code) form.append("language", code);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  const prompt = sttPrompt(context, options);
  if (prompt) form.append("prompt", prompt);
  form.append("temperature", "0");
  if (key("JOTBOX_STT_WORKER_TUNING") !== "off") {
    form.append("condition_on_previous_text", "false");
    form.append("vad_filter", "true");
    form.append(
      "vad_parameters",
      JSON.stringify({ threshold: 0.35, min_silence_duration_ms: 350, speech_pad_ms: 400 }),
    );
    form.append("no_speech_threshold", String(sttThreshold("JOTBOX_STT_NO_SPEECH", 0.65)));
    form.append("logprob_threshold", String(sttThreshold("JOTBOX_STT_LOGPROB", -1)));
    form.append("compression_ratio_threshold", String(sttThreshold("JOTBOX_STT_COMPRESSION", 2.4)));
  }

  const headers = key("WHISPER_API_KEY") ? { Authorization: `Bearer ${key("WHISPER_API_KEY")}` } : {};
  const response = await fetchWithRetry(`${base}/audio/transcriptions`, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw providerError("whisper-worker", response, await response.text());
  return normalizeTranscription(await response.json(), "self-hosted", { ...options, prompt });
}

async function transcribeWithXai(buffer, contentType, filename, context, options = {}, language = null) {
  const form = new FormData();
  form.append("model", key("XAI_STT_MODEL") || "grok-voice-transcribe-2.0");
  const code = sttCode(language);
  if (code) form.append("language", code);
  form.append("format", "true");
  form.append("diarize", "true");
  const prompt = sttPrompt(context, options);
  if (prompt) form.append("prompt", prompt);
  form.append("file", new Blob([buffer], { type: contentType }), filename);

  const response = await fetchWithRetry(XAI_STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${xaiKey()}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw providerError("xai-stt", response, await response.text());
  return normalizeTranscription(await response.json(), "xai", { ...options, prompt });
}

async function transcribeWithElevenLabs(buffer, contentType, filename, context, options = {}, language = null) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), filename);
  form.append("model_id", key("ELEVENLABS_STT_MODEL") || DEFAULT_ELEVENLABS_STT);
  form.append("timestamps_granularity", "word");
  if (options.live !== true) {
    // Diarising a two second live chunk produces speaker ids that do not line
    // up with the next chunk, so only the full recording asks for speakers.
    form.append("diarize", "true");
    form.append("tag_audio_events", "false");
  }
  const code = elevenLabsCode(language);
  if (code) form.append("language_code", code);
  for (const term of sttKeyterms(context)) form.append("keyterms", term);

  const send = () =>
    fetchWithRetry(ELEVENLABS_STT_URL, {
      method: "POST",
      headers: { "xi-api-key": elevenLabsKey() },
      body: form,
      signal: AbortSignal.timeout(240_000),
    });

  let response = await send();
  let detail = "";
  if (response.status === 400 || response.status === 422) {
    detail = await response.text();
    console.error("[jotbox-ai] elevenlabs rejected options", response.status, detail.slice(0, 500));
    // A language code or keyterm list the account does not support should not
    // lose the recording. Retry once with auto-detect and no keyterms.
    form.delete("language_code");
    form.delete("keyterms");
    response = await send();
  }
  if (!response.ok) throw providerError("elevenlabs-stt", response, detail || (await response.text()));
  return normalizeTranscription(await response.json(), "elevenlabs", { ...options, prompt: "" });
}

const MOCK_LINES = [
  "Ah, wetin happen to the Friday payout?",
  "E be like the bank dey slow us down, the file reach them late.",
  "No wahala, make we pause the same-day promise until the cutoff hold.",
  "I go send the merchant note before four, plain language, no big words.",
  "I go re-pull the two failed batches and confirm say nothing duplicate.",
];

function mockTranscription() {
  const words = [];
  let at = 1;
  MOCK_LINES.forEach((line, index) => {
    const speaker = index % 2;
    for (const text of line.split(/\s+/)) {
      words.push({ text, start: Number(at.toFixed(2)), end: Number((at + 0.32).toFixed(2)), speaker });
      at += 0.34;
    }
    at += 1.4;
  });
  return {
    text: MOCK_LINES.join(" "),
    words,
    language: "en-NG",
    provider: "demo",
  };
}

export async function transcribeAudio({ buffer, contentType, filename, context, live = false }) {
  const options = { live };
  const language = sttLanguage(context?.language);
  // Scribe covers Igbo, so the worker-only rule applies only when Scribe is absent.
  const workerOnly = STT_WORKER_ONLY.has(language) && !elevenLabsKey();
  const attempts = [];
  const providers = configuredSttProviders({ live }).filter((provider) => {
    if (provider === "groq") return buffer.length <= GROQ_FREE_MAX && !workerOnly;
    if (workerOnly) return provider === "worker" || provider === "demo";
    return true;
  });

  if (!providers.some((provider) => provider !== "demo")) {
    if (workerOnly) {
      throw new HttpError(
        400,
        "Igbo needs the Igbo reader on this server. Switch this capture to English, Pidgin, Yoruba or Hausa for now.",
      );
    }
  }

  for (const provider of providers) {
    try {
      if (provider === "elevenlabs") return await transcribeWithElevenLabs(buffer, contentType, filename, context, options, language);
      if (provider === "groq") return await transcribeWithGroq(buffer, contentType, filename, context, options, language);
      if (provider === "worker") return await transcribeWithWorker(buffer, contentType, filename, context, options, language);
      if (provider === "xai") return await transcribeWithXai(buffer, contentType, filename, context, options, language);
      if (provider === "demo") return mockTranscription();
    } catch (error) {
      attempts.push({ provider, message: error instanceof Error ? error.message : "failed" });
    }
  }

  if (attempts.length) throw new HttpError(502, attempts[attempts.length - 1].message);
  throw new HttpError(
    503,
    "JotBox cannot read recordings on this server yet. Add the words by hand, or turn on a reading service.",
  );
}

function notesMessages({ kind, title, scratch, transcript, tone, participants = [] }) {
  const toneName = TONE_HINT[tone] ? tone : DEFAULT_TONE;
  const people = participants
    .map((person) => (typeof person === "string" ? person : person?.name))
    .map((name) => plainText(name, 80))
    .filter(Boolean)
    .slice(0, 20);
  return [
    { role: "system", content: NOTES_SYSTEM },
    {
      role: "user",
      content: [
        `Session kind: ${KIND_LABEL[kind] || "meeting"}`,
        `Shape: ${KIND_SHAPE[kind] || KIND_SHAPE.meeting}`,
        `Tone: ${toneName}. ${TONE_HINT[toneName]}`,
        `Working title: ${title || "(none)"}`,
        `People in the room: ${people.length ? people.join(", ") : "(not listed)"}`,
        "",
        "Scratch notes from the listener:",
        scratch.trim() || "(none)",
        "",
        "Transcript:",
        transcript.trim() || "(none)",
      ].join("\n"),
    },
  ];
}

function parseNotes(content) {
  if (typeof content !== "string" || !content.trim()) throw new Error("empty notes");
  let text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  const value = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("invalid notes");
  if (typeof value.title !== "string" || typeof value.summary !== "string") throw new Error("invalid notes");
  if (!Array.isArray(value.highlights) || !Array.isArray(value.actions) || !Array.isArray(value.sections)) {
    throw new Error("invalid notes");
  }

  return {
    title: value.title.trim(),
    summary: value.summary.trim(),
    highlights: value.highlights.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()),
    decisions: Array.isArray(value.decisions)
      ? value.decisions.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
      : [],
    actions: value.actions.flatMap((item) => {
      if (!item || typeof item !== "object" || typeof item.text !== "string" || !item.text.trim()) return [];
      return [{ text: item.text.trim(), owner: typeof item.owner === "string" && item.owner.trim() ? item.owner.trim() : "Unassigned" }];
    }),
    sections: value.sections.flatMap((item) => {
      if (!item || typeof item !== "object" || typeof item.heading !== "string") return [];
      const bullets = Array.isArray(item.bullets)
        ? item.bullets.filter((bullet) => typeof bullet === "string" && bullet.trim()).map((bullet) => bullet.trim())
        : [];
      if (!item.heading.trim()) return [];
      return [{ heading: item.heading.trim(), bullets }];
    }),
  };
}

async function chatCompletion({ url, headers, model, messages, extra = {} }) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      model,
      temperature: Number(key("JOTBOX_NOTES_TEMPERATURE") || 0.25),
      max_tokens: Number(key("JOTBOX_NOTES_MAX_TOKENS") || 2_500),
      messages,
      response_format: { type: "json_object" },
      ...extra,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    throw providerError(
      model,
      response,
      await response.text(),
      "JotBox could not finish the notes. Try again, or add the words by hand.",
    );
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return parseNotes(content);
}

async function notesWithGroq(payload) {
  const configured = key("GROQ_NOTES_MODEL");
  const models = [...new Set([configured, ...GROQ_NOTES_FALLBACKS].filter(Boolean))];
  let lastError;
  for (const model of models) {
    try {
      return await chatCompletion({
        url: `${GROQ_BASE}/chat/completions`,
        headers: { Authorization: `Bearer ${groqKey()}` },
        model,
        messages: notesMessages(payload),
      });
    } catch (error) {
      lastError = error;
      console.error(
        `[jotbox-ai] groq notes model ${model} failed`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  throw lastError ?? new HttpError(502, "JotBox could not finish the notes.");
}

async function notesWithOpenrouter(payload) {
  return chatCompletion({
    url: OPENROUTER_URL,
    headers: {
      Authorization: `Bearer ${openrouterKey()}`,
      "HTTP-Referer": key("JOTBOX_PUBLIC_URL") || "https://jotbox.online",
      "X-Title": "JotBox",
    },
    model: key("OPENROUTER_NOTES_MODEL") || "meta-llama/llama-3.3-70b-instruct:free",
    messages: notesMessages(payload),
  });
}

async function notesWithXai(payload) {
  return chatCompletion({
    url: XAI_CHAT_URL,
    headers: { Authorization: `Bearer ${xaiKey()}` },
    model: key("XAI_NOTES_MODEL") || "grok-4.7",
    messages: notesMessages(payload),
  });
}

function mockNotes({ kind, title, scratch, transcript }) {
  const pidgin = /wetin|wahala|abeg|dey|na |sha|e go|make we/i.test(`${transcript} ${scratch}`);
  const summary = pidgin
    ? "The room agreed that Friday's payout is still partly unsettled because the bank acknowledged the file late. They will pause the same-day promise until the cutoff is reliable, and tell merchants plainly what is happening today."
    : "The room agreed to pause the same-day payout promise until the bank cutoff is reliable, and to tell merchants plainly what is happening today.";

  return {
    title: title && !title.startsWith("Meeting ·") ? title : "Friday payout and same-day promise",
    summary,
    highlights: [
      "Part of Friday's card volume is still unsettled and shows as pending.",
      "The file left on time, but the bank acknowledged it late.",
      'The team agreed: "make we pause the same-day promise" until the cutoff holds.',
      "Support is carrying chats that are really one settlement problem.",
    ],
    decisions: [
      'Pause the same-day promise until the cutoff holds ("make we pause the same-day promise").',
      "Tell merchants plainly what is happening today.",
    ],
    actions: [
      { text: "Send the merchant note before 4pm in plain language", owner: "Ada" },
      { text: "Re-pull the two failed batches and confirm there are no duplicates", owner: "Chinedu" },
      { text: "Pause same-day payout promises until the cutoff holds", owner: "Team" },
    ],
    sections: [
      {
        heading: "What is happening",
        bullets: [
          "Merchants see pending and read it as a failure.",
          "The bank window is landing nearer 4pm than the promised 2pm.",
        ],
      },
      {
        heading: "What was decided",
        bullets: [
          "Same-day language comes out until the window is trustworthy.",
          "Support gets a reply they can paste without explaining the batch system.",
        ],
      },
    ],
  };
}

const CLEAN_SYSTEM = `You tidy a raw speech transcript before it becomes meeting notes.
Rules:
- Keep Nigerian Pidgin exactly as spoken. Never translate, paraphrase, summarize, or correct dialect.
- Only fix punctuation, capitalisation, spacing, and repeated words or phrases caused by speech recognition.
- Keep every speaker label that is present, such as "Ada:".
- Remove lines that are only noise markers, such as "[music]" or "thank you for watching".
- Never add new words, names, numbers, or facts.
Return only a JSON object with this exact shape: {"transcript":"string"}`;

async function cleanTranscriptWithGroq(text, participants = []) {
  const models = [...new Set([key("GROQ_NOTES_MODEL"), ...GROQ_NOTES_FALLBACKS].filter(Boolean))];
  const people = participants
    .map((person) => (typeof person === "string" ? person : person?.name))
    .map((name) => plainText(name, 80))
    .filter(Boolean)
    .slice(0, 20);
  let lastError;

  for (const model of models) {
    try {
      const response = await fetch(`${GROQ_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey()}` },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: Number(key("JOTBOX_CLEAN_MAX_TOKENS") || 3_000),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: CLEAN_SYSTEM },
            {
              role: "user",
              content: [
                `People in the room: ${people.length ? people.join(", ") : "(not listed)"}`,
                "",
                "Raw transcript:",
                text,
              ].join("\n"),
            },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`cleanup ${response.status}`);
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      const parsed = JSON.parse(
        String(content || "")
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/```$/i, ""),
      );
      const cleaned = typeof parsed?.transcript === "string" ? parsed.transcript.trim() : "";
      if (!cleaned) throw new Error("empty cleanup");
      const ratio = cleaned.length / Math.max(1, text.length);
      if (ratio < 0.55 || ratio > 1.2) throw new Error(`cleanup length ${ratio.toFixed(2)}`);
      return cleaned;
    } catch (error) {
      lastError = error;
      console.error(
        `[jotbox-ai] transcript cleanup model ${model} failed`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  throw lastError ?? new Error("cleanup failed");
}

async function cleanTranscriptForNotes({ transcript, participants = [] }) {
  const raw = tidyTranscript(transcript);
  if (raw.length < 300 || !groqKey()) return raw;
  try {
    return tidyTranscript(await cleanTranscriptWithGroq(raw, participants)) || raw;
  } catch {
    return raw;
  }
}

export async function enhanceSession({ kind, title, scratch, transcript, tone, participants = [] }) {
  const payload = {
    kind: KIND_LABEL[kind] ? kind : "meeting",
    title: String(title || "").slice(0, 160),
    scratch: String(scratch || "").slice(0, MAX_SCRATCH),
    transcript: await cleanTranscriptForNotes({
      transcript: String(transcript || "").slice(0, MAX_TRANSCRIPT),
      participants: Array.isArray(participants) ? participants.slice(0, 20) : [],
    }),
    tone: TONE_HINT[tone] ? tone : key("JOTBOX_AI_TONE") || DEFAULT_TONE,
    participants: Array.isArray(participants) ? participants.slice(0, 20) : [],
  };

  const providers = [];
  if (groqKey()) providers.push("groq");
  if (openrouterKey()) providers.push("openrouter");
  if (xaiKey()) providers.push("xai");
  if (mockEnabled()) providers.push("demo");

  for (const provider of providers) {
    try {
      const notes =
        provider === "groq"
          ? await notesWithGroq(payload)
          : provider === "openrouter"
            ? await notesWithOpenrouter(payload)
            : provider === "xai"
              ? await notesWithXai(payload)
              : mockNotes(payload);
      return { ...notes, provider };
    } catch (error) {
      console.error(`[jotbox-ai] ${provider} notes failed`, error instanceof Error ? error.message : error);
    }
  }

  if (!providers.length) {
    throw new HttpError(
      503,
      "JotBox cannot write notes on this server yet. Add the words by hand, or try again later.",
    );
  }
  throw new HttpError(
    502,
    "JotBox could not finish the notes just now. Try again, or add the words by hand.",
  );
}

const ASK_SYSTEM = `You are JotBox, answering a question about one recorded session.
Use only the session notes, jottings and spoken words supplied. Never use outside knowledge. Never invent names, numbers, dates, decisions, quotes or owners.
If the answer is not in the session, say plainly that it was not captured and suggest checking the spoken words. Do not guess.
When the answer comes from the spoken words, quote the line and include its timestamp like [12:04]. Keep Nigerian Pidgin exactly as it was said; answer the question in clear English.
Keep the answer short: one short paragraph, or up to four short bullets. Use plain punctuation, commas, colons and full stops. Never use em dashes.
Return only a JSON object with this exact shape: {"answer":"string"}`;

const INSIGHTS_SYSTEM = `You watch a live session for clear decisions and commitments.
Return only decisions and actions that were explicitly said. Do not infer. Do not repeat items already on the board.
Keep Nigerian Pidgin quotes exactly as said. Use plain punctuation and never use em dashes.
An action owner is the named person, "You" when the listener took it, "Team" for a collective commitment, or "Unassigned".
Return at most four decisions and four actions. If nothing new is clear, return empty lists.
Return only a JSON object with this exact shape: {"decisions":["string"],"actions":[{"text":"string","owner":"string"}]}`;

const FOLLOWUP_SYSTEM = `You write a follow-up message from a recorded session.
Use only the notes, actions and words supplied. Never invent decisions, names, numbers or owners.
Channel rules:
- whatsapp: short and scannable, with a title line and a short next steps list.
- email: a subject line, a greeting, two short paragraphs, then next steps and a sign-off.
- recap: a plain recap with no greeting or subject.
Language rules:
- english: clear, direct English.
- pidgin: natural Nigerian Pidgin. Keep names, amounts and quoted speech exact. Do not translate quoted Pidgin.
Include only open actions. If there are none, say so plainly.
Use plain punctuation, commas, colons and full stops. Never use em dashes. No praise, preamble or filler.
Return only a JSON object with this exact shape: {"text":"string"}`;

const BRIEF_SYSTEM = `You prepare a short brief before the next occurrence of a recurring session.
Use only the previous session supplied. Never invent names, numbers, decisions, owners or dates.
Write up to three bullets, exactly three when the notes support three. Each bullet is one short sentence that tells the listener what to follow up on today.
Prioritise open actions first, then promises or decisions that were not settled. Mention the owner when one was named. Do not repeat actions already marked done.
Keep Nigerian Pidgin quotes exactly as said. Use plain punctuation, commas, colons and full stops. Never use em dashes. No preamble, no praise, no headings.
Return only a JSON object with this exact shape: {"bullets":["string","string","string"]}`;

const KIND_LABELS = {
  meeting: "meeting",
  seminar: "seminar",
  lecture: "lecture",
  voice: "voice note",
};

function clipText(value, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit) : text;
}

function jsonObject(content) {
  if (typeof content !== "string" || !content.trim()) throw new Error("empty answer");
  let text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return JSON.parse(text);
}

function noteLines(notes) {
  if (!notes || typeof notes !== "object") return "(none)";
  const parts = [];
  if (typeof notes.summary === "string" && notes.summary.trim()) parts.push(notes.summary.trim());
  for (const item of Array.isArray(notes.highlights) ? notes.highlights : []) {
    if (typeof item === "string" && item.trim()) parts.push(`- ${item.trim()}`);
  }
  for (const item of Array.isArray(notes.decisions) ? notes.decisions : []) {
    if (typeof item === "string" && item.trim()) parts.push(`Decision: ${item.trim()}`);
  }
  for (const action of Array.isArray(notes.actions) ? notes.actions : []) {
    if (!action || typeof action.text !== "string") continue;
    parts.push(`Action: ${action.text}${action.owner ? ` (${action.owner})` : ""}`);
  }
  for (const section of Array.isArray(notes.sections) ? notes.sections : []) {
    if (!section || typeof section.heading !== "string") continue;
    parts.push(`## ${section.heading}`);
    for (const bullet of Array.isArray(section.bullets) ? section.bullets : []) {
      if (typeof bullet === "string") parts.push(`- ${bullet}`);
    }
  }
  return parts.join("\n") || "(none)";
}

function transcriptLinesForPrompt(transcript, limit = 42_000) {
  const lines = [];
  let total = 0;
  for (const line of Array.isArray(transcript) ? transcript : []) {
    if (!line || typeof line.text !== "string" || !line.text.trim()) continue;
    const seconds = Number(line.at);
    const stamp = Number.isFinite(seconds) && seconds > 0 ? `[${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}] ` : "";
    const speaker = typeof line.speaker === "string" && line.speaker.trim() ? `${line.speaker.trim()}: ` : "";
    const text = `${stamp}${speaker}${line.text.trim()}`;
    if (total + text.length > limit) break;
    lines.push(text);
    total += text.length + 1;
  }
  return lines.join("\n") || "(none)";
}

function assistantMessagesForAsk({ question, history, session }) {
  const turns = Array.isArray(history)
    ? history
        .filter((turn) => turn && (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string")
        .slice(-6)
        .map((turn) => ({ role: turn.role, content: clipText(turn.content, 4_000) }))
    : [];
  return [
    { role: "system", content: ASK_SYSTEM },
    ...turns,
    {
      role: "user",
      content: [
        `Question: ${clipText(question, 500)}`,
        "",
        `Session: ${clipText(session.title, 160) || "(untitled)"} (${KIND_LABELS[session.kind] || "meeting"})`,
        "Written notes:",
        noteLines(session.notes),
        "",
        "Jottings from the listener:",
        clipText(session.scratch, 8_000) || "(none)",
        "",
        "Spoken words:",
        transcriptLinesForPrompt(session.transcript),
      ].join("\n"),
    },
  ];
}

function assistantMessagesForInsights({ session, existing }) {
  const existingDecisions = Array.isArray(existing?.decisions) ? existing.decisions.filter((item) => typeof item === "string") : [];
  const existingActions = Array.isArray(existing?.actions) ? existing.actions.filter((item) => item && typeof item.text === "string") : [];
  return [
    { role: "system", content: INSIGHTS_SYSTEM },
    {
      role: "user",
      content: [
        `Session: ${clipText(session.title, 160) || "(untitled)"} (${KIND_LABELS[session.kind] || "meeting"})`,
        `Existing decisions: ${existingDecisions.length ? existingDecisions.join(" | ") : "(none)"}`,
        `Existing actions: ${existingActions.length ? existingActions.map((item) => item.text).join(" | ") : "(none)"}`,
        "",
        "Jottings:",
        clipText(session.scratch, 6_000) || "(none)",
        "",
        "Recent spoken words:",
        transcriptLinesForPrompt(session.transcript, 16_000),
      ].join("\n"),
    },
  ];
}

function assistantMessagesForFollowup({ session, channel, language }) {
  return [
    { role: "system", content: FOLLOWUP_SYSTEM },
    {
      role: "user",
      content: [
        `Channel: ${channel}`,
        `Language: ${language}`,
        `Session: ${clipText(session.title, 160) || "(untitled)"} (${KIND_LABELS[session.kind] || "meeting"})`,
        "",
        "Written notes:",
        noteLines(session.notes),
        "",
        "Jottings:",
        clipText(session.scratch, 6_000) || "(none)",
        "",
        "Spoken words:",
        transcriptLinesForPrompt(session.transcript, 14_000),
      ].join("\n"),
    },
  ];
}

function briefDate(at) {
  const value = Number(at);
  if (!Number.isFinite(value) || value <= 0) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return ` on ${date.toISOString().slice(0, 10)}`;
}

function assistantMessagesForBrief({ title, kind, previous }) {
  const actions = previous.actions
    .filter((action) => action && typeof action.text === "string" && action.text.trim())
    .map(
      (action) =>
        `${action.done ? "[done]" : "[open]"} ${action.owner ? `${action.owner}: ` : ""}${action.text.trim()}`,
    );
  const decisions = previous.decisions.filter((item) => typeof item === "string" && item.trim());
  return [
    { role: "system", content: BRIEF_SYSTEM },
    {
      role: "user",
      content: [
        `Today's session: ${clipText(title, 160) || "(untitled)"} (${KIND_LABELS[kind] || "meeting"})`,
        `Previous session: ${clipText(previous.title, 160) || "(untitled)"}${briefDate(previous.at)}`,
        "",
        "Previous summary:",
        clipText(previous.summary, 2_000) || "(none)",
        "",
        "Previous decisions:",
        decisions.length ? decisions.map((item) => `- ${clipText(item, 500)}`).join("\n") : "(none)",
        "",
        "Previous actions:",
        actions.length ? actions.join("\n") : "(none)",
        "",
        "Write the bullets for today.",
      ].join("\n"),
    },
  ];
}

function demoBrief({ previous }) {
  const bullets = [];
  const push = (text) => {
    const value = clipText(text, 240);
    if (!value) return;
    if (bullets.some((item) => item.toLowerCase() === value.toLowerCase())) return;
    bullets.push(value);
  };
  for (const action of previous.actions) {
    if (bullets.length >= 3) break;
    if (!action || typeof action.text !== "string" || action.done) continue;
    const owner = action.owner && action.owner !== "Unassigned" ? `${action.owner}: ` : "";
    push(`${owner}${action.text}`);
  }
  for (const decision of previous.decisions) {
    if (bullets.length >= 3) break;
    push(decision);
  }
  if (!bullets.length) push(previous.summary);
  return bullets.slice(0, 3);
}

export async function buildPreMeetingBrief({ title, kind, previous }) {
  if (mockEnabled()) return { bullets: demoBrief({ previous }), provider: "demo" };
  const { value, provider } = await chatJson({
    messages: assistantMessagesForBrief({ title, kind, previous }),
    maxTokens: 420,
    temperature: 0.25,
  });
  const bullets = Array.isArray(value?.bullets)
    ? value.bullets
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => clipText(item, 240))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  if (!bullets.length) throw new HttpError(502, "The brief came back empty. Try again.");
  return { bullets, provider };
}

function assistantProviders() {
  const providers = [];
  if (groqKey()) providers.push("groq");
  if (openrouterKey()) providers.push("openrouter");
  if (xaiKey()) providers.push("xai");
  return providers;
}

async function chatJson({ messages, maxTokens = 900, temperature = 0.2 }) {
  const providers = assistantProviders();
  if (!providers.length) {
    throw new HttpError(503, "JotBox cannot answer on this server yet. Use the answer from this device.");
  }
  let lastError;
  for (const provider of providers) {
    try {
      if (provider === "groq") {
        const configured = key("GROQ_NOTES_MODEL");
        const models = [...new Set([configured, ...GROQ_NOTES_FALLBACKS].filter(Boolean))];
        for (const model of models) {
          try {
            const response = await fetch(`${GROQ_BASE}/chat/completions`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey()}` },
              body: JSON.stringify({
                model,
                temperature,
                max_tokens: maxTokens,
                messages,
                response_format: { type: "json_object" },
              }),
              signal: AbortSignal.timeout(60_000),
            });
            if (!response.ok) throw new Error(`groq ${response.status}`);
            const data = await response.json();
            return { value: jsonObject(data?.choices?.[0]?.message?.content), provider, model };
          } catch (error) {
            lastError = error;
          }
        }
        continue;
      }
      const url = provider === "openrouter" ? OPENROUTER_URL : XAI_CHAT_URL;
      const model =
        provider === "openrouter"
          ? key("OPENROUTER_NOTES_MODEL") || "meta-llama/llama-3.3-70b-instruct:free"
          : key("XAI_NOTES_MODEL") || "grok-4.7";
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${provider === "openrouter" ? openrouterKey() : xaiKey()}` };
      if (provider === "openrouter") {
        headers["HTTP-Referer"] = key("JOTBOX_PUBLIC_URL") || "https://jotbox.online";
        headers["X-Title"] = "JotBox";
      }
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: maxTokens,
          messages,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`${provider} ${response.status}`);
      const data = await response.json();
      return { value: jsonObject(data?.choices?.[0]?.message?.content), provider, model };
    } catch (error) {
      lastError = error;
      console.error(`[jotbox-ai] ${provider} assist failed`, error instanceof Error ? error.message : error);
    }
  }
  throw new HttpError(502, lastError?.message || "JotBox could not answer just now.");
}

function demoAsk({ question, session }) {
  const stop = new Set(
    "the and for was were what when where why who how our your their did does with from that this have has had are but not you about into then than them they there been being all any can could should would will just please tell me a an is it to of in on at by as do i we he she".split(
      " ",
    ),
  );
  const terms = [...new Set((String(question).toLowerCase().match(/[a-z0-9]{3,}/g) ?? []))].filter(
    (term) => !stop.has(term),
  );
  const lines = Array.isArray(session.transcript) ? session.transcript : [];
  const notes = session.notes && typeof session.notes === "object" ? session.notes : {};
  const decisions = Array.isArray(notes.decisions) ? notes.decisions : [];
  const actions = Array.isArray(notes.actions) ? notes.actions : [];
  const highlights = Array.isArray(notes.highlights) ? notes.highlights : [];

  const ranked = lines
    .map((line) => {
      const text = `${line.speaker ?? ""} ${line.text ?? ""}`.toLowerCase();
      return { line, score: terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (ranked.length) {
    return ranked
      .map(
        ({ line }) =>
          `[${Math.floor(Number(line.at) / 60)}:${String(Math.floor(Number(line.at) % 60)).padStart(2, "0")}] ${
            line.speaker ? `${line.speaker}: ` : ""
          }${line.text}`,
      )
      .join(" ");
  }

  const facts = [
    ...decisions.map((item) => `Decision: ${item}`),
    ...actions
      .filter((action) => action && typeof action.text === "string")
      .map((action) => `Action: ${action.owner ? `${action.owner}: ` : ""}${action.text}`),
    ...highlights.map((item) => `Point: ${item}`),
    ...(typeof notes.summary === "string" && notes.summary.trim() ? [`Summary: ${notes.summary}`] : []),
  ];
  const matched = facts.filter((fact) => terms.some((term) => fact.toLowerCase().includes(term)));
  if (matched.length) return matched.slice(0, 3).join("\n");

  if (/\b(decision|decide|agreed|conclusion|action|next|owner|follow)/i.test(String(question))) {
    const direct = [
      ...decisions.map((item) => `Decision: ${item}`),
      ...actions
        .filter((action) => action && typeof action.text === "string")
        .map((action) => `Action: ${action.owner ? `${action.owner}: ` : ""}${action.text}`),
    ];
    if (direct.length) return direct.slice(0, 4).join("\n");
  }

  return "That was not clear in this session. Check the spoken words, or ask about a person, number, or decision.";
}

function demoInsights({ session, existing }) {
  const lines = Array.isArray(session.transcript) ? session.transcript : [];
  const decisions = [];
  const actions = [];
  for (const line of lines) {
    const text = clipText(line.text, 220);
    if (!text) continue;
    if (/\b(we agreed|we decided|make we|we go|no wahala)\b/i.test(text) && decisions.length < 3) decisions.push(text);
    if (/\b(i go|send|re-pull|confirm|follow up|before)\b/i.test(text) && actions.length < 3) {
      actions.push({ text, owner: /\bi go|i will|i'll\b/i.test(text) ? "You" : "Unassigned" });
    }
  }
  const known = new Set((existing?.decisions ?? []).map((item) => String(item).toLowerCase()));
  const knownActions = new Set((existing?.actions ?? []).map((item) => String(item?.text ?? "").toLowerCase()));
  return {
    decisions: decisions.filter((item) => !known.has(item.toLowerCase())),
    actions: actions.filter((item) => !knownActions.has(item.text.toLowerCase())),
  };
}

function demoFollowup({ session, channel, language }) {
  const summary = clipText(noteLines(session.notes).split("\n")[0], 600) || "No written summary yet.";
  const actions = (Array.isArray(session.notes?.actions) ? session.notes.actions : [])
    .filter((action) => action && typeof action.text === "string")
    .map((action) => `- ${action.owner ? `${action.owner}: ` : ""}${action.text}`);
  const next = actions.length ? actions.join("\n") : "- No open actions were written down.";
  if (language === "pidgin") {
    return `How far. Here is wetin we talk about for "${session.title}".\n\n${summary}\n\nWetin dey next:\n${next}\n\nNo wahala.`;
  }
  if (channel === "email") {
    return `Subject: Recap: ${session.title}\n\nHello,\n\n${summary}\n\nNext steps:\n${next}\n\nThanks.`;
  }
  return `${session.title}\n\n${summary}\n\nNext steps:\n${next}`;
}

export async function answerAboutSession({ question, history, session }) {
  if (mockEnabled()) return { answer: demoAsk({ question, session }), provider: "demo" };
  const { value, provider } = await chatJson({
    messages: assistantMessagesForAsk({ question, history, session }),
    maxTokens: 700,
    temperature: 0.15,
  });
  const answer = typeof value?.answer === "string" ? value.answer.trim() : "";
  if (!answer) throw new HttpError(502, "The answer came back empty. Try again.");
  return { answer, provider };
}

export async function extractLiveInsights({ session, existing }) {
  if (mockEnabled()) return { ...demoInsights({ session, existing }), provider: "demo" };
  const { value, provider } = await chatJson({
    messages: assistantMessagesForInsights({ session, existing }),
    maxTokens: 650,
    temperature: 0.1,
  });
  const decisions = Array.isArray(value?.decisions)
    ? value.decisions.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()).slice(0, 4)
    : [];
  const actions = Array.isArray(value?.actions)
    ? value.actions
        .flatMap((item) => {
          if (!item || typeof item.text !== "string" || !item.text.trim()) return [];
          return [{ text: item.text.trim(), owner: typeof item.owner === "string" && item.owner.trim() ? item.owner.trim() : "Unassigned" }];
        })
        .slice(0, 4)
    : [];
  return { decisions, actions, provider };
}

export async function draftFollowUpMessage({ session, channel, language }) {
  if (mockEnabled()) return { text: demoFollowup({ session, channel, language }), provider: "demo" };
  const { value, provider } = await chatJson({
    messages: assistantMessagesForFollowup({ session, channel, language }),
    maxTokens: 900,
    temperature: 0.35,
  });
  const text = typeof value?.text === "string" ? value.text.trim() : "";
  if (!text) throw new HttpError(502, "The draft came back empty. Try again.");
  return { text, provider };
}

const NAMES_SYSTEM = `You match speaker labels in a transcript to the people listed for the session.
Rules:
- Use only names from the people list. Never invent a name.
- Assign a name only with direct evidence in the words: the speaker introduces themselves ("I am Ada", "my name is Ada"), someone addresses them by name and they answer next, the line says the speaker's name, or the chair hands over to them.
- A name inside a speaker's own line usually points to the person being addressed. If Speaker 1 says "Ada, send the file" and Speaker 2 answers, Speaker 2 is more likely Ada than Speaker 1.
- Never guess from topic, job, gender, accent, turn order alone, or who spoke most.
- One speaker for one name, and one name for one speaker. If two labels look like the same person, pick the clearer one and leave the other out.
- Leave a speaker out when the evidence is weak. An empty list is better than a wrong name.
- quote: the exact words that support the match, copied from the transcript without the speaker label, 140 characters at most.
Return only a JSON object with this exact shape:
{"matches":[{"speaker":"Speaker 1","name":"Ada","confidence":"high","quote":"..."}]}
Use "high" when the person says their own name or is addressed and answers, otherwise "low".`;

function nameLines(transcript) {
  return (Array.isArray(transcript) ? transcript : []).flatMap((line) => {
    if (!line || typeof line.text !== "string") return [];
    const text = plainText(line.text, 700);
    if (!text) return [];
    return [{ speaker: plainText(line.speaker, 80), text }];
  });
}

function nameTranscript(lines, maxChars = 23_000) {
  const joined = lines.map((line) => (line.speaker ? `${line.speaker}: ${line.text}` : line.text)).join("\n");
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars - 9_000)}\n[...middle omitted...]\n${joined.slice(-9_000)}`;
}

function namesMessages({ title, kind, people, labels, transcript }) {
  return [
    { role: "system", content: NAMES_SYSTEM },
    {
      role: "user",
      content: [
        `Session kind: ${KIND_LABEL[kind] || "meeting"}`,
        `Title: ${title || "(none)"}`,
        `People listed for the session: ${people.join(", ")}`,
        `Speaker labels: ${labels.map((item) => `${item.speaker} (${item.count} lines)`).join(", ")}`,
        "",
        "Transcript:",
        transcript,
      ].join("\n"),
    },
  ];
}

function demoSpeakerNames({ people, labels, lines }) {
  const matches = [];
  const used = new Set();
  const matched = new Set();
  const known = new Map(people.map((name) => [name.toLowerCase(), name]));
  const labelset = new Set(labels.map((item) => item.speaker));

  const add = (speaker, name, quote, confidence) => {
    if (!labelset.has(speaker) || matched.has(speaker) || used.has(name)) return;
    matched.add(speaker);
    used.add(name);
    matches.push({ speaker, name, confidence, quote: plainText(quote, 140) });
  };

  lines.forEach((line, index) => {
    if (!labelset.has(line.speaker)) return;
    const intro = line.text.match(/\b(?:i am|i'm|my name is|na me)\s+([A-Za-z][\w'-]{1,30})/i);
    const own = intro ? known.get(intro[1].toLowerCase()) : "";
    if (own) add(line.speaker, own, line.text, "high");

    const next = lines[index + 1];
    if (!next || next.speaker === line.speaker) return;
    const call = line.text.match(/^([A-Z][\w'-]{1,30})[,:-]\s/);
    const addressed = call ? known.get(call[1].toLowerCase()) : "";
    if (addressed) add(next.speaker, addressed, next.text, "high");
  });

  return matches;
}

export async function suggestSpeakerNames({ title, kind, participants = [], transcript = [] }) {
  const people = [
    ...new Map(
      (Array.isArray(participants) ? participants : [])
        .map((person) => plainText(typeof person === "string" ? person : person?.name, 80))
        .filter(Boolean)
        .map((name) => [name.toLowerCase(), name]),
    ).values(),
  ].slice(0, 20);
  const lines = nameLines(transcript);
  const counts = new Map();
  for (const line of lines) {
    if (!line.speaker) continue;
    if (people.some((name) => name.toLowerCase() === line.speaker.toLowerCase())) continue;
    counts.set(line.speaker, (counts.get(line.speaker) ?? 0) + 1);
  }
  const labels = [...counts.entries()].map(([speaker, count]) => ({ speaker, count }));
  if (!people.length || !labels.length) return { matches: [], provider: "none" };

  if (mockEnabled()) {
    return {
      matches: demoSpeakerNames({ people, labels, lines }),
      provider: "demo",
    };
  }

  const { value, provider } = await chatJson({
    messages: namesMessages({
      title: plainText(title, 160),
      kind,
      people,
      labels,
      transcript: nameTranscript(lines, 23_000),
    }),
    maxTokens: 700,
    temperature: 0,
  });

  const labelSet = new Map(labels.map((item) => [item.speaker.toLowerCase(), item.speaker]));
  const personMap = new Map(people.map((name) => [name.toLowerCase(), name]));
  const haystack = lines
    .map((line) => line.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const usedNames = new Set();
  const usedSpeakers = new Set();
  const matches = [];

  for (const item of Array.isArray(value?.matches) ? value.matches : []) {
    if (!item || typeof item.speaker !== "string" || typeof item.name !== "string") continue;
    const speaker = labelSet.get(item.speaker.trim().toLowerCase());
    const name = personMap.get(item.name.trim().toLowerCase());
    if (!speaker || !name) continue;
    if (usedSpeakers.has(speaker) || usedNames.has(name)) continue;
    const quote = plainText(item.quote, 140);
    const cleanQuote = quote.replace(/\s+/g, " ").toLowerCase();
    const supported = cleanQuote.length >= 8 && haystack.includes(cleanQuote);
    usedSpeakers.add(speaker);
    usedNames.add(name);
    matches.push({
      speaker,
      name,
      confidence: item.confidence === "high" ? "high" : "low",
      quote: supported ? quote : "",
    });
    if (matches.length >= 20) break;
  }

  return { matches, provider };
}

const assistSession = z.object({
  title: z.string().max(200).optional().default(""),
  kind: z.enum(["meeting", "seminar", "lecture", "voice"]).optional().default("meeting"),
  scratch: z.string().max(12_000).optional().default(""),
  notes: z.unknown().optional().nullable(),
  transcript: z
    .array(
      z.object({
        at: z.number().finite().min(0).max(24 * 3600),
        speaker: z.string().max(160).optional(),
        text: z.string().max(8_000),
      }),
    )
    .max(5_000)
    .optional()
    .default([]),
});

const assistHistory = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8_000) }))
  .max(8)
  .optional()
  .default([]);

const namesInput = z.object({
  title: z.string().max(200).optional().default(""),
  kind: z.enum(["meeting", "seminar", "lecture", "voice"]).optional().default("meeting"),
  participants: z.array(z.string().max(80)).max(20).optional().default([]),
  transcript: z
    .array(
      z.object({
        at: z.number().finite().min(0).max(24 * 3600).optional(),
        speaker: z.string().max(160).optional(),
        text: z.string().max(8_000),
      }),
    )
    .max(5_000)
    .optional()
    .default([]),
});

const briefInput = z.object({
  title: z.string().max(200).optional().default(""),
  kind: z.enum(["meeting", "seminar", "lecture", "voice"]).optional().default("meeting"),
  previous: z.object({
    title: z.string().max(200).optional().default(""),
    at: z.number().finite().min(0).max(4_102_444_800_000).optional().default(0),
    summary: z.string().max(4_000).optional().default(""),
    decisions: z.array(z.string().max(500)).max(20).optional().default([]),
    actions: z
      .array(
        z.object({
          text: z.string().max(500),
          owner: z.string().max(120).optional().default(""),
          done: z.boolean().optional().default(false),
        }),
      )
      .max(30)
      .optional()
      .default([]),
  }),
});

export async function handleAssist(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  const { user } = await requireSession(req);
  rateLimit(req, 90);
  const body = await readJson(req, 1_500_000);
  if (!body || typeof body !== "object") throw new HttpError(400, "The request was empty.");
  const mode = body.mode;

  if (mode === "brief") {
    if (!(await isProUser(user.id))) {
      throw new HttpError(
        402,
        "The live Pre-Meeting Brief is part of Pro. Your open follow-ups from last time still show, or upgrade to have JotBox write the brief.",
      );
    }
    const brief = briefInput.parse(body.brief);
    sendJson(res, 200, await buildPreMeetingBrief(brief));
    return;
  }

  if (mode === "ask") {
    const question = z.string().trim().min(3).max(500).parse(body.question);
    const history = assistHistory.parse(body.history);
    const session = assistSession.parse(body.session);
    sendJson(res, 200, await answerAboutSession({ question, history, session }));
    return;
  }

  if (mode === "insights") {
    const session = assistSession.parse(body.session);
    const existing = z
      .object({
        decisions: z.array(z.string().max(500)).max(20).optional().default([]),
        actions: z.array(z.object({ text: z.string().max(500), owner: z.string().max(120).optional() })).max(20).optional().default([]),
      })
      .optional()
      .default({ decisions: [], actions: [] });
    const parsed = existing.parse(body.existing ?? {});
    sendJson(res, 200, await extractLiveInsights({ session, existing: parsed }));
    return;
  }

  if (mode === "followup") {
    if (!(await isProUser(user.id))) {
      throw new HttpError(
        402,
        "AI follow-up drafts are part of Pro. The draft built from your notes is still free, or upgrade to let JotBox write it.",
      );
    }
    const channel = z.enum(["whatsapp", "email", "recap"]).parse(body.channel);
    const language = z.enum(["english", "pidgin"]).parse(body.language);
    const session = assistSession.parse(body.session);
    sendJson(res, 200, await draftFollowUpMessage({ session, channel, language }));
    return;
  }

  if (mode === "names") {
    const input = namesInput.parse(body);
    sendJson(res, 200, await suggestSpeakerNames(input));
    return;
  }

  throw new HttpError(400, "Choose ask, insights, followup, names or brief.");
}

const buckets = new Map();

function rateLimit(req, limit = 40, scope = "capture") {
  if (enabled("JOTBOX_AI_NO_RATE_LIMIT")) return;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const bucket = `${scope}:${clientIp(req)}`;
  const entry = buckets.get(bucket);
  if (!entry || now - entry.startedAt > windowMs) {
    buckets.set(bucket, { count: 1, startedAt: now });
    return;
  }
  entry.count += 1;
  if (entry.count > limit) {
    throw new HttpError(429, "Too many recordings in a short time. Take a short break and try again.");
  }
}

function sttContextFromRequest(req) {
  const raw = String(req.headers["x-jotbox-stt-context"] || "").trim();
  if (!raw || raw.length > 4000) return null;
  try {
    return sanitizeSttContext(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

export async function handleTranscribe(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  rateLimit(req);
  const body = await readBody(req, MAX_AUDIO);
  if (!body.length) throw new HttpError(400, "No recording was sent.");
  const contentType = String(req.headers["content-type"] || "application/octet-stream").split(";")[0];
  const filename = `session.${extensionFor(contentType)}`;
  const context = sttContextFromRequest(req);
  sendJson(res, 200, await transcribeAudio({ buffer: body, contentType, filename, context }));
}

// Small chunks from the desktop live captions. Higher request count, lower
// size cap, so the hourly audio budget stays below the capture endpoint.
export async function handleLiveTranscribe(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  rateLimit(req, 400, "live");
  const body = await readBody(req, MAX_LIVE_AUDIO);
  if (!body.length) throw new HttpError(400, "No audio was sent.");
  const contentType = String(req.headers["content-type"] || "application/octet-stream").split(";")[0];
  const filename = `live.${extensionFor(contentType)}`;
  const context = sttContextFromRequest(req);
  sendJson(res, 200, await transcribeAudio({ buffer: body, contentType, filename, context, live: true }));
}

export async function handleEnhance(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  rateLimit(req);
  const payload = await readJson(req, 2 * 1024 * 1024);
  if (!payload || typeof payload !== "object") throw new HttpError(400, "The notes request was empty.");
  const notes = await enhanceSession({
    kind: payload.kind,
    title: payload.title,
    scratch: payload.scratch,
    transcript: payload.transcript,
    tone: payload.tone,
    participants: Array.isArray(payload.participants) ? payload.participants : [],
  });
  sendJson(res, 200, notes);
}
