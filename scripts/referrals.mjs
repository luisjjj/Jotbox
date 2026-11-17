import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { query, getPool } from "../server/api/pg.mjs";
import { commissionFor, maskEmail } from "../server/api/referrals.mjs";

/**
 * Manage referral partners and manual payouts.
 *
 * Usage:
 *   npm run partners -- --create --name "Cephas" --slug cephas --email cephas@example.com
 *   npm run partners -- --list
 *   npm run partners -- --show cephas
 *   npm run partners -- --rotate cephas
 *   npm run partners -- --pay cephas --amount 5000 --note "October payout"
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const DEFAULT_PERCENT = 20;

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
  console.log(`Referral partners and manual payouts.

  npm run partners -- --create --name "Cephas" --slug cephas [--email cephas@example.com] [--percent 20]
  npm run partners -- --list
  npm run partners -- --show <slug>
  npm run partners -- --rotate <slug>
  npm run partners -- --pay <slug> --amount 5000 [--note "October payout"]
`);
}

function publicOrigin() {
  const configured = process.env.JOTBOX_PUBLIC_URL?.trim();
  return (configured || "https://jotbox.online").replace(/\/+$/, "");
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function tokenHash(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function money(kobo) {
  return `NGN ${Math.round((Number(kobo) || 0) / 100).toLocaleString("en-NG")}`;
}

function percentOf(bp) {
  return `${Number(bp) / 100}%`;
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

async function partnerTotals(slug) {
  const result = await query(
    `select p.id, p.name, p.slug, p.email, p.commission_bp, p.active, p.created_at,
            count(distinct u.id)::int as signups,
            count(distinct case when t.payments > 0 then u.id end)::int as paying,
            coalesce(sum(t.payments), 0)::int as payments,
            coalesce(sum(t.gross), 0)::bigint as gross,
            (select coalesce(sum(amount), 0)::bigint from referral_payouts rp where rp.partner_id = p.id) as paid_out
       from referral_partners p
       left join users u on u.referral_partner_id = p.id
       left join (
         select user_id, count(*)::int as payments, sum(amount)::bigint as gross
           from billing_transactions
          where status = 'success' and applied_at is not null
          group by user_id
       ) t on t.user_id = u.id
      where ($1::text is null or p.slug = $1)
      group by p.id
      order by p.created_at desc`,
    [slug || null],
  );
  return result.rows.map((row) => {
    const gross = Number(row.gross) || 0;
    const commission = commissionFor(gross, row.commission_bp);
    const paidOut = Number(row.paid_out) || 0;
    return { ...row, gross, commission, paidOut, balance: Math.max(0, commission - paidOut) };
  });
}

async function listPartners() {
  const rows = await partnerTotals(null);
  if (!rows.length) {
    console.log("No partners yet. Create one with --create.");
    return;
  }
  console.log("");
  console.log(
    ["SLUG", "NAME", "SHARE", "SIGNUPS", "PAYING", "COLLECTED", "COMMISSION", "PAID", "DUE"]
      .map((label, index) => label.padEnd([16, 18, 7, 8, 7, 14, 14, 14, 14][index]))
      .join(""),
  );
  for (const row of rows) {
    console.log(
      [
        `${row.slug}${row.active ? "" : " (off)"}`,
        row.name,
        percentOf(row.commission_bp),
        String(row.signups),
        String(row.paying),
        money(row.gross),
        money(row.commission),
        money(row.paidOut),
        money(row.balance),
      ]
        .map((value, index) => String(value).padEnd([16, 18, 7, 8, 7, 14, 14, 14, 14][index]))
        .join(""),
    );
  }
  console.log("");
}

async function createPartner(args) {
  const name = String(args.name === true ? "" : args.name || "").trim();
  const slug = slugify(args.slug === true ? name : args.slug || name);
  const email = String(args.email === true ? "" : args.email || "").trim().toLowerCase();
  const percent = Number(args.percent ?? DEFAULT_PERCENT);

  if (!name) {
    console.error("Missing --name.");
    usage();
    process.exitCode = 1;
    return;
  }
  if (!/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/.test(slug)) {
    console.error("The --slug must be 2 to 50 characters using letters, numbers, and hyphens.");
    process.exitCode = 1;
    return;
  }
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    console.error("--percent must be between 0 and 100.");
    process.exitCode = 1;
    return;
  }

  const token = crypto.randomBytes(32).toString("base64url");
  let row;
  try {
    const inserted = await query(
      `insert into referral_partners (name, slug, email, commission_bp, access_token_hash, notes)
       values ($1, $2, $3, $4, $5, $6)
       returning id, name, slug, commission_bp, created_at`,
      [name, slug, email, Math.round(percent * 100), tokenHash(token), String(args.notes || "")],
    );
    row = inserted.rows[0];
  } catch (error) {
    if (error?.code === "23505") {
      console.error(`The slug "${slug}" is already in use. Pick another with --slug.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  console.log("");
  console.log(`Partner created: ${row.name}`);
  console.log(`  share:        ${percentOf(row.commission_bp)} of every Pro payment`);
  console.log(`  referral:     ${publicOrigin()}/r/${row.slug}`);
  console.log(`  dashboard:    ${publicOrigin()}/partner/${token}`);
  console.log("");
  console.log("Share the referral link with the creator. Share the dashboard link only with them.");
  console.log("Only a hash of the dashboard link is stored, so it cannot be printed again. Use --rotate to replace it.");
  console.log("");
}

async function showPartner(slug) {
  const rows = await partnerTotals(slug);
  const partner = rows[0];
  if (!partner) {
    console.error(`No partner with slug "${slug}".`);
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(`${partner.name} (${partner.slug})`);
  console.log(`  share:        ${percentOf(partner.commission_bp)}${partner.active ? "" : "  INACTIVE"}`);
  console.log(`  email:        ${partner.email || "not set"}`);
  console.log(`  referral:     ${publicOrigin()}/r/${partner.slug}`);
  console.log(`  sign-ups:     ${partner.signups}`);
  console.log(`  paying:       ${partner.paying}`);
  console.log(`  payments:     ${partner.payments}`);
  console.log(`  collected:    ${money(partner.gross)}`);
  console.log(`  commission:   ${money(partner.commission)}`);
  console.log(`  paid out:     ${money(partner.paidOut)}`);
  console.log(`  balance due:  ${money(partner.balance)}`);
  console.log("");

  const referred = await query(
    `select u.email, u.created_at, s.status,
            coalesce(t.payments, 0)::int as payments, coalesce(t.gross, 0)::bigint as gross
       from users u
       left join billing_subscriptions s on s.user_id = u.id
       left join (
         select user_id, count(*)::int as payments, sum(amount)::bigint as gross
           from billing_transactions
          where status = 'success' and applied_at is not null
          group by user_id
       ) t on t.user_id = u.id
      where u.referral_partner_id = $1
      order by u.created_at desc
      limit 100`,
    [partner.id],
  );
  if (!referred.rows.length) {
    console.log("No sign-ups through this link yet.");
  } else {
    for (const person of referred.rows) {
      const share = commissionFor(person.gross, partner.commission_bp);
      console.log(
        `  ${formatDate(person.created_at).padEnd(13)} ${maskEmail(person.email).padEnd(24)} ${
          person.status || "free"
        }  ${person.payments} payment${person.payments === 1 ? "" : "s"}  ${money(share)} share`,
      );
    }
  }

  const payouts = await query(
    "select amount, paid_at, note from referral_payouts where partner_id = $1 order by paid_at desc limit 50",
    [partner.id],
  );
  if (payouts.rows.length) {
    console.log("");
    console.log("Payouts:");
    for (const payout of payouts.rows) {
      console.log(
        `  ${formatDate(payout.paid_at).padEnd(13)} ${money(payout.amount).padEnd(14)} ${payout.note || ""}`,
      );
    }
  }
  console.log("");
}

async function rotateToken(slug) {
  const token = crypto.randomBytes(32).toString("base64url");
  const updated = await query(
    "update referral_partners set access_token_hash = $2, updated_at = now() where slug = $1 returning name, slug",
    [slug, tokenHash(token)],
  );
  const row = updated.rows[0];
  if (!row) {
    console.error(`No partner with slug "${slug}".`);
    process.exitCode = 1;
    return;
  }
  console.log("");
  console.log(`New dashboard link for ${row.name}:`);
  console.log(`  ${publicOrigin()}/partner/${token}`);
  console.log("The old dashboard link stopped working.");
  console.log("");
}

async function recordPayout(args) {
  const slug = String(args.pay === true ? "" : args.pay || "").trim();
  if (!slug) {
    console.error("Add the partner slug after --pay.");
    usage();
    process.exitCode = 1;
    return;
  }
  const naira = Number(args.amount);
  if (!Number.isFinite(naira) || naira <= 0) {
    console.error("Add the amount in naira, for example --amount 5000.");
    process.exitCode = 1;
    return;
  }
  const found = await query("select id, name, slug from referral_partners where slug = $1", [slug]);
  const partner = found.rows[0];
  if (!partner) {
    console.error(`No partner with slug "${slug}".`);
    process.exitCode = 1;
    return;
  }

  const kobo = Math.round(naira * 100);
  await query(
    `insert into referral_payouts (partner_id, amount, currency, note, paid_at)
     values ($1, $2, 'NGN', $3, coalesce($4::timestamptz, now()))`,
    [partner.id, kobo, String(args.note === true ? "" : args.note || ""), args.date || null],
  );

  const totals = (await partnerTotals(slug))[0];
  console.log("");
  console.log(`Recorded payout of ${money(kobo)} to ${partner.name}.`);
  if (totals) {
    console.log(`  commission earned: ${money(totals.commission)}`);
    console.log(`  paid out:          ${money(totals.paidOut)}`);
    console.log(`  balance due:       ${money(totals.balance)}`);
  }
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
  if (args.create) {
    await createPartner(args);
    return;
  }
  if (args.list) {
    await listPartners();
    return;
  }
  if (args.show) {
    await showPartner(String(args.show === true ? "" : args.show).trim());
    return;
  }
  if (args.rotate) {
    await rotateToken(String(args.rotate === true ? "" : args.rotate).trim());
    return;
  }
  if (args.pay) {
    await recordPayout(args);
    return;
  }
  usage();
}

try {
  await main();
} catch (error) {
  console.error("Referral command failed:", error.message);
  process.exitCode = 1;
} finally {
  if (process.env.DATABASE_URL) await getPool().end().catch(() => {});
}
