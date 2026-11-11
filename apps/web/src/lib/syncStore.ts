import { create } from "zustand";

export type SyncStatus = "off" | "syncing" | "ready" | "error";

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  error: string | null;
  setStatus: (status: SyncStatus) => void;
  setSynced: () => void;
  setError: (message: string) => void;
  reset: () => void;
}

export const useSync = create<SyncState>((set) => ({
  status: "off",
  lastSyncedAt: null,
  error: null,
  setStatus: (status) => set({ status }),
  setSynced: () => set({ status: "ready", lastSyncedAt: Date.now(), error: null }),
  setError: (message) => set({ status: "error", error: message }),
  reset: () => set({ status: "off", lastSyncedAt: null, error: null }),
}));
