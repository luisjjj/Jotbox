import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

const MANAGED = [
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENROUTER_NOTES_MODEL",
  "XAI_API_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_STT_MODEL",
  "JOTBOX_STT_KEYTERMS",
  "JOTBOX_STT_PROVIDER",
  "WHISPER_BASE_URL",
  "WHISPER_API_KEY",
  "WHISPER_MODEL",
  "GROQ_NOTES_MODEL",
  "JOTBOX_NOTES_PROVIDER",
  "GROQ_STT_MODEL",
  "GROQ_LIVE_STT_MODEL",
  "VERCEL",
  "JOTBOX_AI_MOCK",
  "JOTBOX_AI_TONE",
  "JOTBOX_STT_LANGUAGE",
  "JOTBOX_STT_VOCAB",
  "JOTBOX_STT_PROMPT",
  "JOTBOX_STT_NO_SPEECH",
  "JOTBOX_STT_LOGPROB",
  "JOTBOX_STT_COMPRESSION",
  "JOTBOX_STT_WORKER_TUNING",
];
const original = new Map(MANAGED.map((name) => [name, process.env[name]]));
const originalFetch = globalThis.fetch;

function resetEnv() {
  for (const name of MANAGED) {
    const value = original.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  globalThis.fetch = originalFetch;
}

beforeEach(() => {
  resetEnv();
  for (const name of MANAGED) delete process.env[name];
});
afterEach(resetEnv);

const ai = await import("../server/api/ai.mjs");

test("speech prompt treats Pidgin as normal speech and takes room vocabulary", () => {
  const prompt = ai.sttPrompt({ language: "pcm" });
  assert.match(prompt, /Transcribe verbatim in Nigerian English mixed with Nigerian Pidgin/);
  assert.match(prompt, /Do not translate to English and do not correct grammar/);
  assert.match(prompt, /wetin dey happen, make we check am/);
  assert.match(prompt, /Keep names, places and amounts exactly as said/);

  process.env.JOTBOX_STT_VOCAB = "Chinedu, Ibadan, NIPOST";
  assert.match(ai.sttPrompt({ language: "pcm" }), /Chinedu, Ibadan, NIPOST/);

  process.env.JOTBOX_STT_PROMPT = "Transcribe the room verbatim.";
  const override = ai.sttPrompt();
  assert.match(override, /^Transcribe the room verbatim\./);
});

test("speech prompt stays inside the Groq character limit under a full room", () => {
  process.env.JOTBOX_STT_VOCAB = Array.from({ length: 60 }, (_, index) => `Ibadan term ${index}`).join(", ");
  const prompt = ai.sttPrompt({
    title: "Quarterly earnings review for the whole commercial team",
    kind: "meeting",
    names: Array.from({ length: 20 }, (_, index) => `Colleague ${index}`),
    focus: "balanced",
  });
  assert.ok(prompt.length <= 896, `prompt was ${prompt.length} characters`);
  assert.match(prompt, /Colleague 0/);
});

test("speech vocabulary keeps comma amounts in one term", () => {
  process.env.JOTBOX_STT_VOCAB = "₦450,000, KYC, NIP transfer";
  const prompt = ai.sttPrompt();
  assert.match(prompt, /₦450,000, KYC, NIP transfer/);
  assert.ok(prompt.length <= 896);
});

test("speech prompt carries the session title, focus and roster names", () => {
  const prompt = ai.sttPrompt({
    title: "Quarterly earnings review",
    kind: "meeting",
    names: ["Ada", "Chinedu"],
    focus: "balanced",
  });
  assert.match(prompt, /Transcribe verbatim in Nigerian English/);
  assert.match(prompt, /This meeting is called "Quarterly earnings review"\./);
  assert.match(prompt, /Keep every word you can hear, even in a noisy room\./);
  assert.match(prompt, /Ada, Chinedu/);

  const open = ai.sttPrompt({ title: "Lecture notes", kind: "lecture", names: [], focus: "off" });
  assert.doesNotMatch(open, /Keep every word you can hear/);

  assert.equal(ai.sanitizeSttContext({ title: "", names: [] }), null);
  assert.equal(ai.sanitizeSttContext(null), null);
});

test("speech prompt follows the chosen language and keeps Pidgin on its own register", () => {
  assert.match(ai.sttPrompt({ language: "yo" }), /Verbatim Yoruba transcript/);
  assert.match(ai.sttPrompt({ language: "ha" }), /Verbatim Hausa transcript/);
  assert.match(ai.sttPrompt({ language: "ig" }), /Verbatim Igbo transcript/);
  assert.match(ai.sttPrompt({ language: "pcm" }), /Nigerian Pidgin/);
  assert.match(ai.sttPrompt({ language: "en" }), /Nigerian English/);

  assert.deepEqual(ai.sanitizeSttContext({ title: "", names: [], language: "yo" }), {
    title: "",
    kind: "",
    mode: "",
    names: [],
    focus: "balanced",
    language: "yo",
  });
  assert.equal(ai.sanitizeSttContext({ language: "xx" }), null);
});

test("Igbo asks for the Igbo reader instead of failing at the hosted provider", async () => {
  await assert.rejects(
    ai.transcribeAudio({
      buffer: Buffer.from("tiny"),
      contentType: "audio/wav",
      filename: "tiny.wav",
      context: { language: "ig" },
    }),
    (error) => error.status === 400 && /Igbo/.test(error.message),
  );
});

test("status reports English, warm tone and Pidgin on by default", () => {
  const status = ai.aiStatus();
  assert.equal(status.sttLanguage, "en");
  assert.equal(status.pidgin, true);
  assert.equal(status.tone, "warm-direct");
  assert.equal(status.transcribe, null);
  assert.equal(status.notes, null);
  assert.equal(status.sttModel, "whisper-large-v3");
  assert.equal(status.sttLiveModel, "whisper-large-v3-turbo");

  process.env.JOTBOX_STT_LANGUAGE = "auto";
  assert.equal(ai.aiStatus().sttLanguage, "auto");
});

test("Scribe reads the full recording with speaker ids and keyterms", async () => {
  process.env.ELEVENLABS_API_KEY = "test-scribe";
  process.env.JOTBOX_STT_VOCAB = "NIPOST, KYC";
  process.env.JOTBOX_STT_KEYTERMS = "JotBox, Q4";
  let form;
  let headers;

  globalThis.fetch = async (url, init = {}) => {
    assert.match(String(url), /api\.elevenlabs\.io\/v1\/speech-to-text/);
    form = init.body;
    headers = init.headers;
    return Response.json({
      text: "Ah wetin happen ?",
      language_code: "en",
      language_probability: 0.9,
      words: [
        { text: "Ah", type: "word", start: 0.1, end: 0.3, speaker_id: "speaker_0", logprob: -0.1 },
        { text: " ", type: "spacing", start: 0.3, end: 0.35, speaker_id: "speaker_0", logprob: -0.1 },
        { text: "wetin", type: "word", start: 0.35, end: 0.6, speaker_id: "speaker_0", logprob: -0.1 },
        { text: "(laughter)", type: "audio_event", start: 0.6, end: 0.9, speaker_id: "speaker_1", logprob: -0.1 },
        { text: "happen", type: "word", start: 0.9, end: 1.2, speaker_id: "speaker_1", logprob: -0.1 },
      ],
    });
  };

  const result = await ai.transcribeAudio({
    buffer: Buffer.from("audio"),
    contentType: "audio/webm",
    filename: "sample.webm",
    plan: "enterprise",
    context: { title: "Friday payout review", kind: "meeting", names: ["Ada", "Chinedu"], focus: "balanced", language: "pcm" },
  });

  assert.equal(result.provider, "elevenlabs");
  assert.equal(result.language, "en");
  assert.equal(result.text, "Ah wetin happen?");
  assert.deepEqual(
    result.words.map((word) => [word.text, word.speaker]),
    [
      ["Ah", 0],
      ["wetin", 0],
      ["happen", 1],
    ],
  );
  assert.equal(new Headers(headers).get("xi-api-key"), "test-scribe");
  assert.equal(form.get("model_id"), "scribe_v3");
  assert.equal(form.get("diarize"), "true");
  assert.equal(form.get("timestamps_granularity"), "word");
  // Pidgin has no Scribe language code, so it auto-detects instead of being forced to English.
  assert.equal(form.get("language_code"), null);
  assert.deepEqual(form.getAll("keyterms"), ["Ada", "Chinedu", "NIPOST", "KYC", "JotBox", "Q4"]);
});

test("Scribe sends a supported language code for Yoruba", async () => {
  process.env.ELEVENLABS_API_KEY = "test-scribe";
  let form;

  globalThis.fetch = async (_url, init = {}) => {
    form = init.body;
    return Response.json({ text: "Sannu", language_code: "yo", language_probability: 0.9, words: [] });
  };

  await ai.transcribeAudio({
    buffer: Buffer.from("audio"),
    contentType: "audio/webm",
    filename: "sample.webm",
    context: { language: "yo" },
  });

  assert.equal(form.get("language_code"), "yo");
});

test("Scribe retries without options the account rejects", async () => {
  process.env.ELEVENLABS_API_KEY = "test-scribe";
  const forms = [];

  globalThis.fetch = async (_url, init = {}) => {
    forms.push({
      language: init.body.get("language_code"),
      keyterms: init.body.getAll("keyterms"),
    });
    if (forms.length === 1) return Response.json({ detail: "unsupported language" }, { status: 422 });
    return Response.json({ text: "Hello there.", language_code: "en", language_probability: 0.9, words: [] });
  };

  const result = await ai.transcribeAudio({
    buffer: Buffer.from("audio"),
    contentType: "audio/webm",
    filename: "sample.webm",
    context: { language: "ig", names: ["Ada"] },
  });

  assert.equal(result.provider, "elevenlabs");
  assert.equal(forms.length, 2);
  assert.equal(forms[0].language, "ig");
  assert.equal(forms[1].language, null);
  assert.deepEqual(forms[1].keyterms, []);
});

test("live captions use Scribe too when it is configured", async () => {
  process.env.ELEVENLABS_API_KEY = "test-scribe";
  process.env.GROQ_API_KEY = "test-groq";
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), model: init.body.get("model_id"), diarize: init.body.get("diarize") });
    return Response.json({ text: "make we pause", language_code: "en", language_probability: 0.9, words: [] });
  };

  await ai.transcribeAudio({
    buffer: Buffer.from("audio"),
    contentType: "audio/webm",
    filename: "live.webm",
    live: true,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\.elevenlabs\.io/);
  assert.equal(calls[0].model, "scribe_v3");
  assert.equal(calls[0].diarize, null);
});

