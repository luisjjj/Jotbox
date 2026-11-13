import { deleteAudio } from "./audioStore";
import { useSessions } from "./store";
import type { Session } from "./types";

export type AudioRetention = 0 | 7 | 30 | 90;

const KEY = "jotbox-audio-retention";
const DAY = 24 * 60 * 60 * 1000;

export const RETENTION_OPTIONS: { value: AudioRetention; label: string }[] = [
  { value: 0, label: "Keep until I delete it" },
  { value: 7, label: "Delete after 7 days" },
  { value: 30, label: "Delete after 30 days" },
  { value: 90, label: "Delete after 90 days" },
];

export function getAudioRetention(): AudioRetention {
  const stored = Number(localStorage.getItem(KEY));
  return stored === 7 || stored === 30 || stored === 90 ? stored : 0;
}

export function setAudioRetention(days: AudioRetention) {
  localStorage.setItem(KEY, String(days));
}

export function expiredAudio(sessions: Session[], days: AudioRetention, now = Date.now()) {
  if (!days) return [];
  return sessions.filter(
    (session) =>
      session.hasAudio && session.status !== "live" && now - session.createdAt >= days * DAY,
  );
}

export async function pruneExpiredAudio(now = Date.now()) {
  const days = getAudioRetention();
  if (!days) return 0;
  const expired = expiredAudio(useSessions.getState().sessions, days, now);
  if (!expired.length) return 0;

  await Promise.allSettled(expired.map((session) => deleteAudio(session.id)));
  const store = useSessions.getState();
  for (const session of expired) store.patch(session.id, { hasAudio: false });
  return expired.length;
}
