import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const envFile = path.join(root, ".env");

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

const existing = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
const ownerUrl = process.env.DATABASE_URL_OWNER || existing.DATABASE_URL_OWNER || existing.DATABASE_URL;
if (!ownerUrl || !ownerUrl.includes("neondb_owner")) {
  console.error("No owner DATABASE_URL found.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = ownerUrl;

const appPassword = process.env.APP_DB_PASSWORD || existing.APP_DB_PASSWORD || crypto.randomBytes(24).toString("base64url");
const owner = new URL(ownerUrl);
const appUrl = new URL(ownerUrl);
appUrl.username = "jotbox_app";
appUrl.password = appPassword;
const database = owner.pathname.replace(/^\//, "") || "neondb";

const ownerClean = new URL(ownerUrl);
ownerClean.searchParams.delete("sslmode");
ownerClean.searchParams.delete("channel_binding");

const client = new pg.Client({
  connectionString: ownerClean.toString(),
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 15000,
});

try {
  await client.connect();
  const literal = appPassword.replace(/'/g, "''");
  await client.query(`
    do $$
    begin
      if not exists (select from pg_roles where rolname = 'jotbox_app') then
        create role jotbox_app login password '${literal}' nosuperuser nocreatedb nocreaterole noinherit;
      else
        alter role jotbox_app with login password '${literal}' nosuperuser nocreatedb nocreaterole noinherit;
      end if;
    end
    $$;
  `);
  await client.query(`grant connect on database "${database}" to jotbox_app`);
  await client.query(`grant usage on schema public to jotbox_app`);
  await client.query(`grant select, insert, update, delete on all tables in schema public to jotbox_app`);
  await client.query(`grant usage, select on all sequences in schema public to jotbox_app`);
  await client.query(`alter default privileges in schema public grant select, insert, update, delete on tables to jotbox_app`);
  await client.query(`alter default privileges in schema public grant usage, select on sequences to jotbox_app`);

  const nextEnv = [
    `DATABASE_URL=${appUrl.toString()}`,
    `DATABASE_URL_OWNER=${ownerUrl}`,
    `APP_DB_PASSWORD=${appPassword}`,
    `XAI_API_KEY=${existing.XAI_API_KEY || ""}`,
  ].join("\n");
  fs.writeFileSync(envFile, `${nextEnv}\n`, "utf8");

  console.log(`role=ready database=${database}`);
  console.log(`app_url=${appUrl.origin}${appUrl.pathname} (password redacted)`);
} catch (error) {
  console.error("Role setup failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
