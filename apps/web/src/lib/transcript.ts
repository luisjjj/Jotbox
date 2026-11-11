import type { SttWord, TranscriptLine } from "./types";

export function wordsToLines(words: SttWord[] | undefined, text: string): TranscriptLine[] {
  if (!words?.length) {
    const trimmed = text.trim();
    if (!trimmed) return [];
    return [{ id: crypto.randomUUID(), text: trimmed, at: 0 }];
  }

  const lines: TranscriptLine[] = [];
  let buffer: SttWord[] = [];

  const flush = () => {
    if (!buffer.length) return;
    const speaker = buffer[0].speaker;
    const joined = buffer
      .map((word) => word.text)
      .join(" ")
      .replace(/\s+([,.!?;:])/g, "$1")
      .trim();
    if (joined) {
      lines.push({
        id: crypto.randomUUID(),
        text: joined,
        at: buffer[0].start,
        speaker: speaker === undefined ? undefined : `Speaker ${speaker + 1}`,
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
