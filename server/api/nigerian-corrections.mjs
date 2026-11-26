import data from "./nigerian-corrections.json" with { type: "json" };

// Only English and Pidgin sessions get these fixes. Yoruba, Hausa and Igbo
// transcripts can contain the same sounds as ordinary words, so they are left
// alone.
const LANGUAGES = new Set(["en", "pcm"]);

const ENTRIES = data.corrections
  .flatMap((entry) =>
    entry.from.map((source) => ({
      to: entry.to,
      source,
      tokens: source.toLowerCase().split(/\s+/).filter(Boolean),
      pattern: new RegExp(
        `(?<![\\p{L}\\p{N}])${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
        "giu",
      ),
    })),
  )
  .sort((left, right) => right.tokens.length - left.tokens.length || right.source.length - left.source.length);

function appliesTo(language) {
  return LANGUAGES.has(String(language || "").toLowerCase());
}

function tokenParts(text) {
  const match = String(text ?? "").match(/^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}]*)$/u);
  return match ? { lead: match[1], core: match[2], trail: match[3] } : { lead: "", core: String(text ?? ""), trail: "" };
}

function tokenKey(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function correctNigerianText(text, language) {
  if (!appliesTo(language)) return text;
  let value = String(text ?? "");
  for (const entry of ENTRIES) {
    value = value.replace(entry.pattern, entry.to);
  }
  return value;
}

export function correctNigerianWords(words, language) {
  if (!appliesTo(language) || !Array.isArray(words) || !words.length) return words;
  const corrected = [];
  let index = 0;
  while (index < words.length) {
    let match = null;
    for (const entry of ENTRIES) {
      const end = index + entry.tokens.length;
      if (end > words.length) continue;
      let found = true;
      for (let offset = 0; offset < entry.tokens.length; offset += 1) {
        if (tokenKey(words[index + offset]?.text) !== entry.tokens[offset]) {
          found = false;
          break;
        }
      }
      if (found) {
        match = { entry, end };
        break;
      }
    }
    if (!match) {
      corrected.push(words[index]);
      index += 1;
      continue;
    }
    const first = words[index];
    const last = words[match.end - 1];
    const lead = tokenParts(first?.text).lead;
    const trail = tokenParts(last?.text).trail;
    corrected.push({
      ...first,
      text: `${lead}${match.entry.to}${trail}`,
      end: Number.isFinite(Number(last?.end)) ? last.end : first.end,
    });
    index = match.end;
  }
  return corrected;
}

export function correctNigerianTranscript(result, language) {
  if (!appliesTo(language) || !result || typeof result !== "object") return result;
  const words = correctNigerianWords(result.words, language);
  return {
    ...result,
    text: typeof result.text === "string" ? correctNigerianText(result.text, language) : result.text,
    words,
  };
}