test("live Scribe chunks keep the room names and vocabulary as keyterms", () => {
  process.env.ELEVENLABS_API_KEY = "test-scribe";
  process.env.JOTBOX_STT_VOCAB = "NIPOST, KYC";

  const route = ai.routingForCapture({
    live: true,
    context: { title: "Weekly sync", kind: "meeting", names: ["Ada", "Chinedu"], focus: "balanced" },
  });

  assert.equal(route.provider, "elevenlabs");
  assert.equal(route.prompt, "none");
  assert.deepEqual(route.keyterms, ["Ada", "Chinedu", "NIPOST", "KYC"]);
});

test("live chunks on a fallback reader stay keyterm free", () => {
  process.env.GROQ_API_KEY = "test-groq";

  const route = ai.routingForCapture({ live: true, context: { names: ["Ada"] } });

  assert.equal(route.provider, "groq");
  assert.deepEqual(route.keyterms, []);
});

test("JOTBOX_STT_PROVIDER pins the order for a provider benchmark", async () => {
  process.env.ELEVENLABS_API_KEY = "test-scribe";
  process.env.GROQ_API_KEY = "test-groq";
  process.env.JOTBOX_STT_PROVIDER = "groq,elevenlabs";
  const calls = [];

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return Response.json({ text: "bench", words: [], segments: [] });
  };

  const result = await ai.transcribeAudio({
    buffer: Buffer.from("audio"),
    contentType: "audio/webm",
    filename: "sample.webm",
  });

  assert.equal(result.provider, "groq");
  assert.match(calls[0], /api\.groq\.com/);
});

