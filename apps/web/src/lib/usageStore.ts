import { create } from "zustand";
import {
  api,
  type BillingMode,
  type BillingPricing,
  type BillingStatus,
  type BillingUsage,
  type BillingWallet,
  type Plan,
} from "./api";

const EMPTY: BillingUsage = {
  unlimited: false,
  usedSeconds: 0,
  limitSeconds: null,
  remainingSeconds: null,
  periodStart: null,
  periodEnd: null,
};

export function isPaidPlan(plan: Plan) {
  return plan !== "free";
}

export function planName(plan: Plan): string {
  if (plan === "starter") return "Starter Pro";
  if (plan === "power") return "Power User";
  if (plan === "pro") return "Pro";
  if (plan === "enterprise") return "Enterprise";
  return "Free";
}

interface UsageState extends BillingUsage {
  loaded: boolean;
  plan: Plan;
  mode: BillingMode;
  wallet: BillingWallet | null;
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
  mode: "free",
  wallet: null,
  configured: false,
  pricing: null,
  applyStatus: (status) =>
    set({
      ...status.usage,
      plan: status.plan,
      mode: status.mode,
      wallet: status.wallet,
      configured: status.configured,
      pricing: status.pricing,
      loaded: true,
    }),
  refresh: async () => {
    const status = await api.billingStatus();
    set({
      ...status.usage,
      plan: status.plan,
      mode: status.mode,
      wallet: status.wallet,
      configured: status.configured,
      pricing: status.pricing,
      loaded: true,
    });
  },
  reset: () =>
    set({
      ...EMPTY,
      loaded: false,
      plan: "free",
      mode: "free",
      wallet: null,
      configured: false,
      pricing: null,
    }),
}));

export function usePro() {
  return useUsage((state) => isPaidPlan(state.plan));
}

export function usePlan() {
  const plan = useUsage((state) => state.plan);
  const loaded = useUsage((state) => state.loaded);
  return { plan, pro: isPaidPlan(plan), loaded };
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

// Returns whether the person is on a paid plan, or null when the plan could not be
// loaded. Callers should only paywall on an explicit false.
export async function ensurePro(): Promise<boolean | null> {
  if (!useUsage.getState().loaded) await refreshUsage();
  const state = useUsage.getState();
  return state.loaded ? isPaidPlan(state.plan) : null;
}
