import { afterEach, describe, expect, it, vi } from "vitest";
import { localBrief, previousSessionFor, requestPreMeetingBrief, toBriefPrevious } from "./brief";
import type { Session } from "./types";

function capture(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    title: "Weekly product sync",
    kind: "meeting",
    createdAt: 1_700_000_000_000,
    durationSec: 600,
    status: "ready",
    scratch: "",
    transcript: [],
    notes: {
      source: "studio",
      summary: "The team agreed to pause the same-day promise.",
      highlights: [],
      decisions: ["Pause the same-day promise until the cutoff holds."],
      actions: [
        { id: "a1", text: "Send the merchant note", owner: "Ada", done: false },
        { id: "a2", text: "Re-pull the failed batches", owner: "Chinedu", done: false },
        { id: "a3", text: "Update the support macro", owner: "Team", done: true },
      ],
      sections: [],
    },
    hasAudio: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("previousSessionFor", () => {
  it("matches the newest ready capture with the same kind and title", () => {
    const older = capture({ id: "old", createdAt: 1_700_000_000_000 });
    const newer = capture({ id: "new", createdAt: 1_700_100_000_000 });
    const other = capture({ id: "other", title: "Payout review" });

    expect(previousSessionFor([older, other, newer], { title: "Weekly product sync", kind: "meeting" })?.id).toBe(
      "new",
    );
  });

  it("matches a shorter title and a title with extra words", () => {
    const session = capture({ title: "Weekly product sync" });

    expect(previousSessionFor([session], { title: "Product sync", kind: "meeting" })?.id).toBe("s1");
    expect(previousSessionFor([session], { title: "Product sync for November", kind: "meeting" })?.id).toBe("s1");
  });

  it("does not match an unrelated title or another session kind", () => {
    const session = capture();

    expect(previousSessionFor([session], { title: "Payout review", kind: "meeting" })).toBeNull();
    expect(previousSessionFor([session], { title: "Weekly product sync", kind: "lecture" })).toBeNull();
  });

  it("falls back to the latest ready capture of the same kind when the title is empty", () => {
    const meeting = capture({ id: "meeting", createdAt: 1_700_000_000_000 });
    const lecture = capture({
      id: "lecture",
      kind: "lecture",
      title: "Separation of powers",
      createdAt: 1_700_200_000_000,
    });

    expect(previousSessionFor([meeting, lecture], { title: "", kind: "meeting" })?.id).toBe("meeting");
    expect(previousSessionFor([meeting], { title: "", kind: "voice" })).toBeNull();
  });

  it("ignores captures that are still running or have no notes", () => {
    const live = capture({ id: "live", status: "live" });
    const empty = capture({ id: "empty", notes: null });

    expect(previousSessionFor([live, empty], { title: "", kind: "meeting" })).toBeNull();
  });
});

describe("localBrief", () => {
  it("puts open actions first, prefixes the owner, and skips finished work", () => {
    const bullets = localBrief(toBriefPrevious(capture()));

    expect(bullets).toEqual([
      "Ada: Send the merchant note",
      "Chinedu: Re-pull the failed batches",
      "Pause the same-day promise until the cutoff holds.",
    ]);
  });

  it("falls back to the summary when nothing is open", () => {
    const session = capture();
    session.notes = {
      ...session.notes!,
      decisions: [],
      actions: session.notes!.actions.map((action) => ({ ...action, done: true })),
    };

    expect(localBrief(toBriefPrevious(session))).toEqual(["The team agreed to pause the same-day promise."]);
  });
});

describe("requestPreMeetingBrief", () => {
  const input = { title: "Weekly product sync", kind: "meeting" as const, previous: toBriefPrevious(capture()) };

  it("returns up to three trimmed bullets from the server", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ bullets: ["  First  ", "   ", "Second", "Third", "Fourth"], provider: "groq" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestPreMeetingBrief(input);

    expect(result).toEqual({ bullets: ["First", "Second", "Third"], source: "ai" });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.mode).toBe("brief");
    expect(body.brief.title).toBe("Weekly product sync");
    expect(body.brief.previous.actions).toHaveLength(3);
  });

  it("falls back to the local brief when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream", { status: 502 })));

    const result = await requestPreMeetingBrief(input);

    expect(result.source).toBe("local");
    expect(result.bullets[0]).toBe("Ada: Send the merchant note");
  });

  it("treats an empty answer as a failure and uses the local brief", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ bullets: ["   "] })));

    const result = await requestPreMeetingBrief(input);

    expect(result.source).toBe("local");
    expect(result.bullets).toHaveLength(3);
  });
});
