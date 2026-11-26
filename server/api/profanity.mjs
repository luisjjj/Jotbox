/**
 * Keep misheard profanity out of the transcript.
 *
 * A reader can turn a cough, a chair scrape or a clipped word into a strong
 * profanity, mostly at the edge of a short live chunk. Live captions are a
 * disposable preview, so they never show the words. The final transcript keeps
 * a profanity only when the reader was confident it heard it, so a real "fuck"
 * survives while a guessed one does not. Providers without word confidence keep
 * the words, because a blind list would censor real speech.
 */

const PROFANITY = new Set([
  "asshole",
  "assholes",
  "arsehole",
  "arseholes",
  "bastard",
  "bastards",
  "bitch",
  "bitches",
  "bitchy",
  "bullshit",
  "cock",
  "cocks",
  "cunt",
  "cunts",
  "dick",
  "dickhead",
  "dickheads",
  "dicks",
  "fuck",
  "fucked",
  "fucker",
  "fuckers",
  "fucking",
  "fucks",
  "horseshit",
  "motherfucker",
  "motherfuckers",
  "motherfucking",
  "pussy",
  "pussies",
  "shit",
  "shits",
  "shitty",
  "slut",
  "sluts",
  "whore",
  "whores",
]);

const DEFAULT_MIN_LOGPROB = -0.35;

function normalizeToken(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}']/gu, "")
    .replace(/^'+|'+$/g, "");
}

export function isProfane(text) {
  const token = normalizeToken(text);
  return Boolean(token) && PROFANITY.has(token);
}

function minLogprob() {
  const raw = process.env.JOTBOX_STT_PROFANITY_LOGPROB;
  if (!raw) return DEFAULT_MIN_LOGPROB;
  const value = Number(raw);
  return Number.isFinite(value) ? value : DEFAULT_MIN_LOGPROB;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tidySpace(text) {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/^[\s,;:.!?]+/, "")
    .replace(/[\s,;:]+$/, "")
    .trim();
}

function removeTokenOnce(text, raw) {
  const core = String(raw ?? "").match(/[\p{L}']+/u)?.[0];
  if (!core) return text;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(core)}(?![\\p{L}\\p{N}])`, "iu");
  if (!pattern.test(text)) return text;
  return tidySpace(text.replace(pattern, ""));
}

function countWords(words) {
  return words.filter((word) => normalizeToken(word?.text)).length;
}

/**
 * @param {{ text?: string, words?: { text?: string, logprob?: number }[] }} transcription
 * @param {{ live?: boolean }} [options]
 */
export function suppressProfanity(transcription, options = {}) {
  const live = options.live === true;
  const words = Array.isArray(transcription?.words) ? transcription.words : [];
  let text = typeof transcription?.text === "string" ? transcription.text : "";
  const heardWords = countWords(words);
  const limit = minLogprob();

  if (!words.length) {
    if (!text) return { text, words };
    const tokens = text.match(/[\p{L}']+/gu) ?? [];
    const profane = tokens.filter((token) => isProfane(token));
    if (!profane.length) return { text, words };
    if (live || tokens.length === profane.length) {
      for (const token of profane) text = removeTokenOnce(text, token);
    }
    return { text, words };
  }

  const kept = [];
  for (const word of words) {
    if (!isProfane(word?.text)) {
      kept.push(word);
      continue;
    }
    let keep = true;
    if (live) {
      keep = false;
    } else {
      const logprob = Number(word?.logprob);
      keep = Number.isFinite(logprob) ? logprob >= limit : heardWords > 1;
    }
    if (keep) {
      kept.push(word);
    } else {
      text = removeTokenOnce(text, word.text);
    }
  }

  return { text: tidySpace(text), words: kept };
}