test("status reports Scribe and diarization when its key is set", () => {
  process.env.ELEVENLABS_API_KEY = "test-scribe";
  process.env.GROQ_API_KEY = "test-groq";
  const status = ai.aiStatus();

  assert.equal(status.transcribe, "elevenlabs");
  assert.equal(status.diarization, true);
  assert.equal(status.sttModel, "scribe_v3");
  // Live previews report the same Scribe reader.
  assert.equal(status.sttLiveModel, "scribe_v3");
});

test("demo transcription keeps Pidgin words and speaker turns", async () => {
  process.env.JOTBOX_AI_MOCK = "1";
  const result = await ai.transcribeAudio({
    buffer: Buffer.from("demo"),
    contentType: "audio/webm",
    filename: "sample.webm",
  });

  assert.equal(result.provider, "demo");
  assert.equal(result.language, "en-NG");
  assert.match(result.text, /wetin happen/);
  assert.match(result.text, /No wahala, make we pause/);
  assert.ok(result.words.length > 30);
  assert.deepEqual([...new Set(result.words.map((word) => word.speaker))], [0, 1]);
  assert.ok(result.words.every((word) => word.text && word.text.trim() === word.text));
});

test("transcription falls over from Groq to the worker and normalises words", async () => {
  process.env.GROQ_API_KEY = "test-groq";
  process.env.WHISPER_BASE_URL = "http://whisper.test/v1";
  const calls = [];
  const forms = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push(String(url));
    if (init.body instanceof FormData) forms.push(init.body);
    if (String(url).includes("api.groq.com")) {
      return new Response("upstream busy", { status: 502 });
    }
    return Response.json({
      text: "Ah wetin happen ?",
      language: "en",
      words: [
        { word: "Ah", start: "0.10", end: "0.40", speaker: 0 },
        { word: "wetin", start: 0.5, end: 0.9, speaker: 0 },
        { word: "happen", start: 1, end: 1.4 },
        { word: " ", start: 1.4, end: 1.5 },
      ],
    });
  };

  const result = await ai.transcribeAudio({
    buffer: Buffer.from("audio"),
    contentType: "audio/webm",
    filename: "sample.webm",
  });

  assert.equal(result.provider, "self-hosted");
  assert.equal(result.text, "Ah wetin happen?");
  assert.equal(result.words.length, 3);
  assert.equal(result.words[0].start, 0.1);
  assert.equal(result.words[2].speaker, undefined);
  assert.equal(calls.length, 3);
  assert.match(calls[0], /api\.groq\.com/);
  assert.match(calls[1], /api\.groq\.com/);
  assert.match(calls[2], /whisper\.test\/v1\/audio\/transcriptions/);
  assert.equal(forms[2].get("condition_on_previous_text"), "false");
  assert.equal(forms[2].get("vad_filter"), "true");
  assert.match(String(forms[2].get("vad_parameters")), /speech_pad_ms/);
});

