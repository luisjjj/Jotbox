import { useEffect } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { ApiError, api } from "@/lib/api";
import { cloudSuspended, pullAndMerge } from "@/lib/cloud";
import { pruneExpiredAudio } from "@/lib/retention";
import { isSample } from "@/lib/seed";
import { useSessions } from "@/lib/store";
import { useSync } from "@/lib/syncStore";
import { refreshUsage, useUsage } from "@/lib/usageStore";
import type { Session } from "@/lib/types";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Your notes could not be updated.";
}

function pending(state = useSessions.getState()) {
  return {
    dirty: Object.fromEntries(Object.entries(state.dirty).filter(([id]) => !isSample(id))),
    removed: Object.fromEntries(Object.entries(state.removed).filter(([id]) => !isSample(id))),
  };
}

function hasPending() {
  const { dirty, removed } = pending();
  return Boolean(Object.keys(dirty).length || Object.keys(removed).length);
}

export function CloudSync() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      useSync.getState().reset();
      useUsage.getState().reset();
      void pruneExpiredAudio();
      return;
    }

    useSessions.getState().claimOwner(user.id);

    let disposed = false;
    let ready = false;
    let inFlight = false;
    let timer = 0;
    let retryTimer = 0;
    let retryDelay = 1000;
    let starting = false;

    const schedule = (delay = 800) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void flush(), delay);
    };

    const flush = async () => {
      if (disposed || !ready || inFlight || cloudSuspended()) return;
      const state = useSessions.getState();
      const { dirty, removed } = pending(state);
      const ids = Object.keys(dirty);
      const gone = Object.keys(removed);
      if (!ids.length && !gone.length) return;

      const sessions = state.sessions;
      const saves = ids
        .map((id) => sessions.find((session) => session.id === id))
        .filter((session): session is Session => Boolean(session))
        .map((session) => ({ id: session.id, run: () => api.saveCapture(session) }));
      const deletes = gone.map((id) => ({ id, run: () => api.deleteCapture(id) }));
      const operations = [...saves, ...deletes];
      inFlight = true;
      useSync.getState().setStatus("syncing");
      try {
        const results = await Promise.allSettled(operations.map((operation) => operation.run()));
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
        const syncedDirty: Record<string, number> = {};
        const syncedRemoved: Record<string, number> = {};
        results.forEach((result, index) => {
          if (result.status !== "fulfilled") return;
          const id = operations[index].id;
          if (dirty[id] !== undefined) syncedDirty[id] = dirty[id];
          if (removed[id] !== undefined) syncedRemoved[id] = removed[id];
        });
        const stored = useSessions.getState();
        stored.markSynced(syncedDirty);
        stored.forgetRemoved(syncedRemoved);
        if (disposed) return;
        if (failures.length) {
          useSync.getState().setError(errorMessage(failures[0].reason));
          const limit = failures.some((failure) => failure.reason instanceof ApiError && failure.reason.status === 402);
          // A plan limit will not clear by retrying. The next edit or a plan
          // change asks the server again.
          if (!limit) window.setTimeout(() => void flush(), 6000);
        } else {
          useSync.getState().setSynced();
          if (!useSessions.getState().sessions.some((session) => session.status === "live")) {
            void refreshUsage();
          }
        }
      } catch (error) {
        if (!disposed) {
          useSync.getState().setError(errorMessage(error));
          window.setTimeout(() => void flush(), 6000);
        }
      } finally {
        inFlight = false;
      }
      if (!disposed && hasPending()) schedule(800);
    };

    const start = async () => {
      if (disposed || starting) return;
      starting = true;
      useSync.getState().setStatus("syncing");
      try {
        await pullAndMerge();
        if (disposed) return;
        ready = true;
        retryDelay = 1000;
        useSync.getState().setSynced();
        void refreshUsage();
        schedule(0);
      } catch (error) {
        if (disposed) return;
        useSync.getState().setError(errorMessage(error));
        retryTimer = window.setTimeout(() => void start(), retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      } finally {
        starting = false;
      }
    };

    const unsubscribe = useSessions.subscribe(() => {
      if (disposed || cloudSuspended() || !ready) return;
      if (hasPending()) schedule();
    });

    const onRequestSync = async () => {
      if (disposed) return;
      if (!ready) {
        window.clearTimeout(retryTimer);
        await start();
        return;
      }
      await flush();
    };

    const onOnline = () => {
      if (disposed) return;
      if (!ready) {
        window.clearTimeout(retryTimer);
        retryDelay = 1000;
        void start();
      } else if (hasPending()) {
        schedule(0);
      }
    };

    void start().then(() => {
      if (!disposed) void pruneExpiredAudio();
    });
    window.addEventListener("jotbox:sync", onRequestSync);
    window.addEventListener("online", onOnline);

    return () => {
      disposed = true;
      unsubscribe();
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
      window.removeEventListener("jotbox:sync", onRequestSync);
      window.removeEventListener("online", onOnline);
    };
  }, [user?.id]);

  return null;
}

export function requestCloudSync() {
  window.dispatchEvent(new Event("jotbox:sync"));
}
