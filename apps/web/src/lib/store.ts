import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Session, SessionKind } from "./types";

type Stamps = Record<string, number>;

interface SessionStore {
  sessions: Session[];
  lastKind: SessionKind;
  ownerId: string | null;
  dirty: Stamps;
  removed: Stamps;
  upsert: (session: Session) => void;
  applyRemote: (session: Session) => void;
  patch: (id: string, partial: Partial<Session>) => void;
  remove: (id: string) => void;
  toggleAction: (sessionId: string, actionId: string) => void;
  claimOwner: (ownerId: string) => void;
  markSynced: (entries: Stamps) => void;
  forgetRemoved: (entries: Stamps) => void;
  setLastKind: (kind: SessionKind) => void;
  clear: () => void;
}

function isSample(id: string) {
  return id.startsWith("sample-");
}

function putSession(sessions: Session[], session: Session) {
  const index = sessions.findIndex((item) => item.id === session.id);
  if (index === -1) return [session, ...sessions];
  const next = sessions.slice();
  next[index] = session;
  return next;
}

export const useSessions = create<SessionStore>()(
  persist(
    (set) => ({
      sessions: [],
      lastKind: "meeting",
      ownerId: null,
      dirty: {},
      removed: {},
      upsert: (session) =>
        set((state) => ({
          sessions: putSession(state.sessions, session),
          dirty: isSample(session.id) ? state.dirty : { ...state.dirty, [session.id]: Date.now() },
          removed: isSample(session.id)
            ? state.removed
            : Object.fromEntries(Object.entries(state.removed).filter(([id]) => id !== session.id)),
        })),
      applyRemote: (session) =>
        set((state) => {
          const removed = { ...state.removed };
          delete removed[session.id];
          return { sessions: putSession(state.sessions, session), removed };
        }),
      patch: (id, partial) =>
        set((state) => ({
          sessions: state.sessions.map((session) => (session.id === id ? { ...session, ...partial } : session)),
          dirty: isSample(id) ? state.dirty : { ...state.dirty, [id]: Date.now() },
        })),
      remove: (id) =>
        set((state) => {
          const dirty = { ...state.dirty };
          delete dirty[id];
          return {
            sessions: state.sessions.filter((session) => session.id !== id),
            dirty,
            removed: isSample(id) ? state.removed : { ...state.removed, [id]: Date.now() },
          };
        }),
      toggleAction: (sessionId, actionId) =>
        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== sessionId || !session.notes) return session;
            return {
              ...session,
              notes: {
                ...session.notes,
                actions: session.notes.actions.map((action) =>
                  action.id === actionId ? { ...action, done: !action.done } : action,
                ),
              },
            };
          }),
          dirty: isSample(sessionId) ? state.dirty : { ...state.dirty, [sessionId]: Date.now() },
        })),
      claimOwner: (ownerId) =>
        set((state) => {
          if (state.ownerId === ownerId) return {};
          if (state.ownerId === null) return { ownerId };
          return { ownerId, sessions: [], dirty: {}, removed: {} };
        }),
      markSynced: (entries) =>
        set((state) => {
          const dirty = { ...state.dirty };
          for (const [id, stamp] of Object.entries(entries)) {
            if (dirty[id] !== undefined && dirty[id] <= stamp) delete dirty[id];
          }
          return { dirty };
        }),
      forgetRemoved: (entries) =>
        set((state) => {
          const removed = { ...state.removed };
          for (const [id, stamp] of Object.entries(entries)) {
            if (removed[id] !== undefined && removed[id] <= stamp) delete removed[id];
          }
          return { removed };
        }),
      setLastKind: (kind) => set({ lastKind: kind }),
      clear: () =>
        set((state) => ({ sessions: [], dirty: {}, removed: {}, ownerId: null, lastKind: state.lastKind })),
    }),
    {
      name: "jotbox-sessions",
      version: 2,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<SessionStore>;
        const sessions = Array.isArray(state.sessions) ? state.sessions : [];
        const dirty =
          state.dirty ??
          Object.fromEntries(
            sessions.filter((session) => !isSample(session.id)).map((session) => [session.id, Date.now()]),
          );
        return {
          sessions,
          lastKind: state.lastKind ?? "meeting",
          ownerId: state.ownerId ?? null,
          dirty,
          removed: state.removed ?? {},
        } as SessionStore;
      },
    },
  ),
);

export function pendingSyncCount() {
  const state = useSessions.getState();
  return Object.keys(state.dirty).filter((id) => !isSample(id)).length + Object.keys(state.removed).length;
}

export function sessionOwner() {
  return useSessions.getState().ownerId;
}
