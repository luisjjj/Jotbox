import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

const MANAGED = [
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "WHISPER_BASE_URL",
  "WHISPER_API_KEY",
  "WHISPER_MODEL",
  "GROQ_NOTES_MODEL",
  "GROQ_STT_MODEL",
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
  assert.match(prompt, /Transcribe verbatim in Nigerian Pidgin/);
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
  assert.match(prompt, /Verbatim transcript of a lecture or meeting in Nigerian English/);
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

  process.env.JOTBOX_STT_LANGUAGE = "auto";
  assert.equal(ai.aiStatus().sttLanguage, "auto");
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
    context: { title: "Quarterly earnings review", kind: "meeting", names: ["Ada"], focus: "balanced" },
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

  globalThis.fetch = async () =>
    Response.json({
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

  const result = await ai.transcribeAudio({
    buffer: Buffer.from("audio"),
    contentType: "audio/webm",
    filename: "live.webm",
    live: true,
  });

  assert.equal(result.text, "make we pause the promise");
  assert.equal(result.filtered, 0);
  assert.equal(result.words.length, 5);
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

test("notes parse fenced JSON, drop empty items and fail over between models", async () => {
  process.env.GROQ_API_KEY = "test-groq";
  const calls = [];

  const payload = {
    title: "Bank window slipped",
    summary: "The bank received the file late, so the promise moved.",
    highlights: ["One", "   ", 7, "Two"],
    actions: [{ text: "Send the merchant note", owner: "" }, { text: "   " }, null],
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
  assert.match(calls[1].body.messages[1].content, /People in the room: Ada, Chinedu/);
  assert.match(calls[1].body.messages[1].content, /Transcript:\nSpeaker 1: The bank acknowledged/);

  assert.equal(result.provider, "groq");
  assert.equal(result.title, "Bank window slipped");
  assert.deepEqual(result.highlights, ["One", "Two"]);
  assert.deepEqual(result.actions, [{ text: "Send the merchant note", owner: "Unassigned" }]);
  assert.deepEqual(result.sections, [{ heading: "Decisions", bullets: ["Pause the promise"] }]);
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