test("transcription removes noise segments and keeps the room's words", async () => {
  process.env.GROQ_API_KEY = "test-groq";
  let form;

  globalThis.fetch = async (_url, init = {}) => {
    form = init.body;
    return Response.json({
      text: "Revenue is up 12 percent. [music] Thank you for watching. mumble mumble",
      language: "en",
      words: [
        { word: "Revenue", start: 0, end: 0.4 },
        { word: "is", start: 0.4, end: 0.5 },
        { word: "up", start: 0.5, end: 0.7 },
        { word: "12", start: 0.7, end: 0.9 },
        { word: "percent.", start: 0.9, end: 1.4 },
        { word: "music", start: 3, end: 3.4 },
        { word: "mumble", start: 8, end: 8.4 },
      ],
      segments: [
        { text: " Revenue is up 12 percent. ", start: 0, end: 2, no_speech_prob: 0.02, avg_logprob: -0.2, compression_ratio: 1.1 },
        { text: " [music] ", start: 3, end: 4, no_speech_prob: 0.1, avg_logprob: -0.4, compression_ratio: 1.2 },
        { text: " Thank you for watching. ", start: 4.5, end: 6, no_speech_prob: 0.1, avg_logprob: -0.3, compression_ratio: 1.2 },
        { text: " mumble mumble ", start: 8, end: 9, no_speech_prob: 0.92, avg_logprob: -1.9, compression_ratio: 1.2 },
      ],
    });
  };

  const result = await ai.transcribeAudio({
    buffer: Buffer.from("audio"),
    contentType: "audio/webm",
    filename: "sample.webm",
    plan: "pro",
    context: { title: "Quarterly earnings review", kind: "meeting", mode: "lecture", names: ["Ada"], focus: "balanced" },
  });

  assert.equal(result.provider, "groq");
  assert.equal(result.filtered, 3);
  assert.equal(result.text, "Revenue is up 12 percent.");
  assert.deepEqual(
    result.words.map((word) => word.text),
    ["Revenue", "is", "up", "12", "percent."],
  );
  assert.equal(form.get("model"), "whisper-large-v3");
  assert.equal(form.get("temperature"), "0");
  assert.match(String(form.get("prompt")), /Quarterly earnings review/);
  assert.match(String(form.get("prompt")), /Ada/);
});

test("live transcription keeps quiet noisy speech instead of dropping the chunk", async () => {
  process.env.GROQ_API_KEY = "test-groq";

  let form;
  globalThis.fetch = async (url, init) => {
    form = init.body;
    return Response.json({
      text: "make we pause the promise",
      language: "en-NG",
      words: [
        { word: "make", start: 0, end: 0.3 },
        { word: "we", start: 0.3, end: 0.4 },
        { word: "pause", start: 0.4, end: 0.7 },
        { word: "the", start: 0.7, end: 0.8 },
        { word: "promise", start: 0.8, end: 1.2 },
      ],
      segments: [
        {
          text: " make we pause the promise ",
          start: 0,
          end: 2,
          no_speech_prob: 0.92,
          avg_logprob: -1.9,
          compression_ratio: 2.9,
        },
      ],
    });
  };

  const result = await ai.transcribeAudio({
    buffer: Buffer.from("audio"),
    contentType: "audio/webm",
    filename: "live.webm",
    live: true,
  });

  assert.equal(result.text, "make we pause the promise");
  assert.equal(result.filtered, 0);
  assert.equal(result.words.length, 5);
  assert.equal(form.get("prompt"), null);
  assert.equal(form.get("model"), "whisper-large-v3-turbo");
});

test("live and final passes can each name their own Groq model", async () => {
  process.env.GROQ_API_KEY = "test-groq";
  process.env.GROQ_STT_MODEL = "whisper-large-v3";
  process.env.GROQ_LIVE_STT_MODEL = "whisper-large-v3-turbo";

  const models = [];
  globalThis.fetch = async (url, init) => {
    models.push(init.body.get("model"));
    return Response.json({ text: "hello", words: [], segments: [] });
  };

  await ai.transcribeAudio({ buffer: Buffer.from("audio"), contentType: "audio/webm", filename: "live.webm", live: true });
  await ai.transcribeAudio({ buffer: Buffer.from("audio"), contentType: "audio/webm", filename: "final.webm" });

  assert.deepEqual(models, ["whisper-large-v3-turbo", "whisper-large-v3"]);
});

test("live previews carry no prompt so Whisper cannot recite instructions", () => {
  assert.equal(ai.sttPrompt({ title: "Weekly sync", kind: "meeting", names: ["Ada"], focus: "balanced" }, { live: true }), "");
  assert.match(ai.sttPrompt({ title: "Weekly sync", kind: "meeting", names: ["Ada"] }), /Weekly sync/);
});

test("a segment that recites the prompt is dropped instead of shown as speech", () => {
  const prompt = ai.sttPrompt({ title: "Weekly sync", kind: "meeting", names: ["Ada"] });
  const result = ai.normalizeTranscription(
    {
      words: [],
      segments: [
        { text: " Keep every word you can hear, even in a noisy room. ", start: 0, end: 2 },
        { text: " Ada will send the payout file before four. ", start: 2, end: 5 },
      ],
    },
    "groq",
    { prompt },
  );

  assert.equal(result.filtered, 1);
  assert.equal(result.text, "Ada will send the payout file before four.");
});

test("transcript cleanup collapses recognition loops and drops repeated lines", () => {
  assert.equal(
    ai.tidyTranscript("make we pause the pause the pause the promise"),
    "make we pause the promise",
  );
  assert.equal(
    ai.tidyTranscript("Ada: send the note\nAda: send the note\nChinedu: confirm the batches"),
    "Ada: send the note\nChinedu: confirm the batches",
  );
  assert.equal(ai.tidyTranscript("[music]\nWe agreed on 4pm"), "We agreed on 4pm");
});

test("segment speakers are copied onto words when a provider diarizes", () => {
  const result = ai.normalizeTranscription(
    {
      text: "Ada spoke first. Chinedu answered.",
      words: [
        { word: "Ada", start: 0, end: 0.3 },
        { word: "spoke", start: 0.3, end: 0.6 },
        { word: "first.", start: 0.6, end: 1 },
        { word: "Chinedu", start: 1.2, end: 1.6 },
        { word: "answered.", start: 1.6, end: 2 },
      ],
      segments: [
        { text: " Ada spoke first. ", start: 0, end: 1, speaker: 0 },
        { text: " Chinedu answered. ", start: 1.2, end: 2, speaker: 1 },
      ],
    },
    "xai",
  );

  assert.deepEqual(
    result.words.map((word) => word.speaker),
    [0, 0, 0, 1, 1],
  );
});

