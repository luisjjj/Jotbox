import { api } from "./api";
import { isSample } from "./seed";
import { useSessions } from "./store";

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
 */
export async function pullAndMerge() {
  const remote = await api.listCaptures();
  const remoteIds = new Set(remote.map((session) => session.id));
  const local = syncableSessions();

  await Promise.allSettled(
    local.filter((session) => !remoteIds.has(session.id)).map((session) => api.saveCapture(session)),
  );

  for (const session of remote) {
    useSessions.getState().upsert(session);
  }
}
