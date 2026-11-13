import type { Participant, SessionKind, TranscriptLine } from "./types";

export type FocusMode = "off" | "balanced" | "strict";
export type PickupMode = "balanced" | "far";

const FOCUS_KEY = "jotbox-focus-mode";
const PICKUP_KEY = "jotbox-pickup-mode";

export const FOCUS_OPTIONS: { value: FocusMode; label: string; hint: string }[] = [
  {
    value: "off",
    label: "Off",
    hint: "Keep every word that is picked up.",
  },
  {
    value: "balanced",
    label: "Balanced",
    hint: "Leave out clear side talk, such as wifi, lunch, or travel.",
  },
  {
    value: "strict",
    label: "Strict",
    hint: "Also leave out lines that never touch the session title or the people in the room.",
  },
];

export const PICKUP_OPTIONS: { value: PickupMode; label: string; hint: string }[] = [
  {
    value: "balanced",
    label: "Balanced",
    hint: "Turns down room noise and lifts normal speech.",
  },
  {
    value: "far",
    label: "Far voices",
    hint: "Lifts quiet and distant speakers. It can keep more room noise.",
  },
];

export function getFocusMode(): FocusMode {
  if (typeof localStorage === "undefined") return "balanced";
  const stored = localStorage.getItem(FOCUS_KEY);
  return stored === "off" || stored === "strict" ? stored : "balanced";
}

export function setFocusMode(mode: FocusMode) {
  localStorage.setItem(FOCUS_KEY, mode);
}

export function getPickupMode(): PickupMode {
  if (typeof localStorage === "undefined") return "balanced";
  return localStorage.getItem(PICKUP_KEY) === "far" ? "far" : "balanced";
}

export function setPickupMode(mode: PickupMode) {
  localStorage.setItem(PICKUP_KEY, mode);
}

export function pickupConstraints(mode: PickupMode = getPickupMode()): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: mode !== "far",
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 48000,
  };
}

const STOP = new Set(
  "about above after again against all also any are because been before being below between both but can could did does doing down during each few for from further had has have having here how into its itself just more most much must not now off once only other our out over own same should some such than that the their them then there these they this those through under until very was were what when where which while who whom why will with would you your yours meeting seminar lecture voice note session today tomorrow yesterday".split(
    " ",
  ),
);

const ASIDE =
  /\b(?:wi-?fi|internet|password|router|network|charger|battery|air ?con(?:ditioner)?|generator|traffic|parking|lunch|breakfast|dinner|suya|food|coffee|tea|weather|rain|football|match|movie|music|joke|gist|weekend plans)\b/i;

const STRONG =
  /\b(?:decided|agreed|settled|conclusion|decision|action|deadline|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week)|\d[\d,.]*\s*(?:k|m|bn|million|billion|percent|%|naira|dollars?|usd|ngn)?)\b/i;

const NOISE =
  /^(?:\[?(?:music|applause|laughter|silence|noise|background noise|inaudible|crosstalk)\]?|thank you for watching|thanks for watching|please subscribe|subscribe|like and subscribe|you|uh|um|hmm|mm)[.!]?$/i;

export interface FocusContext {
  title: string;
  kind: SessionKind;
  participants: Participant[];
  scratch?: string;
}

export function focusContext(input: FocusContext): FocusContext {
  return {
    title: input.title,
    kind: input.kind,
    participants: input.participants,
    scratch: input.scratch,
  };
}

function tokens(text: string, min = 4) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((word) => word.replace(/^'+|'+$/g, ""))
    .filter((word) => word.length >= min && !STOP.has(word));
}

function words(text: string) {
  return tokens(text, 4);
}

function nameTokens(participants: Participant[]) {
  return participants.flatMap((person) => tokens(person.name, 3));
}

export function focusTerms(context: FocusContext): string[] {
  const title = /^(?:meeting|seminar|lecture|voice note) · /i.test(context.title)
    ? ""
    : context.title;
  const scratch = (context.scratch ?? "")
    .split("\n")
    .filter((line) => !ASIDE.test(line))
    .join(" ");
  return [...new Set([...nameTokens(context.participants), ...words(title), ...words(scratch)])].slice(0, 48);
}

export function isNoiseLine(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return true;
  if (NOISE.test(clean)) return true;
  if (/^[^\p{L}\p{N}]+$/u.test(clean)) return true;
  return /^(\w+)(?:\s+\1){3,}$/i.test(clean);
}

function withoutSpeaker(text: string) {
  return text
    .replace(/^Speaker \d+:\s*/i, "")
    .replace(/^[A-Z][A-Za-z .'-]{1,24}:\s+/, "")
    .trim();
}

export function isOffTopic(text: string, context: FocusContext, mode: FocusMode = getFocusMode()) {
  const clean = withoutSpeaker(text);
  if (!clean) return false;
  if (isNoiseLine(clean)) return true;
  if (mode === "off") return false;

  const terms = focusTerms(context);
  const lineWords = words(clean);
  const overlap = terms.some((term) => lineWords.includes(term));
  const spokenNames = nameTokens(context.participants);
  const named =
    context.participants.some((person) => {
      const name = person.name.trim().toLowerCase();
      return name.length > 2 && clean.toLowerCase().includes(name);
    }) || spokenNames.some((name) => tokens(clean, 3).includes(name));
  const strong = STRONG.test(clean);

  if (ASIDE.test(clean) && !overlap && !named && !strong) return true;

  if (mode === "strict" && terms.length >= 2 && !overlap && !named && !strong && lineWords.length >= 5) {
    return true;
  }

  return false;
}

export function filterLines(
  lines: TranscriptLine[],
  context: FocusContext,
  mode: FocusMode = getFocusMode(),
) {
  const kept: TranscriptLine[] = [];
  let hidden = 0;
  for (const line of lines) {
    if (isOffTopic(line.text, context, mode)) {
      hidden += 1;
      continue;
    }
    kept.push(line);
  }
  return { kept, hidden };
}

export function knownNames(participants: Participant[]) {
  return participants.map((person) => person.name.trim()).filter(Boolean).slice(0, 20);
}