import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query, getPool } from "../server/api/pg.mjs";
import { sendFounderNoteEmail } from "../server/api/email.mjs";

/**
 * Founder check-ins. Preview is the default; nothing leaves the server until
 * --send is passed. Each account is claimed in founder_outreach before the
 * email goes out, so a rerun cannot mail the same person twice.
 *
 * Usage:
 *   npm run founder:mail -- --preview
 *   npm run founder:mail -- --send --limit 20
 *   npm run founder:mail -- --send --to you@example.com
 *   npm run founder:mail -- --send --min-sessions 2 --call-url https://cal.com/you
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const MAX_BATCH = 50;
const DEFAULT_BATCH = 20;

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

function usage() {
  console.log(`Founder check-in email. Preview is the default.

  npm run founder:mail -- --preview [--min-sessions 1] [--role learner] [--since 2026-01-01]
  npm run founder:mail -- --send [--limit 20] [--min-sessions 1] [--role learner]
  npm run founder:mail -- --send --to you@example.com

  Options:
    --call-url <url>       Booking link for calls. Without it the email asks for a reply.
    --reply-to <email>     Where replies go. Defaults to FOUNDER_EMAIL or EMAIL_FROM.
    --exclude <email>      Skip one address. FOUNDER_EMAIL is always skipped.
    --founder-name <name>  Signature name. Defaults to FOUNDER_NAME, or just "Founder, JotBox".
    --min-sessions <n>     Only people with at least this many sessions. Default 1.
    --since <date>         Only accounts created on or after this date.
    --role <role>          Only one dashboard role (learner, professional, ...).
    --limit <n>            Maximum sends for this run. Default ${DEFAULT_BATCH}, capped at ${MAX_BATCH}.
    --to <email>           Send one test message and skip the database entirely.

  Sends go out as JotBox <hello@jotbox.online>; set EMAIL_FROM to change it.
`);
}

function text(value, fallback = "") {
  return String(value === true || value === undefined ? "" : value || "").trim() || fallback;
}

function maskEmail(value) {
  const email = String(value || "").trim();
  const at = email.indexOf("@");
  if (at <= 0) return "hidden";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

function dateArg(value) {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function replyToFor(args) {
  return (
    text(args["reply-to"]) ||
    process.env.FOUNDER_EMAIL?.trim() ||
    process.env.EMAIL_FROM?.trim() ||
    "hello@jotbox.online"
  );
}

function founderSignature(args) {
  return text(args["founder-name"]) || process.env.FOUNDER_NAME?.trim() || "";
}

async function audience(args) {
  const limit = Math.max(1, Math.min(MAX_BATCH, Number(args.limit) || DEFAULT_BATCH));
  const minSessions = Math.max(0, Math.min(1000, Number(args["min-sessions"] ?? 1) || 0));
  const role = text(args.role) || null;
  const since = dateArg(args.since);
  if (text(args.since) && !since) throw new Error("--since is not a valid date. Use YYYY-MM-DD.");
  const exclude = text(args.exclude) || process.env.FOUNDER_EMAIL?.trim() || null;
  const callUrl = text(args["call-url"]);

  const result = await query(
    `select u.id, u.email, u.name, u.dashboard_role,
            count(c.id)::int as sessions
       from users u
       join captures c on c.user_id = u.id
       left join founder_outreach f on f.user_id = u.id
      where f.user_id is null
        and ($1::text is null or u.dashboard_role = $1)
        and ($2::timestamptz is null or u.created_at >= $2::timestamptz)
        and ($3::text is null or lower(u.email) <> lower($3))
        and u.email <> 'hello@jotbox.online'
        and lower(u.email) not like '%@example.com'
        and lower(u.email) not like '%@example.net'
        and lower(u.email) not like '%@example.org'
        and lower(u.email) not like '%@jotbox.test'
      group by u.id
     having count(c.id) >= $4
      order by count(c.id) desc, u.created_at asc
      limit $5`,
    [role, since, exclude, minSessions, limit],
  );

  const total = await query(
    `select count(*)::int as count
       from (
         select u.id
           from users u
           join captures c on c.user_id = u.id
           left join founder_outreach f on f.user_id = u.id
          where f.user_id is null
            and ($1::text is null or u.dashboard_role = $1)
            and ($2::timestamptz is null or u.created_at >= $2::timestamptz)
            and ($3::text is null or lower(u.email) <> lower($3))
            and u.email <> 'hello@jotbox.online'
            and lower(u.email) not like '%@example.com'
            and lower(u.email) not like '%@example.net'
            and lower(u.email) not like '%@example.org'
            and lower(u.email) not like '%@jotbox.test'
          group by u.id
         having count(c.id) >= $4
       ) people`,
    [role, since, exclude, minSessions],
  );

  return { rows: result.rows, total: total.rows[0]?.count ?? result.rows.length, callUrl, limit };
}

async function preview(args) {
  const { rows, total, callUrl, limit } = await audience(args);
  console.log("");
  console.log(`Would email ${total} account${total === 1 ? "" : "s"} (this run shows up to ${limit}).`);
  if (!rows.length) {
    console.log("No one matches yet. Nobody has finished a session, or they were already contacted.");
    console.log("");
    return;
  }
  console.log("");
  for (const row of rows) {
    console.log(
      `  ${String(row.sessions).padStart(3)} session${row.sessions === 1 ? " " : "s"}  ` +
        `${maskEmail(row.email).padEnd(28)} ${row.name || ""}${row.dashboard_role ? `  (${row.dashboard_role})` : ""}`,
    );
  }
  console.log("");
  console.log("Sample copy:");
  console.log(
    `  Hi ${(rows[0].name || "there").split(/\s+/)[0]},\n\n  I saw that you have used JotBox for ${rows[0].sessions} session${rows[0].sessions === 1 ? "" : "s"}, and I wanted to say thank you personally.`,
  );
  if (callUrl) console.log(`\n  If it is easier to talk, pick a time here: ${callUrl}`);
  console.log("");
  console.log("Run again with --send to send, or --send --to you@example.com for one test.");
  console.log("");
}

async function sendTest(args) {
  const to = text(args.to);
  if (!to || !to.includes("@")) {
    console.error("--to needs a valid email address.");
    process.exitCode = 1;
    return;
  }
  const result = await sendFounderNoteEmail({
    to,
    name: text(args.name, "there"),
    sessions: Number(args.sessions) || 0,
    callUrl: text(args["call-url"]),
    replyTo: replyToFor(args),
    founderName: founderSignature(args),
  });
  if (!result.delivered) {
    console.error(`Test message to ${to} was not delivered (${result.reason}).`);
    if (result.reason === "not_configured") console.error("Set SENDLY_API_KEY in .env first.");
    process.exitCode = 1;
    return;
  }
  console.log(`Test message accepted by Sendly for ${to} (id ${result.id || "unknown"}).`);
}

async function sendBatch(args) {
  if (text(args.to)) {
    await sendTest(args);
    return;
  }

  const { rows, total, callUrl } = await audience(args);
  const replyTo = replyToFor(args);
  const founderName = founderSignature(args);
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const claimed = await query(
      `insert into founder_outreach (user_id, subject)
       values ($1, 'A quick note from the JotBox founder')
       on conflict do nothing
       returning user_id`,
      [row.id],
    );
    if (!claimed.rows[0]) {
      skipped += 1;
      continue;
    }

    const result = await sendFounderNoteEmail({
      to: row.email,
      name: row.name,
      sessions: row.sessions,
      callUrl,
      replyTo,
      founderName,
    });

    if (result.delivered) {
      sent += 1;
      continue;
    }

    skipped += 1;
    if (result.reason === "network") {
      console.warn(`Kept the claim for ${maskEmail(row.email)}: a retry could double-send.`);
      continue;
    }
    failed += 1;
    await query("delete from founder_outreach where user_id = $1", [row.id]).catch(() => {});
  }

  console.log("");
  console.log(`Matched ${total} account${total === 1 ? "" : "s"}. Sent ${sent}, skipped ${skipped}, failed ${failed}.`);
  if (failed) console.log("Failed claims were released, so the next run can try them again.");
  console.log("");
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
  if (args.send) {
    await sendBatch(args);
    return;
  }
  await preview(args);
}

try {
  await main();
} catch (error) {
  console.error("Founder mail failed:", error.message);
  process.exitCode = 1;
} finally {
  if (process.env.DATABASE_URL) await getPool().end().catch(() => {});
}
