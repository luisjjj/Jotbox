import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { revokeCaptureLinks } from "../server/api/orgs.mjs";
import { loadEnv } from "./env.mjs";

const connectionString = loadEnv();
const pool = connectionString
  ? new pg.Pool({ connectionString, ssl: { rejectUnauthorized: true }, max: 1, connectionTimeoutMillis: 30_000 })
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
  "billing_plans",
  "billing_subscriptions",
  "billing_events",
  "usage_ledger",
  "referral_partners",
  "referral_payouts",
  "billing_reminders",
  "founder_outreach",
  "usage_reservations",
  "ai_jobs",
  "memory_chunks",
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
    "recorded_at",
    "org_id",
    "department_id",
    "visibility",
    "sensitivity",
    "audio_key",
    "audio_content_type",
    "audio_bytes",
    "audio_deleted_at",
  ],
  organisations: ["id", "name", "plan", "pool_seconds"],
  usage_reservations: [
    "id",
    "user_id",
    "capture_id",
    "org_id",
    "seconds",
    "status",
    "created_at",
    "expires_at",
    "settled_at",
  ],
  ai_jobs: [
    "id",
    "user_id",
    "capture_id",
    "kind",
    "status",
    "attempt",
    "payload",
    "result",
    "error",
    "created_at",
    "started_at",
    "finished_at",
    "updated_at",
  ],
  memory_chunks: [
    "id",
    "capture_id",
    "org_id",
    "department_id",
    "owner_id",
    "chunk_index",
    "speaker",
    "start_sec",
    "end_sec",
    "text",
    "tsv",
    "embedding",
    "embedding_model",
    "created_at",
  ],
  org_members: ["org_id", "user_id", "role", "department_id", "joined_at"],
  capture_grants: ["capture_id", "user_id", "granted_by", "created_at"],
  audit_events: ["id", "org_id", "actor_id", "action", "capture_id", "metadata", "created_at"],
  billing_plans: ["provider", "plan_key", "code", "currency", "amount", "interval", "created_at"],
  billing_subscriptions: [
    "user_id",
    "provider",
    "plan_key",
    "plan_code",
    "subscription_code",
    "email_token",
    "status",
    "currency",
    "amount",
    "interval",
    "customer_code",
    "reference",
    "next_payment_at",
    "started_at",
    "cancelled_at",
  ],
  billing_events: ["id", "provider", "event", "reference", "payload", "created_at"],
  usage_ledger: ["user_id", "capture_id", "seconds", "recorded_at"],
  users: ["referral_partner_id", "referred_at"],
  referral_partners: [
    "id",
    "name",
    "slug",
    "email",
    "commission_bp",
    "access_token_hash",
    "active",
    "created_at",
  ],
  referral_payouts: ["id", "partner_id", "amount", "currency", "paid_at", "note"],
  billing_reminders: ["user_id", "kind", "period_end", "sent_at"],
  founder_outreach: ["user_id", "sent_at", "subject"],
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
  assert.ok(applied.includes("003_share_and_live"));
  assert.ok(applied.includes("004_billing"));
  assert.ok(applied.includes("005_usage_metering"));
  assert.ok(applied.includes("006_billing_hardening"));
  assert.ok(applied.includes("007_usage_ledger"));
  assert.ok(applied.includes("011_referrals"));
  assert.ok(applied.includes("012_lifecycle_email"));
  assert.ok(applied.includes("013_async_rag_storage"));

  const constraints = await pool.query(
    `select conname from pg_constraint where conrelid = 'captures'::regclass and contype = 'c'`,
  );
  const checks = new Set(constraints.rows.map((row) => row.conname));
  assert.ok(checks.has("captures_kind_check"), "capture kind constraint missing");
  assert.ok(checks.has("captures_status_check"), "capture status constraint missing");
});

test("unsharing revokes every live link", { skip: pool ? false : "DATABASE_URL is not set" }, async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const owner = await client.query(
      "insert into users (email, password_hash) values ($1, 'test') returning id",
      [`revoke.${crypto.randomUUID()}@jotbox.test`],
    );
    const userId = owner.rows[0].id;
    const captureId = crypto.randomUUID();
    await client.query(
      `insert into captures (id, user_id, title, kind, status, created_at)
       values ($1, $2, 'Revoke check', 'meeting', 'ready', now())`,
      [captureId, userId],
    );
    await client.query(
      `insert into capture_share_links (capture_id, created_by, token_hash, token_hint)
       values ($1, $2, $3, 'abc123')`,
      [captureId, userId, `hash-${crypto.randomUUID()}`],
    );

    await revokeCaptureLinks(client, captureId);

    const links = await client.query("select revoked_at from capture_share_links where capture_id = $1", [captureId]);
    assert.equal(links.rows.length, 1);
    assert.ok(links.rows[0].revoked_at, "live link was not revoked");
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
});
