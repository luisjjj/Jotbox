import pg from "pg";

const { Pool } = pg;

let pool = null;

function normalizedUrl(raw) {
  try {
    const url = new URL(raw);
    // pg treats sslmode=require as verify-full today but warns about future
    // semantics. TLS settings are supplied explicitly to the pool instead.
    url.searchParams.delete("sslmode");
    url.searchParams.delete("channel_binding");
    return url.toString();
  } catch {
    return raw;
  }
}

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!hasDatabase()) {
    throw Object.assign(new Error("Database is not configured."), { status: 503 });
  }
  if (!pool) {
    pool = new Pool({
      connectionString: normalizedUrl(process.env.DATABASE_URL),
      ssl: { rejectUnauthorized: true },
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
    pool.on("error", (error) => {
      console.error("[jotbox-db]", error.message);
    });
  }
  return pool;
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function ping() {
  const result = await query("select 1 as ok");
  return result.rows[0]?.ok === 1;
}