test("provider speaker labels like SPEAKER_00 map to turn indexes", () => {
  const result = ai.normalizeTranscription(
    {
      text: "One two three",
      words: [
        { word: "One", start: 0, end: 0.2, speaker: "SPEAKER_00" },
        { word: "two", start: 0.2, end: 0.4, speaker: "SPEAKER_00" },
        { word: "three", start: 0.5, end: 0.7, speaker: "SPEAKER_01" },
      ],
    },
    "groq",
  );

  assert.deepEqual(
    result.words.map((word) => word.speaker),
    [0, 0, 1],
  );
});

test("worker tuning can be turned off for a plain OpenAI-compatible server", async () => {
  process.env.WHISPER_BASE_URL = "http://whisper.test/v1";
  process.env.JOTBOX_STT_WORKER_TUNING = "off";
  let form;

  globalThis.fetch = async (_url, init = {}) => {
    form = init.body;
    return Response.json({ text: "Hello there.", language: "en" });
  };

  const result = await ai.transcribeAudio({
    buffer: Buffer.from("audio"),
    contentType: "audio/webm",
    filename: "sample.webm",
  });

  assert.equal(result.provider, "self-hosted");
  assert.equal(form.get("condition_on_previous_text"), null);
  assert.equal(form.get("vad_filter"), null);
});

test("notes keep Pidgin flavour for a Pidgin room and read plainly for English", async () => {
  process.env.JOTBOX_AI_MOCK = "1";

  const pidgin = await ai.enhanceSession({
    kind: "meeting",
    title: "Friday payout review",
    scratch: "Pause same-day promise",
    transcript:
      "Speaker 1: Ah, wetin happen to the Friday payout?\nSpeaker 2: E be like the bank dey slow us down, the file reach them late.",
    tone: "warm-direct",
  });

  const english = await ai.enhanceSession({
    kind: "meeting",
    title: "Friday payout review",
    scratch: "",
    transcript:
      "Speaker 1: The file reached the bank late.\nSpeaker 2: We will pause the same-day promise until the cutoff holds.",
    tone: "warm-direct",
  });

  assert.equal(pidgin.provider, "demo");
  assert.match(pidgin.summary, /bank acknowledged the file late/i);
  assert.notEqual(pidgin.summary, english.summary);
  assert.ok(pidgin.highlights.some((item) => /make we pause/i.test(item)));
  assert.equal(pidgin.actions[0].owner, "Ada");
  assert.ok(english.actions.length > 0);
});

test("report translation returns the source report in demo mode", async () => {
  process.env.JOTBOX_AI_MOCK = "1";
  const report = {
    title: "",
    summary: "The room agreed to pause the same-day promise.",
    highlights: ["The bank acknowledged the file late."],
    decisions: ["Pause the same-day promise."],
    blockers: ["The bank window slipped to 4pm."],
    actions: [{ text: "Send the merchant note", owner: "Ada", due: "2026-11-20" }],
    followUps: [{ to: "Ada", subject: "Merchant note", body: "Send it before four." }],
    sections: [{ heading: "What changed", bullets: ["Same-day wording went out."] }],
  };

  const result = await ai.translateSessionReport({ language: "pcm", report });

  assert.equal(result.provider, "demo");
  assert.equal(result.summary, report.summary);
  assert.deepEqual(result.actions, report.actions);
  assert.equal(result.sections[0].bullets[0], "Same-day wording went out.");
});

test("report translation asks for the chosen language and keeps item slots", async () => {
  process.env.GROQ_API_KEY = "test-groq";
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "",
              summary: "Ìgbìmọ̀ gbà láti dá ìlérí owó ọjọ́ kan dúró.",
              highlights: ["Báńkì náà gbà fọ́ọ̀mù náà pẹ́."],
              decisions: [],
              blockers: ["", ""],
              actions: [{ text: "Fi ìwé ránṣẹ́ sí oníṣòwò", owner: "", due: "2026-11-20" }],
              followUps: [],
              sections: [{ heading: "Àyípadà", bullets: [] }],
            }),
          },
        },
      ],
    });
  };

  const result = await ai.translateSessionReport({
    language: "yo",
    report: {
      title: "",
      summary: "The room agreed to pause the same-day promise.",
      highlights: ["The bank acknowledged the file late.", "Support carried one settlement problem."],
      decisions: ["Pause the same-day promise."],
      blockers: ["The bank window slipped to 4pm."],
      actions: [{ text: "Send the merchant note", owner: "Ada", due: "2026-11-20" }],
      followUps: [],
      sections: [{ heading: "What changed", bullets: ["Same-day wording went out."] }],
    },
  });

  assert.equal(result.provider, "groq");
  assert.match(calls[0].body.messages[0].content, /another Nigerian language/);
  assert.match(calls[0].body.messages[1].content, /Target language: Yoruba/);
  assert.match(calls[0].body.messages[1].content, /2026-11-20/);
  assert.equal(result.highlights.length, 1);
  assert.equal(result.blockers.length, 2);
  assert.deepEqual(result.actions[0], { text: "Fi ìwé ránṣẹ́ sí oníṣòwò", owner: "", due: "2026-11-20" });
  assert.equal(result.sections[0].heading, "Àyípadà");
});

