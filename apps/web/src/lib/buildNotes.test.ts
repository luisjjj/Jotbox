import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { studioAvailable } from "./buildNotes";

function reply(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

beforeEach(() => {
  vi.stubGlobal("window", {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("studioAvailable", () => {
  it("asks the fast health path with caching off", async () => {
    const fetchMock = vi.fn(async () => reply({ ai: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(studioAvailable()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health?fast=1",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("turns studio off only when the server says AI is off", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ai: false })));
    await expect(studioAvailable()).resolves.toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => reply({})));
    await expect(studioAvailable()).resolves.toBe(true);
  });

  it("stays optimistic when the check fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: "down" }, false)));
    await expect(studioAvailable()).resolves.toBe(true);

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    await expect(studioAvailable()).resolves.toBe(true);
  });
});
