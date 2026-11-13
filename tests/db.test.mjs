import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { loadEnv } from "./env.mjs";

const connectionString = loadEnv();
const pool = connectionString
  ? new pg.Pool({ connectionString, ssl: { rejectUnauthorized: true }, max: 1, connectionTimeoutMillis: 15_000 })
  : null;

after(async () => {
  await pool?.end();
});

const REQUIRED_TABLES = [
  "schema_migrations",
  "users",
  "auth_sessions",
  "auth_attempts",
  "captures",
  "organisations",
  "departments",
  "org_members",
  "capture_grants",
  "audit_events",
];

const REQUIRED_COLUMNS = {
  captures: [
    "id",
    "user_id",
    "title",
    "kind",
    "status",
    "duration_sec",
    "scratch",
    "transcript",
    "notes",
    "has_audio",
    "created_at",
    "org_id",
    "department_id",
    "visibility",
    "sensitivity",
  ],
  org_members: ["org_id", "user_id", "role", "department_id", "joined_at"],
  capture_grants: ["capture_id", "user_id", "granted_by", "created_at"],
  audit_events: ["id", "org_id", "actor_id", "action", "capture_id", "metadata", "created_at"],
};

test("database schema supports recordings, org memory and audit", { skip: pool ? false : "DATABASE_URL is not set" }, async () => {
  const tables = await pool.query(
    "select table_name from information_schema.tables where table_schema = 'public'",
  );
  const names = new Set(tables.rows.map((row) => row.table_name));
  for (const table of REQUIRED_TABLES) assert.ok(names.has(table), `missing table ${table}`);

  const columns = await pool.query(
    "select table_name, column_name from information_schema.columns where table_schema = 'public'",
  );
  const byTable = new Map();
  for (const row of columns.rows) {
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Set());
    byTable.get(row.table_name).add(row.column_name);
  }
  for (const [table, expected] of Object.entries(REQUIRED_COLUMNS)) {
    const actual = byTable.get(table) ?? new Set();
    for (const column of expected) assert.ok(actual.has(column), `missing column ${table}.${column}`);
  }

  const versions = await pool.query("select version from schema_migrations order by version");
  const applied = versions.rows.map((row) => row.version);
  assert.ok(applied.includes("001_initial"));
  assert.ok(applied.includes("002_org_memory"));

  const constraints = await pool.query(
    `select conname from pg_constraint where conrelid = 'captures'::regclass and contype = 'c'`,
  );
  const checks = new Set(constraints.rows.map((row) => row.conname));
  assert.ok(checks.has("captures_kind_check"), "capture kind constraint missing");
  assert.ok(checks.has("captures_status_check"), "capture status constraint missing");
});
