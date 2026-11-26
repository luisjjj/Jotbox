import { aiStatus } from "./ai.mjs";
import { emailConfigured } from "./email.mjs";
import { ping } from "./pg.mjs";
import { storageConfigured } from "./storage.mjs";
import { requireMethod, sendJson } from "./http.mjs";

export async function handleHealth(req, res) {
  requireMethod(req, ["GET"]);
  // The app asks for ?fast=1 so a slow database check cannot delay the AI
  // status and make a configured deployment look turned off.
  const fast = new URL(req.url || "/", "http://localhost").searchParams.get("fast") === "1";
  let db = null;
  if (!fast) {
    db = false;
    try {
      db = await ping();
    } catch (error) {
      console.error("[jotbox-health]", error.message);
    }
  }
  const ai = aiStatus();
  sendJson(res, 200, {
    ok: true,
    service: "jotbox",
    db,
    email: emailConfigured(),
    storage: storageConfigured(),
    ai: ai.ai,
    reading: ai.transcribe,
    writing: ai.notes,
    pidgin: ai.pidgin,
    languages: ai.sttLanguages,
    tone: ai.tone,
  });
}
