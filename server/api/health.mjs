import { ping } from "./pg.mjs";
import { requireMethod, sendJson } from "./http.mjs";

export async function handleHealth(req, res, { ai = false } = {}) {
  requireMethod(req, ["GET"]);
  let db = false;
  try {
    db = await ping();
  } catch (error) {
    console.error("[jotbox-health]", error.message);
  }
  sendJson(res, 200, {
    ok: true,
    service: "jotbox",
    db,
    ai: Boolean(ai),
  });
}
