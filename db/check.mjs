import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) {
  const file = path.resolve(here, "..", ".env");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 1,
  connectionTimeoutMillis: 15000,
});

try {
  const version = await pool.query("select version() as version, current_database() as db, current_user as usr");
  console.log(JSON.stringify(version.rows[0], null, 2));
  const tables = await pool.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  console.log("TABLES", tables.rows.map((row) => row.table_name));
} catch (error) {
  console.error("ERR", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
