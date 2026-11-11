import { useEffect } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { api } from "@/lib/api";
import { cloudSuspended, pullAndMerge } from "@/lib/cloud";
import { useSessions } from "@/lib/store";
import { useSync } from "@/lib/syncStore";
import type { Session } from "@/lib/types";

function snapshot() {
  return new Map(useSessions.getState().sessions.map((session) => [session.id, JSON.stringify(session)]));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Cloud sync failed.";
}

function isSample(id: string) {
  return id.startsWith("sample-");
}

export function CloudSync() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      useSync.getState().reset();
      return;
    }

    let disposed = false;
    let ready = false;
    let inFlight = false;
    let timer = 0;
    const dirty = new Set<string>();
    const removed = new Set<string>();
    let previous = snapshot();

    const flush = async () => {
      if (disposed || !ready || inFlight || (!dirty.size && !removed.size)) return;
      const ids = [...dirty];
      const gone = [...removed];
      const sessions = useSessions.getState().sessions;
      inFlight = true;
      useSync.getState().setStatus("syncing");
      try {
        await Promise.all([
          ...ids
            .map((id) => sessions.find((session) => session.id === id))
            .filter((session): session is Session => Boolean(session))
            .map((session) => api.saveCapture(session)),
          ...gone.map((id) => api.deleteCapture(id)),
        ]);
        for (const id of ids) dirty.delete(id);
        for (const id of gone) removed.delete(id);
        if (!disposed) useSync.getState().setSynced();
      } catch (error) {
        if (!disposed) {
          useSync.getState().setError(errorMessage(error));
          window.setTimeout(() => {
            if (!disposed) void flush();
          }, 6000);
        }
      } finally {
        inFlight = false;
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void flush(), 800);
    };

    const start = async () => {
      if (disposed) return;
      useSync.getState().setStatus("syncing");
      try {
        await pullAndMerge();
        if (disposed) return;
        ready = true;
        previous = snapshot();
        dirty.clear();
        removed.clear();
        useSync.getState().setSynced();
      } catch (error) {
        if (!disposed) useSync.getState().setError(errorMessage(error));
      }
    };

    const unsubscribe = useSessions.subscribe(() => {
      if (disposed || !ready || cloudSuspended()) return;
      const next = snapshot();
      for (const [id, json] of next) {
        if (isSample(id)) continue;
        if (previous.get(id) !== json) dirty.add(id);
        removed.delete(id);
      }
      for (const id of previous.keys()) {
        if (isSample(id) || next.has(id)) continue;
        dirty.delete(id);
        removed.add(id);
      }
      previous = next;
      if (dirty.size || removed.size) schedule();
    });

    const onRequestSync = async () => {
      if (disposed) return;
      await flush();
      await start();
    };

    void start();
    window.addEventListener("jotbox:sync", onRequestSync);

    return () => {
      disposed = true;
      unsubscribe();
      window.clearTimeout(timer);
      window.removeEventListener("jotbox:sync", onRequestSync);
    };
  }, [user?.id]);

  return null;
}

export function requestCloudSync() {
  window.dispatchEvent(new Event("jotbox:sync"));
}
