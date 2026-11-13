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

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 1,
});

try {
  const result = await pool.query(
    `delete from users
      where email like 'test.%' or email like 'ui.test.%' or email like 'api.test.%' or email like 'live.test.%' or email like 'paywall.%@example.com'
      returning email`,
  );
  console.log("removed", result.rowCount, result.rows.map((row) => row.email).join(", "));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
