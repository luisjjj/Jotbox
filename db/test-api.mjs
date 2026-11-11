import pg from "pg";

const BASE = "http://localhost:3100";
const email = `api.test.${Date.now()}@example.com`;
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
    redirect: "manual",
  });
  const setCookie = response.headers.getSetCookie?.() || [];
  for (const value of setCookie) {
    if (value.startsWith("jotbox_session=") && !value.includes("Max-Age=0")) {
      cookie = value.split(";")[0];
    }
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
  console.log(`${ok ? "PASS" : "FAIL"} ${name} (${result.status})`, result.json ? JSON.stringify(result.json).slice(0, 180) : "");
  if (!ok) process.exitCode = 1;
}

const health = await call("/api/health");
report("health", health, 200);
console.log("  health", JSON.stringify(health.json));

report("register", await call("/api/auth/register", { method: "POST", body: { name: "API Test", email, password } }), 201);
report("duplicate register", await call("/api/auth/register", { method: "POST", body: { name: "API Test", email, password } }), 409);
report("me", await call("/api/auth/me"), 200);
report("bad password", await call("/api/auth/login", { method: "POST", body: { email, password: "wrong-password" } }), 401);
report("cross origin", await call("/api/captures", { method: "POST", origin: "https://evil.example", body: { session: {} } }), 403);

const id = crypto.randomUUID();
const session = {
  id,
  title: "API sync test",
  kind: "meeting",
  status: "ready",
  createdAt: Date.now(),
  durationSec: 42,
  scratch: "Ada: test line",
  transcript: [{ id: "l1", text: "The database is connected.", at: 1.2 }],
  notes: {
    summary: "Sync works.",
    highlights: ["Neon is connected"],
    actions: [{ id: "a1", text: "Ship it", owner: "You", done: false }],
    sections: [{ heading: "Next", bullets: ["Push to Vercel"] }],
    source: "browser",
  },
  hasAudio: false,
};
report("save capture", await call("/api/captures", { method: "POST", body: { session } }), 200);
const list = await call("/api/captures");
report("list captures", list, 200);
console.log("  sessions", list.json?.sessions?.length, list.json?.sessions?.[0]?.title);
report("delete capture", await call(`/api/captures?id=${id}`, { method: "DELETE" }), 204);
report("logout", await call("/api/auth/logout", { method: "POST" }), 204);
report("unauthorized captures", await call("/api/captures"), 401);
cookie = "";
report("login", await call("/api/auth/login", { method: "POST", body: { email, password } }), 200);
report("me after login", await call("/api/auth/me"), 200);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});
try {
  await pool.query("delete from users where email = $1", [email]);
  console.log("cleanup: test user removed");
} finally {
  await pool.end();
}
