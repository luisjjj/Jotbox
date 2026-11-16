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

const STATUS_RANK: Record<Session["status"], number> = {
  live: 0,
  processing: 1,
  failed: 2,
  ready: 2,
};

function remoteHasProgress(local: Session, remote: Session) {
  return STATUS_RANK[remote.status] > STATUS_RANK[local.status];
}

/**
 * Push every local capture. Used before sign-out so the last offline edits
 * reach the account before the local cache is cleared. The caller must know
 * whether anything failed, otherwise sign-out silently drops those edits.
 */
export async function flushCloudSessions() {
  if (suspended) return { failed: [] as Session[], failedDeletes: 0 };
  const state = useSessions.getState();
  const sessions = syncableSessions();
  const deletes = Object.keys(state.removed).filter((id) => !isSample(id));
  const results = await Promise.allSettled([
    ...sessions.map((session) => api.saveCapture(session)),
    ...deletes.map((id) => api.deleteCapture(id)),
  ]);
  const failed = sessions.filter((_, index) => results[index].status === "rejected");
  const failedDeletes = deletes.filter(
    (_, index) => results[sessions.length + index].status === "rejected",
  ).length;
  return { failed, failedDeletes };
}

/**
 * Initial reconciliation:
 * 1. upload local captures the account does not have yet
 * 2. pull the account's captures into the local store, without overwriting
 *    captures that are still pending from this device
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
    const localCopy = localById.get(session.id);
    const state = useSessions.getState();
    if (state.removed[session.id] !== undefined) continue;

    if (localCopy && remoteHasProgress(localCopy, session)) {
      useSessions.getState().applyRemote(session);
      const stamp = useSessions.getState().dirty[session.id];
      if (stamp !== undefined) useSessions.getState().markSynced({ [session.id]: stamp });
      continue;
    }
    if (state.dirty[session.id] !== undefined) continue;

    if (session.status === "live") {
      // this tab is still recording it, so the server copy is behind
      if (localCopy?.status === "live") continue;
      const settled = closeLiveSession(session);
      if (!settled) continue;
      useSessions.getState().applyRemote(settled);
      closed.push(settled);
      continue;
    }
    useSessions.getState().applyRemote(session);
  }

  if (closed.length) {
    await Promise.allSettled(closed.map((session) => api.saveCapture(session)));
  }
}
