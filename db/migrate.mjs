import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

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

loadEnv();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const schema = fs.readFileSync(path.join(here, "schema.sql"), "utf8");
const migrationUrl = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
const pool = new pg.Pool({
  connectionString: migrationUrl,
  ssl: { rejectUnauthorized: true },
  max: 1,
  connectionTimeoutMillis: 15000,
});

try {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(schema);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  const tables = await pool.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  const version = await pool.query("select version from schema_migrations order by applied_at desc limit 1");
  console.log("Migration complete:", version.rows[0]?.version);
  console.log("Tables:", tables.rows.map((row) => row.table_name).join(", "));
} catch (error) {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
