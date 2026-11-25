import { LANGUAGE_OPTIONS, type SessionLanguage } from "./listening";
import type { Participant, SessionKind } from "./types";

export type Region = "nigeria" | "international";
export type SessionLength = "short" | "medium" | "long";

export interface OnboardingLine {
  speaker: string;
  text: string;
}

export interface OnboardingDemo {
  title: string;
  kicker: string;
  lines: OnboardingLine[];
  summary: string;
  highlights: string[];
}

const REGION_KEY = "jotbox-region";
const PEOPLE_KEY = "jotbox-onboarding-people";
const KIND_KEY = "jotbox-preferred-kind";
const KIND_PENDING_KEY = "jotbox-preferred-kind-pending";
const HABIT_KEY = "jotbox-record-habit";
const LENGTH_KEY = "jotbox-session-length";

export const HABIT_OPTIONS: { value: SessionKind; label: string; hint: string }[] = [
  { value: "lecture", label: "Lectures", hint: "Class, teaching, revision" },
  { value: "meeting", label: "Meetings", hint: "Work calls, team syncs" },
  { value: "seminar", label: "Talks and panels", hint: "Conferences, workshops" },
  { value: "voice", label: "Voice notes", hint: "Ideas, interviews, yourself" },
];

export const LENGTH_OPTIONS: { value: SessionLength; label: string; hint: string }[] = [
  { value: "short", label: "Under 30 minutes", hint: "Quick calls and voice notes" },
  { value: "medium", label: "30 to 60 minutes", hint: "Most lectures and meetings" },
  { value: "long", label: "Over an hour", hint: "Long lectures and workshops" },
];

const ENGLISH_HINT = "Nigerian English lectures and meetings. Igbo, Yoruba and Hausa words stay as spoken.";
const INTERNATIONAL_ENGLISH_HINT = "English, with names and room words boosted so it spells them your way.";

export const SAMPLE_DEMOS: Record<Region, OnboardingDemo> = {
  nigeria: {
    title: "Payout review",
    kicker: "A small team, talking the way the room talks",
    lines: [
      { speaker: "Ada", text: "Make we no dey promise same-day payout until the bank window dey hold." },
      { speaker: "Chinedu", text: "The file go out on time, na the bank acknowledge am late." },
      { speaker: "You", text: "I go send the merchant note before four. Plain language." },
    ],
    summary:
      'The team is pausing same-day payout promises until the bank window holds. Ada: "I go send the merchant note before four."',
    highlights: [
      "The bank acknowledged the file late, so payout timing is not yet reliable.",
      "Merchants will hear the real cutoff instead of the same-day promise.",
      "Ada sends the merchant note before four.",
    ],
  },
  international: {
    title: "Product sync",
    kicker: "A normal meeting, four decisions and one owner",
    lines: [
      { speaker: "Maya", text: "The export job finished, but the timestamps are still in UTC." },
      { speaker: "Leo", text: "So the CSV is correct and the dashboard is lying to us." },
      { speaker: "You", text: "Let's fix the display before we tell anyone the export shipped." },
    ],
    summary:
      "The export itself is finished. The dashboard shows UTC timestamps, so the numbers look wrong. The team will fix the display before announcing the export.",
    highlights: [
      "The CSV export is correct; the dashboard display is not.",
      "Nobody announces the export until timestamps are fixed.",
      "The display fix comes before any customer note.",
    ],
  },
};

function storage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function getRegion(): Region | null {
  const value = storage()?.getItem(REGION_KEY);
  return value === "international" || value === "nigeria" ? value : null;
}

export function setRegion(region: Region) {
  storage()?.setItem(REGION_KEY, region);
}

// A missing region keeps every language: existing accounts should never lose
// Pidgin or the Nigerian languages just because onboarding has not run.
export function languageOptionsForRegion(region: Region | null = getRegion()) {
  if (region !== "international") return LANGUAGE_OPTIONS;
  return LANGUAGE_OPTIONS.map((option) => ({
    ...option,
    hint: option.value === "en" ? INTERNATIONAL_ENGLISH_HINT : ENGLISH_HINT,
  })).filter((option) => option.value === "en");
}

export function normalizeLanguage(language: SessionLanguage, region: Region | null = getRegion()): SessionLanguage {
  return languageOptionsForRegion(region).some((option) => option.value === language) ? language : "en";
}

export function getSavedPeople(): Participant[] {
  const raw = storage()?.getItem(PEOPLE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is { name: string } => Boolean(item) && typeof item.name === "string")
      .map((item) => ({ id: crypto.randomUUID(), name: item.name.trim(), external: true }))
      .filter((person) => person.name)
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function savedPeopleNames(): string[] {
  return getSavedPeople().map((person) => person.name);
}

export function savePeople(names: string[]): string[] {
  const seen = new Set<string>();
  const clean = names
    .map((name) => name.trim())
    .filter((name) => {
      const key = name.toLowerCase();
      if (!name || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
  storage()?.setItem(PEOPLE_KEY, JSON.stringify(clean.map((name) => ({ name }))));
  return clean;
}

export function getHabit(): SessionKind | null {
  const value = storage()?.getItem(HABIT_KEY);
  return HABIT_OPTIONS.some((option) => option.value === value) ? (value as SessionKind) : null;
}

export function setHabit(habit: SessionKind) {
  storage()?.setItem(HABIT_KEY, habit);
}

export function getSessionLength(): SessionLength | null {
  const value = storage()?.getItem(LENGTH_KEY);
  return LENGTH_OPTIONS.some((option) => option.value === value) ? (value as SessionLength) : null;
}

export function setSessionLength(length: SessionLength) {
  storage()?.setItem(LENGTH_KEY, length);
}

export function setPreferredKind(kind: SessionKind) {
  storage()?.setItem(KIND_KEY, kind);
  storage()?.setItem(KIND_PENDING_KEY, "1");
}

// The first visit to Listen takes the onboarding kind once. After that the
// person's own last choice wins.
export function takePendingKind(): SessionKind | null {
  const store = storage();
  if (!store) return null;
  if (store.getItem(KIND_PENDING_KEY) !== "1") return null;
  store.removeItem(KIND_PENDING_KEY);
  const value = store.getItem(KIND_KEY);
  return HABIT_OPTIONS.some((option) => option.value === value) ? (value as SessionKind) : null;
}

export function freeSessionsEstimate(length: SessionLength | null): string {
  if (length === "short") return "about four short sessions";
  if (length === "long") return "one long session";
  if (length === "medium") return "about two full sessions";
  return "your first sessions";
}
