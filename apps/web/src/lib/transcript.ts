import type { SttWord, TranscriptLine } from "./types";

// JotBox only writes Latin-script Nigerian languages. A run in another script
// is a reader hallucination on silence, not room speech.
const FOREIGN_SCRIPT =
  /[\p{Script=Devanagari}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Hebrew}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Arabic}]/gu;
const LATIN_SCRIPT = /\p{Script=Latin}/gu;
const LETTER = /\p{L}/gu;
const DIGIT = /\p{N}/gu;

// Stock lines that speech readers emit over silence and music. Devanagari,
// Han, Hangul and Cyrillic lines are already caught by the script screen.
const FOREIGN_PHRASE =
  /(?:bunu zaten dedin|altyaz[ıi]|abone ol|izledi[ğg]iniz i[çc]in|te[şs]ekk[üu]rler|terima kasih|salamat sa panonood|gracias por ver|merci d'avoir regard|sous-titres|untertitel|vielen dank|danke f[üu]rs|legendas|obrigado por assistir|subt[íi]tulos|grazie per aver|dzi[ęe]kuj[ęe]|bedankt voor het kijken|tack f[öo]r att|h[ãa]y subscribe|c[ảa]m [ơo]n c[áa]c b[ạa]n|amara\.org)/i;

// A whole line wrapped in brackets or parentheses is an audio-event tag.
const BRACKET_ONLY = /^(?:\[[^\]]{0,60}\]|\([^)]{0,60}\)|<[^>]{0,60}>)$/;
const REPEATED_WORD = /^(\p{L}+)(?:\s+\1){3,}$/iu;

// Punctuation that a spoken line can reasonably carry. Anything else counts
// as noise, so symbol salad cannot pass for speech.
const SPEECH_SYMBOLS = new Set(
  ".,!?;:'\"“”‘’()/%$€£₦&-–—".split(""),
);

function count(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0;
}

function unbalancedBrackets(text: string) {
  const pairs: [string, string][] = [
    ["[", "]"],
    ["{", "}"],
    ["(", ")"],
  ];
  return pairs.some(([open, close]) => count(text, new RegExp(`\\${open}`, "g")) !== count(text, new RegExp(`\\${close}`, "g")));
}

export function isJunkLine(input: string): boolean {
  const text = input.replace(/\s+/g, " ").trim();
  if (!text) return true;

  const letters = count(text, LETTER);
  const digits = count(text, DIGIT);
  const foreign = count(text, FOREIGN_SCRIPT);
  const latin = count(text, LATIN_SCRIPT);

  if (foreign > 0 && (foreign >= 2 || latin === 0)) return true;
  if (FOREIGN_PHRASE.test(text)) return true;
  if (BRACKET_ONLY.test(text)) return true;
  if (unbalancedBrackets(text)) return true;
  if (REPEATED_WORD.test(text)) return true;

  let junk = 0;
  for (const char of text) {
    if (/\s/u.test(char) || /[\p{L}\p{N}]/u.test(char) || SPEECH_SYMBOLS.has(char)) continue;
    junk += 1;
  }

  if (!letters) return junk > 0 || digits >= 4;
  if (junk >= 2 && junk / (letters + digits) >= 0.4) return true;
  if (letters < 4 && junk >= 1) return true;
  return false;
}

export function spokenLines(lines: TranscriptLine[] | undefined): TranscriptLine[] {
  return (lines ?? []).filter((line) => !isJunkLine(line.text));
}

export function wordsToLines(words: SttWord[] | undefined, text: string): TranscriptLine[] {
  if (!words?.length) {
    const trimmed = text.trim();
    if (!trimmed || isJunkLine(trimmed)) return [];
    return [{ id: crypto.randomUUID(), text: trimmed, at: 0, speaker: "Speaker 1" }];
  }

  const lines: TranscriptLine[] = [];
  const diarized = words.some((word) => word.speaker !== undefined);
  let buffer: SttWord[] = [];

  const flush = () => {
    if (!buffer.length) return;
    const speaker = buffer[0].speaker;
    const joined = buffer
      .map((word) => word.text)
      .join(" ")
      .replace(/\s+([,.!?;:])/g, "$1")
      .trim();
    if (joined && !isJunkLine(joined)) {
      lines.push({
        id: crypto.randomUUID(),
        text: joined,
        at: buffer[0].start,
        // A reader without diarisation still gets a turn label, so the
        // transcript shows Speaker 1 instead of anonymous blocks.
        speaker: speaker === undefined ? (diarized ? undefined : "Speaker 1") : `Speaker ${speaker + 1}`,
      });
    }
    buffer = [];
  };

  for (const word of words) {
    const previous = buffer[buffer.length - 1];
    const gap = previous ? word.start - previous.end : 0;
    const speakerChanged = previous && word.speaker !== undefined && word.speaker !== previous.speaker;
    const tooLong = buffer.reduce((total, item) => total + item.text.length + 1, 0) > 220;
    if (buffer.length && (speakerChanged || gap > 1.15 || tooLong)) flush();
    buffer.push(word);
  }
  flush();
  return lines;
}

export function linesFromText(text: string): TranscriptLine[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const blocks = trimmed
    .split(/\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  const sentences: string[] = [];
  for (const block of blocks) {
    if (block.length <= 260) {
      sentences.push(block);
      continue;
    }
    const split = block.match(/[^.!?]+[.!?]*/g) ?? [block];
    for (const piece of split) {
      const clean = piece.trim();
      if (!clean) continue;
      if (clean.length > 260) {
        const words = clean.split(/\s+/);
        for (let index = 0; index < words.length; index += 45) {
          sentences.push(words.slice(index, index + 45).join(" "));
        }
      } else {
        sentences.push(clean);
      }
    }
  }

  return sentences.map((line) => ({ id: crypto.randomUUID(), text: line, at: 0 }));
}
