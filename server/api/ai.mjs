import { z } from "zod";
import { requireSession } from "./auth.mjs";
import { isProUser } from "./billing.mjs";
import { HttpError, assertSameOrigin, clientIp, readJson, requireMethod, sendJson } from "./http.mjs";

/**
 * JotBox AI gateway.
 *
 * Free-first provider chain:
 *   speech: Groq Whisper (free tier) -> self-hosted Speaches/faster-whisper -> xAI
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

const MAX_AUDIO = 80 * 1024 * 1024;
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

const STT_PROMPT = [
  "Transcribe verbatim. Keep each speaker's exact words.",
  "Speakers may mix Nigerian Pidgin, English, Yoruba, Igbo and Hausa in one sentence. Keep Pidgin as spoken; do not translate or correct it.",
  "Keep names, places, amounts and dates, and spell names and acronyms the way the room says them.",
  "Follow soft, far or fast speakers through language switches.",
  "Leave out background media, laughter and side talk.",
].join(" ");

const STT_PROMPT_LIMIT = 896;
const STT_BASE_LIMIT = 560;
const STT_VOCAB_LIMIT = 720;

const DEFAULT_GROQ_STT = "whisper-large-v3";
const WORKER_STT_DEFAULT = "Systran/faster-whisper-small";

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

function whisperBase() {
  return key("WHISPER_BASE_URL").replace(/\/+$/, "");
}

function sttLanguage() {
  const value = key("JOTBOX_STT_LANGUAGE").toLowerCase();
  if (value === "auto" || value === "none") return null;
  return value || DEFAULT_LANGUAGE;
}

function sttVocabulary() {
  return key("JOTBOX_STT_VOCAB")
    .split(/[\n,;]+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 60)
    .join(", ")
    .slice(0, STT_VOCAB_LIMIT);
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
  if (!title && !names.length) return null;
  return { title, kind, names, focus };
}

export function sttPrompt(context) {
  const base = (key("JOTBOX_STT_PROMPT") || STT_PROMPT).slice(0, STT_BASE_LIMIT);
  const vocab = sttVocabulary();
  const room = sanitizeSttContext(context);
  const kind = room?.kind && KIND_LABEL[room.kind] ? KIND_LABEL[room.kind] : "session";
  const topic = room?.title ? `This ${kind} is called "${room.title}".` : "";
  const focus =
    room?.focus === "off"
      ? ""
      : "Only transcribe speech that belongs to this session. Leave out side conversations, background media and room noise.";
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

export function aiStatus() {
  const transcribe = mockEnabled()
    ? "demo"
    : whisperBase()
      ? "self-hosted"
      : groqKey()
        ? "groq"
        : xaiKey()
          ? "xai"
          : null;
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
    tone: key("JOTBOX_AI_TONE") || DEFAULT_TONE,
    sttLanguage: sttLanguage() || "auto",
    sttVocabulary: vocabulary ? vocabulary.split(", ").length : 0,
    sttModel: whisperBase()
      ? key("WHISPER_MODEL") || WORKER_STT_DEFAULT
      : key("GROQ_STT_MODEL") || DEFAULT_GROQ_STT,
  };
}

function providerError(provider, response, detail, message) {
  console.error(`[jotbox-ai] ${provider} failed`, response?.status ?? "", String(detail ?? "").slice(0, 500));
  return new HttpError(
    502,
    message || "JotBox could not read that recording. Try again, or add the words by hand.",
  );
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
  /^(?:thank you for watching|thanks for watching|please subscribe|subscribe|like and subscribe)[.!]?$/i,
  /^\[?(?:music|applause|laughter|silence|noise|background noise|inaudible|crosstalk)\]?[.!]?$/i,
  /^(?:you|uh|um|hmm|mm)[.!]?$/i,
];

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

export function normalizeTranscription(data, provider) {
  let words = Array.isArray(data?.words)
    ? data.words
        .map((word) => {
          const text = cleanWord(word?.word ?? word?.text);
          const start = Number(word?.start);
          const end = Number(word?.end);
          const speaker = Number(word?.speaker);
          return {
            text,
            start: Number.isFinite(start) ? start : 0,
            end: Number.isFinite(end) ? end : Number.isFinite(start) ? start : 0,
            ...(Number.isFinite(speaker) ? { speaker } : {}),
          };
        })
        .filter((word) => word.text)
    : [];

  const segments = Array.isArray(data?.segments) ? data.segments : [];
  const kept = segments.filter((segment) => !segmentIsNoise(segment));
  const filtered = segments.length - kept.length;

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
  if (HALLUCINATIONS.some((pattern) => pattern.test(text))) {
    text = "";
    words = [];
  }
  text = text.replace(/\s+([,.!?;:])/g, "$1").trim();

  return {
    text,
    words,
    language: typeof data?.language === "string" ? data.language : null,
    provider,
    filtered,
  };
}

async function transcribeWithGroq(buffer, contentType, filename, context) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), filename);
  form.append("model", key("GROQ_STT_MODEL") || DEFAULT_GROQ_STT);
  const language = sttLanguage();
  if (language) form.append("language", language);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("prompt", sttPrompt(context));
  form.append("temperature", "0");

  const response = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${groqKey()}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw providerError("groq-stt", response, await response.text());
  return normalizeTranscription(await response.json(), "groq");
}

async function transcribeWithWorker(buffer, contentType, filename, context) {
  const base = whisperBase();
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), filename);
  form.append("model", key("WHISPER_MODEL") || WORKER_STT_DEFAULT);
  const language = sttLanguage();
  if (language) form.append("language", language);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("prompt", sttPrompt(context));
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
  const response = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw providerError("whisper-worker", response, await response.text());
  return normalizeTranscription(await response.json(), "self-hosted");
}

async function transcribeWithXai(buffer, contentType, filename, context) {
  const form = new FormData();
  form.append("model", key("XAI_STT_MODEL") || "grok-voice-transcribe-2.0");
  const language = sttLanguage();
  if (language) form.append("language", language);
  form.append("format", "true");
  form.append("diarize", "true");
  form.append("prompt", sttPrompt(context));
  form.append("file", new Blob([buffer], { type: contentType }), filename);

  const response = await fetch(XAI_STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${xaiKey()}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw providerError("xai-stt", response, await response.text());
  return normalizeTranscription(await response.json(), "xai");
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

export async function transcribeAudio({ buffer, contentType, filename, context }) {
  const attempts = [];
  const providers = [];
  if (buffer.length > GROQ_FREE_MAX && whisperBase()) providers.push("worker");
  if (groqKey() && buffer.length <= GROQ_FREE_MAX) providers.push("groq");
  if (whisperBase()) providers.push("worker");
  if (xaiKey()) providers.push("xai");
  if (mockEnabled()) providers.push("demo");

  for (const provider of providers) {
    try {
      if (provider === "groq") return await transcribeWithGroq(buffer, contentType, filename, context);
      if (provider === "worker") return await transcribeWithWorker(buffer, contentType, filename, context);
      if (provider === "xai") return await transcribeWithXai(buffer, contentType, filename, context);
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
      "HTTP-Referer": key("JOTBOX_PUBLIC_URL") || "https://jotbox-eight.vercel.app",
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

export async function enhanceSession({ kind, title, scratch, transcript, tone, participants = [] }) {
  const payload = {
    kind: KIND_LABEL[kind] ? kind : "meeting",
    title: String(title || "").slice(0, 160),
    scratch: String(scratch || "").slice(0, MAX_SCRATCH),
    transcript: String(transcript || "").slice(0, MAX_TRANSCRIPT),
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
        headers["HTTP-Referer"] = key("JOTBOX_PUBLIC_URL") || "https://jotbox-eight.vercel.app";
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

export async function handleAssist(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  const { user } = await requireSession(req);
  rateLimit(req, 90);
  const body = await readJson(req, 1_500_000);
  if (!body || typeof body !== "object") throw new HttpError(400, "The request was empty.");
  const mode = body.mode;

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

  throw new HttpError(400, "Choose ask, insights or followup.");
}

const buckets = new Map();

function rateLimit(req, limit = 40) {
  if (enabled("JOTBOX_AI_NO_RATE_LIMIT")) return;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const ip = clientIp(req);
  const entry = buckets.get(ip);
  if (!entry || now - entry.startedAt > windowMs) {
    buckets.set(ip, { count: 1, startedAt: now });
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
