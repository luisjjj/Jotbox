const NOTICE_KEY = "jotbox-capture-notice";
const TAG = "jotbox-capture";

export function captureNoticeSupported() {
  return typeof Notification !== "undefined" && "serviceWorker" in navigator;
}

export function captureNoticeEnabled() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(NOTICE_KEY) === "on";
}

export function setCaptureNotice(on: boolean) {
  localStorage.setItem(NOTICE_KEY, on ? "on" : "off");
  if (!on) void clearCaptureNotice();
}

export async function requestCaptureNotice() {
  if (!captureNoticeSupported()) return false;
  try {
    const permission =
      Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") return false;
  } catch {
    return false;
  }
  setCaptureNotice(true);
  return true;
}

async function registration() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function showCaptureNotice(title: string) {
  if (!captureNoticeSupported() || !captureNoticeEnabled()) return;
  if (Notification.permission !== "granted") return;
  try {
    const worker = await registration();
    if (!worker) return;
    await worker.showNotification("JotBox is listening", {
      body: `${title} · keep JotBox open so the words keep coming`,
      tag: TAG,
      silent: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
    });
  } catch {
    // The notice is a convenience; a failed one never blocks the capture.
  }
}

export async function clearCaptureNotice() {
  try {
    const worker = await registration();
    if (!worker) return;
    const notes = await worker.getNotifications({ tag: TAG });
    notes.forEach((note) => note.close());
  } catch {
    // Nothing to clear.
  }
}
