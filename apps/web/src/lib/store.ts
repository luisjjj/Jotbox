import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Session, SessionKind } from "./types";

interface SessionStore {
  sessions: Session[];
  lastKind: SessionKind;
  upsert: (session: Session) => void;
  patch: (id: string, partial: Partial<Session>) => void;
  remove: (id: string) => void;
  toggleAction: (sessionId: string, actionId: string) => void;
  setLastKind: (kind: SessionKind) => void;
  clear: () => void;
}

export const useSessions = create<SessionStore>()(
  persist(
    (set) => ({
      sessions: [],
      lastKind: "meeting",
      upsert: (session) =>
        set((state) => {
          const index = state.sessions.findIndex((item) => item.id === session.id);
          if (index === -1) return { sessions: [session, ...state.sessions] };
          const next = state.sessions.slice();
          next[index] = session;
          return { sessions: next };
        }),
      patch: (id, partial) =>
        set((state) => ({
          sessions: state.sessions.map((session) => (session.id === id ? { ...session, ...partial } : session)),
        })),
      remove: (id) => set((state) => ({ sessions: state.sessions.filter((session) => session.id !== id) })),
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
        })),
      setLastKind: (kind) => set({ lastKind: kind }),
      clear: () => set({ sessions: [] }),
    }),
    { name: "jotbox-sessions", version: 1 },
  ),
);
