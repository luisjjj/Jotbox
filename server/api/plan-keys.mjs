/**
 * Plan keys shared by billing, quota and routing.
 *
 * Starter and Power are the two new paid tiers. The old `pro` key stays as a
 * grandfathered 20-hour plan so an existing subscriber is never quietly cut to
 * the smaller Starter allowance.
 */

export const FREE_PLAN_KEY = "free";
export const STARTER_PLAN_KEY = "starter";
export const POWER_PLAN_KEY = "power";
export const LEGACY_PRO_PLAN_KEY = "pro";
export const ENTERPRISE_PLAN_KEY = "enterprise";

export const PAID_PLAN_KEYS = [STARTER_PLAN_KEY, POWER_PLAN_KEY, LEGACY_PRO_PLAN_KEY, ENTERPRISE_PLAN_KEY];

export function isPaidPlan(plan) {
  return PAID_PLAN_KEYS.includes(plan);
}

export function isPurchasePlan(plan) {
  return plan === STARTER_PLAN_KEY || plan === POWER_PLAN_KEY;
}
