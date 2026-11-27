import type { BillingMode, Plan } from "./api";

export function limitReachedMessage(
  plan: Plan,
  limitSeconds?: number | null,
  mode?: BillingMode,
): string {
  if (mode === "payg") {
    return "You have used all the minutes in your wallet. Top up to keep listening.";
  }
  if (plan === "enterprise") {
    return "This workspace has used its listening time for this month. Your notes are still saved on this device.";
  }
  if (plan !== "free") {
    const hours = limitSeconds && limitSeconds > 0 ? Math.max(1, Math.round(limitSeconds / 3600)) : 10;
    return `You have used the ${hours} hours included with your plan this month. It resets at the start of next month.`;
  }
  return "Your 100 free listening minutes are finished. Upgrade to keep listening.";
}

export function uploadTooLongMessage(plan: Plan, mode?: BillingMode): string {
  if (mode === "payg") {
    return "That recording is longer than the minutes in your wallet. Top up to keep listening.";
  }
  if (plan === "enterprise") {
    return "That recording is longer than the listening time this workspace has left this month.";
  }
  if (plan !== "free") {
    return "That recording is longer than the listening time you have left this month.";
  }
  return "That recording is longer than the free listening time you have left. Upgrade to keep listening.";
}