test("report translation refuses a language it does not carry", async () => {
  await assert.rejects(() => ai.translateSessionReport({ language: "fr", report: {} }), /Choose a language/);
});

test("notes parse fenced JSON, drop empty items and fail over between models", async () => {
  process.env.GROQ_API_KEY = "test-groq";
  const calls = [];

  const payload = {
    title: "Bank window slipped",
    summary: "The bank received the file late, so the promise moved.",
    highlights: ["One", "   ", 7, "Two"],
    blockers: ["The bank window slipped", "", 5],
    actions: [{ text: "Send the merchant note", owner: "", due: "2026-11-20" }, { text: "   " }, null],
    followUps: [
      { to: "Ada", subject: "Merchant note", body: "Send it before four." },
      { to: "", subject: "", body: "No subject" },
      null,
    ],
    sections: [
      { heading: "Decisions", bullets: ["Pause the promise", ""] },
      { heading: "  " },
    ],
  };

  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(url), body });
    if (calls.length === 1) return new Response("rate limited", { status: 429 });
    return Response.json({
      choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`` } }],
    });
  };

  const result = await ai.enhanceSession({
    kind: "meeting",
    title: "Friday payout review",
    scratch: "Ada: merchant note before four",
    transcript: "Speaker 1: The bank acknowledged the file late.",
    tone: "warm-direct",
    participants: ["Ada", "Chinedu"],
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.model, "openai/gpt-oss-120b");
  assert.equal(calls[1].body.model, "openai/gpt-oss-20b");
  assert.equal(calls[1].body.response_format.type, "json_object");
  assert.match(calls[1].body.messages[0].content, /Nigerian Pidgin/);
  assert.match(calls[1].body.messages[0].content, /Leave out greetings, small talk, football/);
  assert.match(calls[1].body.messages[0].content, /sarcasm and understatement/);
  assert.match(calls[1].body.messages[0].content, /write the blocker/);
  assert.match(calls[1].body.messages[0].content, /Use the spellings of the people listed/);
  assert.match(calls[1].body.messages[0].content, /Blockers: what is stopping progress/);
  assert.match(calls[1].body.messages[0].content, /FollowUps: messages the listener still needs to send/);
  assert.match(calls[1].body.messages[0].content, /two or three short paragraphs/);
  assert.match(calls[1].body.messages[0].content, /5 to 10 points/);
  assert.match(calls[1].body.messages[0].content, /3 to 6 sections/);
  assert.match(calls[1].body.messages[0].content, /Never invent names, numbers, decisions, quotes, owners or assignments/);
  assert.equal(calls[1].body.max_tokens, 4000);
  assert.match(calls[1].body.messages[1].content, /People in the room: Ada, Chinedu/);
  assert.match(calls[1].body.messages[1].content, /Today: \d{4}-\d{2}-\d{2}/);
  assert.match(calls[1].body.messages[1].content, /Transcript:\nSpeaker 1: The bank acknowledged/);

  assert.equal(result.provider, "groq");
  assert.equal(result.title, "Bank window slipped");
  assert.deepEqual(result.highlights, ["One", "Two"]);
  assert.deepEqual(result.blockers, ["The bank window slipped"]);
  assert.deepEqual(result.actions, [
    { text: "Send the merchant note", owner: "Unassigned", due: "2026-11-20" },
  ]);
  assert.deepEqual(result.followUps, [
    { to: "Ada", subject: "Merchant note", body: "Send it before four." },
  ]);
  assert.deepEqual(result.sections, [{ heading: "Decisions", bullets: ["Pause the promise"] }]);
});

test("a report always cleans the transcript first, even with a stale skipCleanup flag", async () => {
  process.env.GROQ_API_KEY = "test-groq";
  const calls = [];
  const transcript = [
    "Speaker 1: The bank acknowledged the payout file late on Friday afternoon.",
    "Speaker 2: We agreed to pause the same-day promise until the cutoff holds.",
    "Speaker 1: Ada will send the merchant note before four o'clock today.",
    "Speaker 2: Chinedu will confirm the batch totals with the finance desk.",
    "Speaker 1: Nobody should quote a new payout time until the bank replies.",
    "Speaker 2: The support team will draft a short update for the merchants.",
    "Speaker 1: We will review the window again on Monday morning at nine.",
  ].join("\n");
  const notes = {
    title: "Payout window slipped",
    summary: "The bank received the file late, so the promise paused.",
    highlights: ["The window moved"],
    decisions: [],
    blockers: [],
    actions: [],
    followUps: [],
    sections: [{ heading: "Decisions", bullets: ["Pause the promise"] }],
  };

  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const content =
      body.max_tokens === 3000 ? JSON.stringify({ transcript }) : JSON.stringify(notes);
    return Response.json({ choices: [{ message: { content } }] });
  };

  const result = await ai.enhanceSession({
    kind: "meeting",
    title: "Payout review",
    scratch: "",
    transcript,
    tone: "warm-direct",
    skipCleanup: true,
  });

  assert.equal(result.provider, "groq");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].max_tokens, 3000);
  assert.match(calls[0].messages[0].content, /Only fix punctuation/);
  assert.equal(calls[1].max_tokens, 4000);
  assert.match(calls[1].messages[1].content, /Transcript:\nSpeaker 1: The bank acknowledged/);
});

