import type { Session } from "./types";

export const LIVE_LIMIT_MS = 4 * 60 * 60 * 1000;

export const INTERRUPTED_ERROR =
  "This capture was interrupted when the page closed. The spoken words and jottings that survived are still here. Write the notes from them.";

export const EXPIRED_ERROR =
  "This capture stayed open for more than 4 hours, so JotBox ended it. The words that were saved are here. Write the notes from them.";

export function liveExpired(createdAt: number, now = Date.now()) {
  return now - createdAt >= LIVE_LIMIT_MS;
}

/**
 * No capture is still running once the page has reloaded or more than four
 * hours have passed. Returns the closed copy, or null when nothing to do.
 */
export function closeLiveSession(session: Session, now = Date.now()): Session | null {
  if (session.status !== "live") return null;
  return {
    ...session,
    status: "failed",
    error: liveExpired(session.createdAt, now) ? EXPIRED_ERROR : INTERRUPTED_ERROR,
  };
}
