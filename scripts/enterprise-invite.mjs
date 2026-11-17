import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { query, getPool } from "../server/api/pg.mjs";
import { appUrlFor, emailConfigured, sendEnterpriseInviteEmail } from "../server/api/email.mjs";

/**
 * Issue, email, list, or revoke the private enterprise onboarding link.
 *
 * Usage:
 *   npm run enterprise:invite -- --company "Acme" --email cto@acme.com --name "Ada" --seats 20
 *   npm run enterprise:invite -- --list
 *   npm run enterprise:invite -- --revoke <invite-id>
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const DEFAULT_DAYS = 30;
const DEFAULT_SEATS = 5;
const DEFAULT_PRICE_USD = 25;

function loadEnv() {
  if (process.env.DATABASE_URL) return;
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

function usage() {
  console.log(`Issue a private enterprise onboarding link.

  npm run enterprise:invite -- --company "Acme" --email cto@acme.com [--name "Ada"] [--seats 20] [--notes "..."] [--days 30] [--no-email]

  --list                 Show recent invites
  --revoke <invite-id>   Turn an invite link off
  --no-email             Print the link only; do not email it
`);
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function tokenHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function formatWhen(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function listInvites() {
  const result = await query(
    `select id, company, contact_email, seats, created_at, expires_at, accepted_at, revoked_at
       from enterprise_invites
      order by created_at desc
      limit 25`,
  );
  if (!result.rows.length) {
    console.log("No enterprise invites yet.");
    return;
  }
  for (const row of result.rows) {
    const state = row.revoked_at
      ? "revoked"
      : row.accepted_at
        ? "accepted"
        : new Date(row.expires_at).getTime() < Date.now()
          ? "expired"
          : "open";
    console.log(
      `${row.id}  ${state.padEnd(8)}  ${row.company}  <${row.contact_email}>  ${row.seats} seats  expires ${formatWhen(row.expires_at)}`,
    );
  }
}

async function revoke(id) {
  const result = await query(
    "update enterprise_invites set revoked_at = now() where id = $1 and revoked_at is null returning company, contact_email",
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    console.error(`No open invite with id ${id}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Revoked the onboarding link for ${row.company} <${row.contact_email}>.`);
}

async function createInvite(args) {
  const company = String(args.company === true ? "" : args.company || "").trim();
  const email = normalizeEmail(args.email);
  const name = String(args.name === true ? "" : args.name || "").trim();
  const notes = String(args.notes === true ? "" : args.notes || "").trim();
  const seats = Number(args.seats ?? DEFAULT_SEATS);
  const days = Number(args.days ?? DEFAULT_DAYS);

  if (!company) {
    console.error("Missing --company.");
    usage();
    process.exitCode = 1;
    return;
  }
  if (!email) {
    console.error("Missing or invalid --email.");
    usage();
    process.exitCode = 1;
    return;
  }
  if (!Number.isInteger(seats) || seats < 5 || seats > 10_000) {
    console.error("--seats must be a whole number between 5 and 10000.");
    process.exitCode = 1;
    return;
  }
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    console.error("--days must be a whole number between 1 and 365.");
    process.exitCode = 1;
    return;
  }

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const inserted = await query(
    `insert into enterprise_invites
       (token_hash, company, contact_email, contact_name, seats, price_usd, notes, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, now() + ($8::int * interval '1 day'))
     returning id, expires_at`,
    [tokenHash(rawToken), company, email, name, seats, DEFAULT_PRICE_USD, notes, days],
  );
  const row = inserted.rows[0];
  const link = appUrlFor(`/enterprise/onboarding/${rawToken}`);

  console.log("");
  console.log(`Enterprise invite for ${company}`);
  console.log(`  id:      ${row.id}`);
  console.log(`  contact: ${email}`);
  console.log(`  seats:   ${seats} at $${DEFAULT_PRICE_USD} per seat each month`);
  console.log(`  expires: ${formatWhen(row.expires_at)}`);
  console.log("");
  console.log("Onboarding link (send only to the agreed contact):");
  console.log(`  ${link}`);
  console.log("");

  if (args["no-email"]) {
    console.log("Email skipped (--no-email).");
    return;
  }
  if (!emailConfigured()) {
    console.log("Email is not configured yet, so the link was only printed. Add SENDLY_API_KEY to send invites automatically.");
    return;
  }
  const sent = await sendEnterpriseInviteEmail({
    to: email,
    company,
    contactName: name,
    link,
    seats,
    priceUsd: DEFAULT_PRICE_USD,
    expiresAt: row.expires_at,
  });
  console.log(sent.delivered ? `Invite emailed to ${email}.` : "Email was not delivered. Check the server log and send the link above by hand.");
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Add it to .env first.");
    process.exitCode = 1;
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }
  if (args.list) {
    await listInvites();
    return;
  }
  if (args.revoke) {
    if (args.revoke === true) {
      console.error("Add the invite id after --revoke.");
      process.exitCode = 1;
      return;
    }
    await revoke(String(args.revoke));
    return;
  }
  await createInvite(args);
}

try {
  await main();
} catch (error) {
  console.error("Enterprise invite failed:", error.message);
  process.exitCode = 1;
} finally {
  if (process.env.DATABASE_URL) await getPool().end().catch(() => {});
}