test("notes try free Groq GPT-OSS first, then OpenRouter's free models", async () => {
  process.env.OPENROUTER_API_KEY = "test-openrouter";
  process.env.GROQ_API_KEY = "test-groq";
  const calls = [];

  const payload = {
    title: "Bank window slipped",
    summary: "The bank received the file late, so the promise moved.",
    highlights: ["The window moved"],
    blockers: [],
    actions: [],
    followUps: [],
    sections: [],
  };

  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(url), model: body.model, headers: init.headers });
    if (String(url).includes("api.groq.com")) return new Response("rate limited", { status: 429 });
    if (body.model === "google/gemma-4-31b-it:free") return new Response("rate limited", { status: 429 });
    return Response.json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
  };

  const result = await ai.enhanceSession({
    kind: "meeting",
    title: "Friday payout review",
    scratch: "",
    transcript: "Speaker 1: The bank acknowledged the file late.",
    tone: "warm-direct",
  });

  assert.equal(result.provider, "openrouter");
  assert.equal(calls.length, 4);
  assert.match(calls[0].url, /api\.groq\.com/);
  assert.equal(calls[0].model, "openai/gpt-oss-120b");
  assert.equal(calls[1].model, "openai/gpt-oss-20b");
  assert.match(calls[2].url, /openrouter\.ai/);
  assert.equal(calls[2].model, "google/gemma-4-31b-it:free");
  assert.equal(calls[3].model, "openrouter/free");
  assert.equal(calls[2].headers.Authorization, "Bearer test-openrouter");
  assert.equal(calls[2].headers["X-Title"], "JotBox");
});

test("JOTBOX_NOTES_PROVIDER pins a paid OpenRouter writer ahead of Groq", async () => {
  process.env.OPENROUTER_API_KEY = "test-openrouter";
  process.env.GROQ_API_KEY = "test-groq";
  process.env.JOTBOX_NOTES_PROVIDER = "openrouter";
  process.env.OPENROUTER_NOTES_MODEL = "openai/gpt-4o";
  const calls = [];

  const payload = {
    title: "Bank window slipped",
    summary: "The bank received the file late, so the promise moved.",
    highlights: ["The window moved"],
    actions: [],
    sections: [],
  };

  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(url), model: body.model });
    return Response.json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
  };

  const result = await ai.enhanceSession({
    kind: "meeting",
    title: "Friday payout review",
    scratch: "",
    transcript: "Speaker 1: The bank acknowledged the file late.",
    tone: "warm-direct",
  });

  assert.equal(ai.aiStatus().notes, "openrouter");
  assert.equal(result.provider, "openrouter");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /openrouter\.ai/);
  assert.equal(calls[0].model, "openai/gpt-4o");
});

test("OpenRouter alone still tries free Gemma before the free router", async () => {
  process.env.OPENROUTER_API_KEY = "test-openrouter";
  const calls = [];

  const payload = {
    title: "Bank window slipped",
    summary: "The bank received the file late, so the promise moved.",
    highlights: ["The window moved"],
    actions: [],
    sections: [],
  };

  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(url), model: body.model });
    if (body.model === "google/gemma-4-31b-it:free") return new Response("rate limited", { status: 429 });
    return Response.json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
  };

  const result = await ai.enhanceSession({
    kind: "meeting",
    title: "Friday payout review",
    scratch: "",
    transcript: "Speaker 1: The bank acknowledged the file late.",
    tone: "warm-direct",
  });

  assert.equal(result.provider, "openrouter");
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /openrouter\.ai/);
  assert.equal(calls[0].model, "google/gemma-4-31b-it:free");
  assert.equal(calls[1].model, "openrouter/free");
});

const briefPrevious = {
  title: "Weekly product sync",
  at: Date.UTC(2026, 10, 9),
  summary: "The room paused the same-day promise until the bank cutoff holds.",
  decisions: ["Pause the same-day promise until the cutoff holds."],
  actions: [
    { text: "Send the merchant note", owner: "Ada", done: false },
    { text: "Update the support macro", owner: "Team", done: true },
  ],
};

test("demo brief puts open actions first and skips finished ones", async () => {
  process.env.JOTBOX_AI_MOCK = "1";

  const result = await ai.buildPreMeetingBrief({
    title: "Weekly product sync",
    kind: "meeting",
    previous: briefPrevious,
  });

  assert.equal(result.provider, "demo");
  assert.deepEqual(result.bullets, [
    "Ada: Send the merchant note",
    "Pause the same-day promise until the cutoff holds.",
  ]);
});

test("brief sends the previous actions and decisions to the model", async () => {
  process.env.GROQ_API_KEY = "test-groq";
  let sent;

  globalThis.fetch = async (_url, init = {}) => {
    sent = JSON.parse(String(init.body));
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({ bullets: ["  Follow up with Ada  ", "   ", "Check the cutoff", "Extra", "More"] }),
          },
        },
      ],
    });
  };

  const result = await ai.buildPreMeetingBrief({
    title: "Weekly product sync",
    kind: "meeting",
    previous: briefPrevious,
  });

  assert.equal(result.provider, "groq");
  assert.deepEqual(result.bullets, ["Follow up with Ada", "Check the cutoff", "Extra"]);
  assert.equal(sent.max_tokens, 420);
  assert.match(sent.messages[0].content, /Never use em dashes/);
  assert.match(sent.messages[0].content, /Do not repeat actions already marked done/);
  assert.match(sent.messages[1].content, /\[open\] Ada: Send the merchant note/);
  assert.match(sent.messages[1].content, /\[done\] Team: Update the support macro/);
  assert.match(sent.messages[1].content, /Pause the same-day promise until the cutoff holds\./);
});

