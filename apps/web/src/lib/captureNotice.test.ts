import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureNoticeEnabled,
  captureNoticeSupported,
  clearCaptureNotice,
  requestCaptureNotice,
  setCaptureNotice,
  showCaptureNotice,
} from "./captureNotice";

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => store.get(name) ?? null,
    setItem: (name: string, value: string) => store.set(name, value),
  });
  return store;
}

function stubNotification(permission: NotificationPermission, granted: NotificationPermission) {
  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => granted);
  }
  vi.stubGlobal("Notification", FakeNotification);
  return FakeNotification;
}

function stubWorker(worker: { showNotification: ReturnType<typeof vi.fn>; getNotifications: ReturnType<typeof vi.fn> }) {
  vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve(worker) } });
  return worker;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("capture notice", () => {
  it("stays off until the listener turns it on", async () => {
    stubStorage();
    const worker = stubWorker({
      showNotification: vi.fn(async () => undefined),
      getNotifications: vi.fn(async () => []),
    });
    stubNotification("granted", "granted");

    expect(captureNoticeEnabled()).toBe(false);
    await showCaptureNotice("Weekly sync");
    expect(worker.showNotification).not.toHaveBeenCalled();
  });

  it("turns on once the browser grants permission", async () => {
    stubStorage();
    stubWorker({
      showNotification: vi.fn(async () => undefined),
      getNotifications: vi.fn(async () => []),
    });
    const permission = stubNotification("default", "granted");

    expect(await requestCaptureNotice()).toBe(true);
    expect(permission.requestPermission).toHaveBeenCalled();
    expect(captureNoticeEnabled()).toBe(true);
  });

  it("stays off when permission is refused", async () => {
    stubStorage();
    stubWorker({
      showNotification: vi.fn(async () => undefined),
      getNotifications: vi.fn(async () => []),
    });
    stubNotification("default", "denied");

    expect(await requestCaptureNotice()).toBe(false);
    expect(captureNoticeEnabled()).toBe(false);
  });

  it("shows one quiet notice through the service worker and clears it after", async () => {
    stubStorage();
    const note = { close: vi.fn() };
    const worker = stubWorker({
      showNotification: vi.fn(async () => undefined),
      getNotifications: vi.fn(async () => [note]),
    });
    stubNotification("granted", "granted");
    setCaptureNotice(true);

    await showCaptureNotice("Weekly sync");
    expect(worker.showNotification).toHaveBeenCalledWith(
      "JotBox is listening",
      expect.objectContaining({ tag: "jotbox-capture", body: expect.stringContaining("Weekly sync") }),
    );

    await clearCaptureNotice();
    expect(worker.getNotifications).toHaveBeenCalledWith({ tag: "jotbox-capture" });
    expect(note.close).toHaveBeenCalled();
  });

  it("reports unsupported browsers instead of failing at capture time", async () => {
    vi.stubGlobal("Notification", undefined);
    vi.stubGlobal("navigator", {});

    expect(captureNoticeSupported()).toBe(false);
    expect(await requestCaptureNotice()).toBe(false);
    await expect(showCaptureNotice("Weekly sync")).resolves.toBeUndefined();
    await expect(clearCaptureNotice()).resolves.toBeUndefined();
  });
});
