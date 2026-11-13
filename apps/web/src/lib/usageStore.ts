import { create } from "zustand";
import { api, type BillingPricing, type BillingStatus, type BillingUsage } from "./api";

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
  plan: "free" | "pro";
  configured: boolean;
  pricing: BillingPricing | null;
  applyStatus: (status: BillingStatus) => void;
  refresh: () => Promise<void>;
  reset: () => void;
}

export const useUsage = create<UsageState>()((set) => ({
  ...EMPTY,
  loaded: false,
  plan: "free",
  configured: false,
  pricing: null,
  applyStatus: (status) =>
    set({
      ...status.usage,
      plan: status.plan,
      configured: status.configured,
      pricing: status.pricing,
      loaded: true,
    }),
  refresh: async () => {
    const status = await api.billingStatus();
    set({
      ...status.usage,
      plan: status.plan,
      configured: status.configured,
      pricing: status.pricing,
      loaded: true,
    });
  },
  reset: () => set({ ...EMPTY, loaded: false, plan: "free", configured: false, pricing: null }),
}));

export function usePro() {
  return useUsage((state) => state.plan === "pro");
}

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
