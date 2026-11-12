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
  "Transcribe verbatim. Keep every speaker's words exactly as spoken.",
  "The speakers may use Nigerian Pidgin, standard English, or a mix with Yoruba, Igbo and Hausa.",
  "Keep Pidgin grammar, slang and code-switching intact: words like wetin, dey, na, sha, abeg, wahala, oga, no wahala, e go, make we.",
  "Do not translate Pidgin into formal English. Do not correct grammar. Keep names, places, amounts and dates.",
].join(" ");

const STT_VOCAB_LIMIT = 600;

const NOTES_SYSTEM = `You are JotBox, a note writer for meetings, seminars, lectures and voice notes recorded in Nigeria and across West Africa.
The transcript is what was said. The scratch notes are what the listener marked. When scratch notes exist, treat them as the spine and expand them from the transcript.

Language and tone:
- Speakers may use Nigerian Pidgin, standard English, or a mix with Yoruba, Igbo and Hausa. Treat Pidgin as a full language, not as broken English.
- Do not translate or "correct" Pidgin into corporate English. Keep the room's warmth, directness, humour and urgency.
- Write the notes themselves in clear, simple English. When a Pidgin phrase carries meaning, emotion or a decision, keep it in quotation marks and let the surrounding sentence carry the meaning.
- Never invent names, numbers, decisions, quotes, owners or assignments.
- Do not add praise, preamble, warnings or filler.

Shape:
- Title: specific, under 8 words, no quotation marks.
- Summary: one short paragraph a person could send to someone who missed the session.
- Highlights: the points worth keeping. Each one is a full sentence.
- Actions: only real commitments and next steps. Owner is the person named, "You" when the listener took it, or "Unassigned". Use an empty list when there is nothing to do.
- Sections follow the shape of the session. Meetings lean on decisions and discussion. Lectures and seminars follow the topics that were taught. Voice notes stay short.
- If the transcript is thin, write only from what is there.

Return only a JSON object with this exact shape:
{"title":"string","summary":"string","highlights":["string"],"actions":[{"text":"string","owner":"string"}],"sections":[{"heading":"string","bullets":["string"]}]}`;

const TONE_HINT = {
  "warm-direct": "Write like a trusted colleague briefing you: clear, warm and direct. Keep the energy of the room.",
  concise: "Keep the summary and bullets tight. Prefer short sentences and no repeated point.",
  formal: "Use a calm, professional register, but keep Pidgin phrases that carry the decision or the tone.",
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

export function sttPrompt() {
  const base = key("JOTBOX_STT_PROMPT") || STT_PROMPT;
  const vocab = sttVocabulary();
  return [base, vocab ? `Names and terms this room uses, spelled the way they say them: ${vocab}.` : ""]
    .filter(Boolean)
    .join(" ");
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
      ? key("WHISPER_MODEL") || "Systran/faster-whisper-small"
      : key("GROQ_STT_MODEL") || "whisper-large-v3-turbo",
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

function normalizeTranscription(data, provider) {
  const words = Array.isArray(data?.words)
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

  let text = typeof data?.text === "string" ? data.text.trim() : "";
  if (!text && Array.isArray(data?.segments)) {
    text = data.segments.map((segment) => cleanWord(segment?.text)).filter(Boolean).join(" ");
  }
  if (!text) text = words.map((word) => word.text).join(" ");
  text = text.replace(/\s+([,.!?;:])/g, "$1").trim();

  return {
    text,
    words,
    language: typeof data?.language === "string" ? data.language : null,
    provider,
  };
}

async function transcribeWithGroq(buffer, contentType, filename) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), filename);
  form.append("model", key("GROQ_STT_MODEL") || "whisper-large-v3-turbo");
  const language = sttLanguage();
  if (language) form.append("language", language);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("prompt", sttPrompt());
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

async function transcribeWithWorker(buffer, contentType, filename) {
  const base = whisperBase();
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), filename);
  form.append("model", key("WHISPER_MODEL") || "Systran/faster-whisper-small");
  const language = sttLanguage();
  if (language) form.append("language", language);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("prompt", sttPrompt());
  form.append("temperature", "0");

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

async function transcribeWithXai(buffer, contentType, filename) {
  const form = new FormData();
  form.append("model", key("XAI_STT_MODEL") || "grok-voice-transcribe-2.0");
  const language = sttLanguage();
  if (language) form.append("language", language);
  form.append("format", "true");
  form.append("diarize", "true");
  form.append("prompt", sttPrompt());
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

export async function transcribeAudio({ buffer, contentType, filename }) {
  const status = aiStatus();
  const attempts = [];
  const providers = [];
  if (buffer.length > GROQ_FREE_MAX && whisperBase()) providers.push("worker");
  if (groqKey() && buffer.length <= GROQ_FREE_MAX) providers.push("groq");
  if (whisperBase()) providers.push("worker");
  if (xaiKey()) providers.push("xai");
  if (mockEnabled()) providers.push("demo");

  for (const provider of providers) {
    try {
      if (provider === "groq") return await transcribeWithGroq(buffer, contentType, filename);
      if (provider === "worker") return await transcribeWithWorker(buffer, contentType, filename);
      if (provider === "xai") return await transcribeWithXai(buffer, contentType, filename);
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

function notesMessages({ kind, title, scratch, transcript, tone }) {
  const toneName = TONE_HINT[tone] ? tone : DEFAULT_TONE;
  return [
    { role: "system", content: NOTES_SYSTEM },
    {
      role: "user",
      content: [
        `Session kind: ${KIND_LABEL[kind] || "meeting"}`,
        `Tone: ${toneName}. ${TONE_HINT[toneName]}`,
        `Working title: ${title || "(none)"}`,
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

export async function enhanceSession({ kind, title, scratch, transcript, tone }) {
  const payload = {
    kind: KIND_LABEL[kind] ? kind : "meeting",
    title: String(title || "").slice(0, 160),
    scratch: String(scratch || "").slice(0, MAX_SCRATCH),
    transcript: String(transcript || "").slice(0, MAX_TRANSCRIPT),
    tone: TONE_HINT[tone] ? tone : key("JOTBOX_AI_TONE") || DEFAULT_TONE,
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

export async function handleTranscribe(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  rateLimit(req);
  const body = await readBody(req, MAX_AUDIO);
  if (!body.length) throw new HttpError(400, "No recording was sent.");
  const contentType = String(req.headers["content-type"] || "application/octet-stream").split(";")[0];
  const filename = `session.${extensionFor(contentType)}`;
  sendJson(res, 200, await transcribeAudio({ buffer: body, contentType, filename }));
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
  });
  sendJson(res, 200, notes);
}
