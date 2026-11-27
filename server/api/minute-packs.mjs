/**
 * One-time listening packs.
 *
 * Prices are Naira-native because Paystack charges a Naira amount once. Each
 * pack keeps a margin over the two-pass Scribe cost at the current FX rate, so
 * the list is deliberately shorter and dearer than the cheapest competitor.
 * An operator can override a pack amount without a deploy.
 */

const DEFAULT_NGN_PER_USD = 1400;

export const MINUTE_PACKS = [
  {
    key: "small",
    label: "Small",
    minutes: 100,
    naira: 2500,
    env: "PAYSTACK_PACK_SMALL_AMOUNT_NGN",
  },
  {
    key: "standard",
    label: "Standard",
    minutes: 250,
    naira: 5500,
    env: "PAYSTACK_PACK_STANDARD_AMOUNT_NGN",
  },
  {
    key: "large",
    label: "Large",
    minutes: 600,
    naira: 12000,
    env: "PAYSTACK_PACK_LARGE_AMOUNT_NGN",
  },
  {
    key: "team",
    label: "Team",
    minutes: 1500,
    naira: 27000,
    env: "PAYSTACK_PACK_TEAM_AMOUNT_NGN",
  },
];

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function minutePackList(env = process.env, ngnPerUsd = DEFAULT_NGN_PER_USD) {
  const rate = positiveNumber(ngnPerUsd, DEFAULT_NGN_PER_USD);
  return MINUTE_PACKS.map((pack) => {
    const naira = Math.round(positiveNumber(env[pack.env], pack.naira));
    return {
      key: pack.key,
      label: pack.label,
      minutes: pack.minutes,
      naira,
      amountKobo: naira * 100,
      usd: Math.round(naira / rate),
      perMinuteNaira: Math.round(naira / pack.minutes),
    };
  });
}

export function findMinutePack(key, env = process.env, ngnPerUsd = DEFAULT_NGN_PER_USD) {
  const wanted = String(key || "").trim().toLowerCase();
  return minutePackList(env, ngnPerUsd).find((pack) => pack.key === wanted) ?? null;
}
