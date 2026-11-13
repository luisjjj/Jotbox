import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "./types";

const host = vi.hoisted(() => ({
  remote: [] as Session[],
  saved: [] as Session[],
}));

vi.mock("./api", () => ({
  api: {
    listCaptures: async () => host.remote,
    saveCapture: async (session: Session) => {
      host.saved.push(session);
    },
  },
}));

import { pullAndMerge } from "./cloud";
import { useSessions } from "./store";

function capture(overrides: Partial<Session> = {}): Session {
  return {
    id: "0d9f2b7e-3c41-4a8e-9d55-6b1f2a3c4d5e",
    title: "Payout review",
    kind: "meeting",
    createdAt: Date.now() - 20 * 60 * 1000,
    durationSec: 600,
    status: "live",
    scratch: "",
    transcript: [{ id: "t1", text: "We go release am Friday.", at: 30 }],
    notes: null,
    hasAudio: false,
    ...overrides,
  };
}

beforeEach(() => {
  host.remote = [];
  host.saved = [];
  useSessions.setState({ sessions: [], lastKind: "meeting" });
});

describe("pullAndMerge", () => {
  it("closes a live row saved by a tab that is no longer recording", async () => {
    host.remote = [capture()];
    await pullAndMerge();

    const [stored] = useSessions.getState().sessions;
    expect(stored.status).toBe("failed");
    expect(stored.error).toContain("interrupted");
    expect(host.saved).toHaveLength(1);
    expect(host.saved[0].status).toBe("failed");
  });

  it("leaves a live capture alone when this tab is still recording it", async () => {
    const active = capture({ id: "b3fde0c8-6f1a-4d1f-9c8f-0f2f4c6a8b1d" });
    useSessions.setState({ sessions: [active] });
    host.remote = [active];

    await pullAndMerge();

    expect(useSessions.getState().sessions[0].status).toBe("live");
    expect(host.saved).toHaveLength(0);
  });

  it("pulls finished captures without changing them", async () => {
    const ready = capture({ status: "ready", notes: null });
    host.remote = [ready];

    await pullAndMerge();

    expect(useSessions.getState().sessions[0].status).toBe("ready");
    expect(host.saved).toHaveLength(0);
  });
});
