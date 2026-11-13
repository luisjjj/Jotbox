import { create } from "zustand";
import { api, type BillingUsage } from "./api";

const EMPTY: BillingUsage = {
  unlimited: false,
  usedSeconds: 0,
  limitSeconds: null,
  remainingSeconds: null,
  periodStart: null,
  periodEnd: null,
};

interface UsageState extends BillingUsage {
  loaded: boolean;
  apply: (usage: BillingUsage) => void;
  refresh: () => Promise<void>;
  reset: () => void;
}

export const useUsage = create<UsageState>()((set) => ({
  ...EMPTY,
  loaded: false,
  apply: (usage) => set({ ...usage, loaded: true }),
  refresh: async () => {
    const status = await api.billingStatus();
    set({ ...status.usage, loaded: true });
  },
  reset: () => set({ ...EMPTY, loaded: false }),
}));

export async function refreshUsage() {
  try {
    await useUsage.getState().refresh();
  } catch {
    // Offline use still works. The server checks the limit when a capture is saved.
  }
}

export async function ensureUsage() {
  await refreshUsage();
  return useUsage.getState();
}
