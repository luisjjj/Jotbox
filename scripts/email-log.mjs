import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Recent Sendly API messages, newest first. Read only.
 *
 *   npm run email:log
 *   npm run email:log -- --limit 50
 *   npm run email:log -- --status bounced
 *   npm run email:log -- --json
 */

const SENDLY_API = "https://api.sendlyai.com/v1/messages";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function loadEnv() {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^['"]|['"]$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const body = item.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      args[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[body] = true;
      continue;
    }
    args[body] = next;
    index += 1;
  }
  return args;
}

function stamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function main() {
  loadEnv();
  if (!process.env.SENDLY_API_KEY?.trim()) {
    console.error("SENDLY_API_KEY is not set. Add it to .env first.");
    process.exitCode = 1;
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
  const status = typeof args.status === "string" ? args.status.trim().toLowerCase() : "";

  const url = new URL(SENDLY_API);
  url.searchParams.set("limit", String(limit));
  if (status) url.searchParams.set("status", status);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.SENDLY_API_KEY.trim()}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    console.error(`Sendly refused the request (${response.status}). ${body?.message || body?.error || ""}`.trim());
    process.exitCode = 1;
    return;
  }

  const messages = Array.isArray(body?.data) ? body.data : [];
  if (args.json) {
    console.log(JSON.stringify(messages, null, 2));
    return;
  }
  if (!messages.length) {
    console.log("No messages match.");
    return;
  }

  console.log("");
  console.log(`Last ${messages.length} message${messages.length === 1 ? "" : "s"} from Sendly:`);
  console.log("");
  for (const message of messages) {
    const to = Array.isArray(message.to) ? message.to.join(", ") : message.to || "unknown";
    const opens = Number(message.opens) || 0;
    const clicks = Number(message.clicks) || 0;
    console.log(
      `${stamp(message.createdAt)}  ${String(message.status || "unknown").padEnd(10)}  ${to}`,
    );
    console.log(`  ${message.subject || "(no subject)"}`);
    console.log(
      `  id ${message.id || "unknown"}  opens ${opens}  clicks ${clicks}` +
        (message.error ? `  error ${message.error}` : ""),
    );
    console.log("");
  }
}

try {
  await main();
} catch (error) {
  console.error("Email log failed:", error.message);
  process.exitCode = 1;
}
