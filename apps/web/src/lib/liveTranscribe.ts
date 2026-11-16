import { getFocusMode, knownNames } from "./listening";
import type { Participant, SessionKind } from "./types";

function encodeContext(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function transcribeChunk(
  blob: Blob,
  room: { title: string; kind: SessionKind; participants: Participant[] },
): Promise<string> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch("/api/transcribe?live=1", {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "audio/webm",
        "x-jotbox-stt-context": encodeContext({
          title: room.title,
          kind: room.kind,
          names: knownNames(room.participants),
          focus: getFocusMode(),
        }),
      },
      body: blob,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("live-unavailable");
    const data = (await response.json()) as { text?: unknown };
    return typeof data.text === "string" ? data.text.trim() : "";
  } finally {
    window.clearTimeout(timeout);
  }
}
