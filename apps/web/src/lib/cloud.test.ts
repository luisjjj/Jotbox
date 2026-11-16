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
  useSessions.setState({
    sessions: [],
    lastKind: "meeting",
    ownerId: "test-user",
    dirty: {},
    removed: {},
  });
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

  it("keeps a pending offline edit instead of overwriting it with the server copy", async () => {
    const id = "c3d1a2b4-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    const local = capture({ id, title: "Edited offline", status: "ready" });
    host.remote = [capture({ id, title: "Old server title", status: "ready" })];
    useSessions.setState({
      sessions: [local],
      dirty: { [id]: Date.now() },
    });

    await pullAndMerge();

    const [stored] = useSessions.getState().sessions;
    expect(stored.title).toBe("Edited offline");
    expect(useSessions.getState().dirty[id]).toBeDefined();
  });

  it("does not resurrect a capture deleted on this device", async () => {
    const id = "d4e2b3c5-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
    host.remote = [capture({ id, status: "ready" })];
    useSessions.setState({
      sessions: [],
      removed: { [id]: Date.now() },
    });

    await pullAndMerge();

    expect(useSessions.getState().sessions).toHaveLength(0);
  });

  it("lets a finished server copy replace a still-live local copy", async () => {
    const id = "e5f3c4d6-7a8b-4c9d-0e1f-2a3b4c5d6e7f";
    useSessions.setState({
      sessions: [capture({ id, status: "live" })],
      dirty: { [id]: Date.now() },
    });
    host.remote = [capture({ id, status: "ready", title: "Finished elsewhere" })];

    await pullAndMerge();

    expect(useSessions.getState().sessions[0].title).toBe("Finished elsewhere");
    expect(useSessions.getState().dirty[id]).toBeUndefined();
  });
});
