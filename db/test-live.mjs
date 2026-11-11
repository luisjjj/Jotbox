import pg from "pg";

const BASE = "https://jotbox-eight.vercel.app";
const email = `live.test.${Date.now()}@example.com`;
const password = "correct-horse-battery-staple";
let cookie = "";

async function call(path, { method = "GET", body, origin } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.getSetCookie?.() || [];
  for (const value of setCookie) {
    if (value.startsWith("jotbox_session=") && !value.includes("Max-Age=0")) cookie = value.split(";")[0];
  }
  let json = null;
  try {
    json = await response.json();
  } catch {
    /* no body */
  }
  return { status: response.status, json, setCookie };
}

function report(name, result, expected) {
  const ok = result.status === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} (${result.status})`, result.json ? JSON.stringify(result.json).slice(0, 160) : "");
  if (!ok) process.exitCode = 1;
}

const health = await call("/api/health");
report("health", health, 200);
console.log("  health", JSON.stringify(health.json));

const register = await call("/api/auth/register", { method: "POST", body: { name: "Live Test", email, password } });
report("register", register, 201);
console.log("  cookie flags", register.setCookie[0]?.split(";").slice(1).map((part) => part.trim()).join(" | "));

report("me", await call("/api/auth/me"), 200);
report("cross origin", await call("/api/captures", { method: "POST", origin: "https://evil.example", body: {} }), 403);

const id = crypto.randomUUID();
const session = {
  id,
  title: "Live Vercel + Neon",
  kind: "meeting",
  status: "ready",
  createdAt: Date.now(),
  durationSec: 12,
  scratch: "Live test.",
  transcript: [],
  notes: {
    summary: "Vercel functions are talking to Neon.",
    highlights: ["Production auth works"],
    actions: [],
    sections: [],
    source: "browser",
  },
  hasAudio: false,
};
report("save", await call("/api/captures", { method: "POST", body: { session } }), 200);
const list = await call("/api/captures");
report("list", list, 200);
console.log("  sessions", list.json?.sessions?.length, list.json?.sessions?.[0]?.title);
report("delete", await call(`/api/captures?id=${id}`, { method: "DELETE" }), 204);
report("logout", await call("/api/auth/logout", { method: "POST" }), 204);
report("unauthorized", await call("/api/captures"), 401);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 1,
});
try {
  await pool.query("delete from users where email = $1", [email]);
  console.log("cleanup: live test user removed");
} finally {
  await pool.end();
}
