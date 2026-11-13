import { api } from "./api";
import { closeLiveSession } from "./lifecycle";
import { isSample } from "./seed";
import { useSessions } from "./store";
import type { Session } from "./types";

let suspended = false;

export function setCloudSuspended(value: boolean) {
  suspended = value;
}

export function cloudSuspended() {
  return suspended;
}

function syncableSessions() {
  return useSessions.getState().sessions.filter((session) => !isSample(session.id));
}

/**
 * Push every local capture. Used before sign-out so the last offline edits
 * reach the account before the local cache is cleared.
 */
export async function flushCloudSessions() {
  if (suspended) return;
  const sessions = syncableSessions();
  await Promise.allSettled(sessions.map((session) => api.saveCapture(session)));
}

/**
 * Initial reconciliation:
 * 1. upload local captures the account does not have yet
 * 2. pull the account's captures into the local store
 * 3. close any live row the server still holds; no recording survives a reload
 */
export async function pullAndMerge() {
  const remote = await api.listCaptures();
  const remoteIds = new Set(remote.map((session) => session.id));
  const local = syncableSessions();
  const localById = new Map(local.map((session) => [session.id, session]));

  await Promise.allSettled(
    local.filter((session) => !remoteIds.has(session.id)).map((session) => api.saveCapture(session)),
  );

  const closed: Session[] = [];
  for (const session of remote) {
    if (session.status === "live") {
      // this tab is still recording it, so the server copy is behind
      if (localById.get(session.id)?.status === "live") continue;
      const settled = closeLiveSession(session);
      if (!settled) continue;
      useSessions.getState().upsert(settled);
      closed.push(settled);
      continue;
    }
    useSessions.getState().upsert(session);
  }

  if (closed.length) {
    await Promise.allSettled(closed.map((session) => api.saveCapture(session)));
  }
}
