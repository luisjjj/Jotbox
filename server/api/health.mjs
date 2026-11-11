import { aiStatus } from "./ai.mjs";
import { ping } from "./pg.mjs";
import { requireMethod, sendJson } from "./http.mjs";

export async function handleHealth(req, res) {
  requireMethod(req, ["GET"]);
  let db = false;
  try {
    db = await ping();
  } catch (error) {
    console.error("[jotbox-health]", error.message);
  }
  const ai = aiStatus();
  sendJson(res, 200, {
    ok: true,
    service: "jotbox",
    db,
    ai: ai.ai,
    reading: ai.transcribe,
    writing: ai.notes,
    pidgin: ai.pidgin,
    tone: ai.tone,
  });
}