test("brief rejects an answer with no usable bullets", async () => {
  process.env.GROQ_API_KEY = "test-groq";

  globalThis.fetch = async () =>
    Response.json({ choices: [{ message: { content: JSON.stringify({ bullets: ["  ", null, 4] }) } }] });

  await assert.rejects(
    ai.buildPreMeetingBrief({ title: "", kind: "meeting", previous: briefPrevious }),
    /came back empty/,
  );
});

test("brief says plainly when no provider is configured", async () => {
  await assert.rejects(
    ai.buildPreMeetingBrief({ title: "", kind: "meeting", previous: briefPrevious }),
    /cannot answer/,
  );
});

test("a server with no reading or writing service says so plainly", async () => {
  await assert.rejects(
    ai.transcribeAudio({ buffer: Buffer.from("audio"), contentType: "audio/webm", filename: "a.webm" }),
    /cannot read recordings/,
  );
  await assert.rejects(
    ai.enhanceSession({ kind: "meeting", title: "", scratch: "", transcript: "Hello", tone: "warm-direct" }),
    /cannot write notes/,
  );
});

test("speaker naming keeps only roster names with verbatim evidence", async () => {
  process.env.GROQ_API_KEY = "test-groq";
  let sent;

  globalThis.fetch = async (_url, init = {}) => {
    sent = JSON.parse(String(init.body));
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              matches: [
                { speaker: "Speaker 1", name: "Ada", confidence: "high", quote: "My name is Ada" },
                { speaker: "Speaker 1", name: "Chinedu", confidence: "high", quote: "My name is Ada" },
                { speaker: "Speaker 2", name: "Bola", confidence: "high", quote: "Ada, can you send it?" },
                { speaker: "Speaker 9", name: "Chinedu", confidence: "high", quote: "Hello" },
                { speaker: "Speaker 2", name: "Chinedu", confidence: "low", quote: "Ada, can you send it?" },
                { speaker: "Speaker 3", name: "Ada", confidence: "low", quote: "Sure." },
                { speaker: "Speaker 3", name: "Tunde", confidence: "high", quote: "Tunde will handle it" },
              ],
            }),
          },
        },
      ],
    });
  };

  const result = await ai.suggestSpeakerNames({
    title: "Weekly sync",
    kind: "meeting",
    participants: ["Ada", "Chinedu", "Tunde"],
    transcript: [
      { at: 0, speaker: "Speaker 1", text: "My name is Ada and I handle operations." },
      { at: 3, speaker: "Speaker 2", text: "Ada, can you send it?" },
      { at: 6, speaker: "Speaker 2", text: "I will send the file." },
      { at: 9, speaker: "Speaker 3", text: "Sure." },
    ],
  });

  assert.equal(result.provider, "groq");
  assert.deepEqual(result.matches, [
    { speaker: "Speaker 1", name: "Ada", confidence: "high", quote: "My name is Ada" },
    { speaker: "Speaker 2", name: "Chinedu", confidence: "low", quote: "Ada, can you send it?" },
    { speaker: "Speaker 3", name: "Tunde", confidence: "high", quote: "" },
  ]);
  assert.equal(sent.temperature, 0);
  assert.match(sent.messages[0].content, /Use only names from the people list/);
  assert.match(sent.messages[1].content, /People listed for the session: Ada, Chinedu, Tunde/);
  assert.match(sent.messages[1].content, /Speaker 1 \(1 lines\)/);
});

test("speaker naming stays quiet without a roster", async () => {
  process.env.GROQ_API_KEY = "test-groq";

  const result = await ai.suggestSpeakerNames({
    title: "Weekly sync",
    kind: "meeting",
    participants: [],
    transcript: [{ at: 0, speaker: "Speaker 1", text: "Hello there." }],
  });

  assert.deepEqual(result, { matches: [], provider: "none" });
});

test("speaker naming ignores labels that are already names", async () => {
  process.env.GROQ_API_KEY = "test-groq";

  const result = await ai.suggestSpeakerNames({
    title: "Weekly sync",
    kind: "meeting",
    participants: ["Ada"],
    transcript: [{ at: 0, speaker: "Ada", text: "I called the bank." }],
  });

  assert.deepEqual(result, { matches: [], provider: "none" });
});

test("demo speaker naming reads introductions and direct address", async () => {
  process.env.JOTBOX_AI_MOCK = "1";

  const result = await ai.suggestSpeakerNames({
    title: "Weekly sync",
    kind: "meeting",
    participants: ["Ada", "Chinedu"],
    transcript: [
      { at: 0, speaker: "Speaker 1", text: "My name is Ada, I run operations." },
      { at: 5, speaker: "Speaker 1", text: "Chinedu, can you send the file?" },
      { at: 8, speaker: "Speaker 2", text: "I will send it before noon." },
    ],
  });

  assert.equal(result.provider, "demo");
  assert.deepEqual(result.matches, [
    { speaker: "Speaker 1", name: "Ada", confidence: "high", quote: "My name is Ada, I run operations." },
    { speaker: "Speaker 2", name: "Chinedu", confidence: "high", quote: "I will send it before noon." },
  ]);
});
