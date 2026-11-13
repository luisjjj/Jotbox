import { describe, expect, it } from "vitest";
import { closeLiveSession, EXPIRED_ERROR, INTERRUPTED_ERROR, LIVE_LIMIT_MS, liveExpired } from "./lifecycle";
import type { Session } from "./types";

const now = Date.UTC(2026, 10, 13, 12, 0, 0);

function live(createdAt: number): Session {
  return {
    id: "5f0d1f4c-1b0e-4d3f-9a7a-2f6a9d0c1b2e",
    title: "Friday payout review",
    kind: "meeting",
    createdAt,
    durationSec: 1800,
    status: "live",
    scratch: "",
    transcript: [{ id: "t1", text: "Make we close the payout by Friday.", at: 12 }],
    notes: null,
    hasAudio: false,
  };
}

describe("liveExpired", () => {
  it("keeps a capture under four hours open", () => {
    expect(liveExpired(now - LIVE_LIMIT_MS + 1, now)).toBe(false);
  });

  it("expires a capture at the four-hour mark", () => {
    expect(liveExpired(now - LIVE_LIMIT_MS, now)).toBe(true);
  });
});

describe("closeLiveSession", () => {
  it("closes a capture left behind by a closed page and keeps its words", () => {
    const closed = closeLiveSession(live(now - 30 * 60 * 1000), now);
    expect(closed?.status).toBe("failed");
    expect(closed?.error).toBe(INTERRUPTED_ERROR);
    expect(closed?.transcript).toHaveLength(1);
    expect(closed?.durationSec).toBe(1800);
  });

  it("ends a capture that reached the four-hour limit", () => {
    const closed = closeLiveSession(live(now - LIVE_LIMIT_MS), now);
    expect(closed?.status).toBe("failed");
    expect(closed?.error).toBe(EXPIRED_ERROR);
  });

  it("does not touch captures that already finished", () => {
    const ready = { ...live(now - 5 * 60 * 1000), status: "ready" as const, notes: null };
    expect(closeLiveSession(ready, now)).toBeNull();
  });

  it("keeps the original capture untouched", () => {
    const original = live(now - 10 * 60 * 1000);
    closeLiveSession(original, now);
    expect(original.status).toBe("live");
    expect(original.error).toBeUndefined();
  });
});
