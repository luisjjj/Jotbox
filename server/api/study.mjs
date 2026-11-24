import { z } from "zod";
import { getPool, query } from "./pg.mjs";
import { requireSession } from "./auth.mjs";
import { planForUser } from "./billing.mjs";
import { generateStudySet } from "./study-ai.mjs";
import { HttpError, assertSameOrigin, readJson, requireMethod, sendJson } from "./http.mjs";

/**
 * Study exchange for students.
 *
 * A group is a small circle joined with a six-character code. Members share a
 * finished note as a snapshot, or ask the writer to turn that note into a quiz
 * or a flashcard deck. Free accounts get three generated sets a month; Pro and
 * enterprise accounts are not capped. Sharing a plain note is always free.
 */

const uuid = z.string().uuid();
const groupNameSchema = z
  .string()
  .trim()
  .min(2, "Give the group a name.")
  .max(80, "That name is too long.");
const codeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{6}$/, "Enter the six-character code.");

export const FREE_STUDY_GENERATIONS = 3;

// I, O, 0 and 1 are left out so a code read out loud cannot be mistyped.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeGroupCode(random = Math.random) {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function studyQuota({ plan, used }) {
  const pro = plan === "pro" || plan === "enterprise";
  const limit = pro ? null : FREE_STUDY_GENERATIONS;
  return {
    plan,
    limit,
    used,
    remaining: pro ? null : Math.max(0, FREE_STUDY_GENERATIONS - used),
  };
}

export function itemView(row, userId, { includePayload = false } = {}) {
  const view = {
    id: row.id,
    groupId: row.group_id,
    groupName: row.group_name ?? "",
    kind: row.kind,
    title: row.title,
    sourceKind: row.source_kind,
    authorName: row.author_name || "",
    createdAt: new Date(row.created_at).getTime(),
    canDelete: row.author_id === userId,
  };
  if (includePayload) view.payload = row.payload;
  return view;
}

export function groupView(row, userId) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    createdAt: new Date(row.created_at).getTime(),
    memberCount: Number(row.member_count ?? 0),
    itemCount: Number(row.item_count ?? 0),
    lastItemAt: row.last_item_at ? new Date(row.last_item_at).getTime() : null,
    isOwner: row.created_by === userId,
  };
}

async function requireMember(userId, groupId) {
  const result = await query("select role from study_group_members where group_id = $1 and user_id = $2", [
    groupId,
    userId,
  ]);
  if (!result.rows[0]) throw new HttpError(404, "That study group was not found.");
}

async function usedGenerations(userId) {
  const result = await query(
    `select count(*)::int as used
       from study_generations
      where user_id = $1 and created_at >= date_trunc('month', now())`,
    [userId],
  );
  return Number(result.rows[0]?.used ?? 0);
}

async function currentQuota(userId) {
  const plan = await planForUser(userId).catch(() => "free");
  return studyQuota({ plan, used: await usedGenerations(userId) });
}

const generationBuckets = new Map();

function generationRate(userId) {
  if (process.env.JOTBOX_AI_NO_RATE_LIMIT) return;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const entry = generationBuckets.get(userId);
  if (!entry || now - entry.startedAt > windowMs) {
    generationBuckets.set(userId, { count: 1, startedAt: now });
    return;
  }
  entry.count += 1;
  if (entry.count > 30) {
    throw new HttpError(429, "That is a lot of study sets in one hour. Take a short break.");
  }
}

async function captureFor(userId, captureId) {
  const result = await query(
    "select id, title, kind, notes, transcript from captures where id = $1 and user_id = $2 limit 1",
    [captureId, userId],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, "That note was not found. Save it first, then share it.");
  return row;
}

async function itemForMember(userId, itemId) {
  const result = await query(
    `select i.*, u.name as author_name, g.name as group_name
       from study_items i
       join study_groups g on g.id = i.group_id
       join users u on u.id = i.author_id
       join study_group_members m on m.group_id = i.group_id and m.user_id = $1
      where i.id = $2
      limit 1`,
    [userId, itemId],
  );
  return result.rows[0] ?? null;
}

async function overview(req, res) {
  const { user } = await requireSession(req);
  const groups = await query(
    `select g.*,
            (select count(*) from study_group_members m where m.group_id = g.id) as member_count,
            (select count(*) from study_items i where i.group_id = g.id) as item_count,
            (select max(created_at) from study_items i where i.group_id = g.id) as last_item_at
       from study_groups g
       join study_group_members me on me.group_id = g.id and me.user_id = $1
      order by coalesce(last_item_at, g.created_at) desc`,
    [user.id],
  );
  const items = await query(
    `select i.id, i.group_id, i.kind, i.title, i.source_kind, i.source_capture_id, i.created_at, i.author_id,
            u.name as author_name, g.name as group_name
       from study_items i
       join study_groups g on g.id = i.group_id
       join users u on u.id = i.author_id
       join study_group_members me on me.group_id = i.group_id and me.user_id = $1
      order by i.created_at desc
      limit 60`,
    [user.id],
  );
  sendJson(res, 200, {
    groups: groups.rows.map((row) => groupView(row, user.id)),
    items: items.rows.map((row) => itemView(row, user.id)),
    quota: await currentQuota(user.id),
  });
}

async function createGroup(req, res) {
  const { user } = await requireSession(req);
  const body = await readJson(req, 4_000);
  const name = groupNameSchema.parse(body?.name ?? "");

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const client = await getPool().connect();
    try {
      await client.query("begin");
      const group = await client.query(
        "insert into study_groups (name, code, created_by) values ($1, $2, $3) returning *",
        [name, makeGroupCode(), user.id],
      );
      await client.query("insert into study_group_members (group_id, user_id) values ($1, $2)", [
        group.rows[0].id,
        user.id,
      ]);
      await client.query("commit");
      sendJson(res, 201, {
        group: groupView(
          { ...group.rows[0], member_count: 1, item_count: 0, last_item_at: null },
          user.id,
        ),
      });
      return;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      if (error?.code === "23505") continue;
      throw error;
    } finally {
      client.release();
    }
  }

  throw new HttpError(503, "Could not make a group code just now. Try again.");
}

async function joinGroup(req, res) {
  const { user } = await requireSession(req);
  const body = await readJson(req, 4_000);
  const code = codeSchema.parse(body?.code ?? "").toUpperCase();
  const group = await query("select * from study_groups where code = $1 limit 1", [code]);
  const row = group.rows[0];
  if (!row) throw new HttpError(404, "That code does not match a study group.");
  await query(
    `insert into study_group_members (group_id, user_id) values ($1, $2)
     on conflict (group_id, user_id) do nothing`,
    [row.id, user.id],
  );
  const counted = await query(
    `select g.*,
            (select count(*) from study_group_members m where m.group_id = g.id) as member_count,
            (select count(*) from study_items i where i.group_id = g.id) as item_count,
            (select max(created_at) from study_items i where i.group_id = g.id) as last_item_at
       from study_groups g
      where g.id = $1
      limit 1`,
    [row.id],
  );
  sendJson(res, 200, { group: groupView(counted.rows[0], user.id) });
}

async function getGroup(req, res, groupId) {
  const { user } = await requireSession(req);
  await requireMember(user.id, groupId);
  const group = await query(
    `select g.*,
            (select count(*) from study_group_members m where m.group_id = g.id) as member_count,
            (select count(*) from study_items i where i.group_id = g.id) as item_count,
            (select max(created_at) from study_items i where i.group_id = g.id) as last_item_at
       from study_groups g
      where g.id = $1
      limit 1`,
    [groupId],
  );
  const row = group.rows[0];
  if (!row) throw new HttpError(404, "That study group was not found.");
  const members = await query(
    `select u.id, u.name, m.joined_at
       from study_group_members m
       join users u on u.id = m.user_id
      where m.group_id = $1
      order by m.joined_at asc`,
    [groupId],
  );
  const items = await query(
    `select i.id, i.group_id, i.kind, i.title, i.source_kind, i.created_at, i.author_id,
            u.name as author_name, g.name as group_name
       from study_items i
       join users u on u.id = i.author_id
       join study_groups g on g.id = i.group_id
      where i.group_id = $1
      order by i.created_at desc
      limit 100`,
    [groupId],
  );
  sendJson(res, 200, {
    group: groupView(row, user.id),
    members: members.rows.map((member) => ({
      id: member.id,
      name: member.name || "",
      joinedAt: new Date(member.joined_at).getTime(),
    })),
    items: items.rows.map((item) => itemView(item, user.id)),
    quota: await currentQuota(user.id),
  });
}

async function leaveGroup(req, res, groupId) {
  const { user } = await requireSession(req);
  await requireMember(user.id, groupId);
  await query("delete from study_group_members where group_id = $1 and user_id = $2", [groupId, user.id]);
  await query(
    "delete from study_groups where id = $1 and not exists (select 1 from study_group_members where group_id = $1)",
    [groupId],
  );
  sendJson(res, 200, { left: true });
}

async function createItem({ groupId, authorId, capture, kind, payload }) {
  const result = await query(
    `insert into study_items (group_id, author_id, kind, title, source_capture_id, source_kind, payload)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)
     returning id, group_id, kind, title, source_kind, created_at, author_id`,
    [
      groupId,
      authorId,
      kind,
      String(capture.title || "Untitled note").slice(0, 160),
      capture.id,
      capture.kind || "seminar",
      JSON.stringify(payload),
    ],
  );
  const row = result.rows[0];
  const author = await query("select name from users where id = $1", [authorId]);
  const group = await query("select name from study_groups where id = $1", [groupId]);
  return itemView(
    { ...row, author_name: author.rows[0]?.name || "", group_name: group.rows[0]?.name || "" },
    authorId,
    { includePayload: true },
  );
}

async function shareNote(req, res, groupId) {
  const { user } = await requireSession(req);
  assertSameOrigin(req);
  await requireMember(user.id, groupId);
  const body = await readJson(req, 8_000);
  const captureId = uuid.parse(body?.captureId ?? "");
  const capture = await captureFor(user.id, captureId);
  if (!capture.notes || typeof capture.notes !== "object") {
    throw new HttpError(400, "That session has no notes to share yet.");
  }
  const item = await createItem({
    groupId,
    authorId: user.id,
    capture,
    kind: "note",
    payload: { kind: "note", notes: capture.notes },
  });
  sendJson(res, 201, { item });
}

async function generateForGroup(req, res, groupId) {
  const { user } = await requireSession(req);
  assertSameOrigin(req);
  await requireMember(user.id, groupId);
  generationRate(user.id);
  const body = await readJson(req, 8_000);
  const captureId = uuid.parse(body?.captureId ?? "");
  const kind = z.enum(["quiz", "cards"]).parse(body?.kind);
  const capture = await captureFor(user.id, captureId);

  const plan = await planForUser(user.id).catch(() => "free");
  const pro = plan === "pro" || plan === "enterprise";

  const generationId = await reserveGeneration(user.id, kind, captureId, pro);

  let item;
  try {
    const { payload } = await generateStudySet({ capture, kind });
    item = await createItem({
      groupId,
      authorId: user.id,
      capture,
      kind,
      payload: { kind, ...payload },
    });
  } catch (error) {
    await query("delete from study_generations where id = $1", [generationId]).catch(() => {});
    throw error;
  }

  sendJson(res, 201, { item, quota: await currentQuota(user.id) });
}

async function reserveGeneration(userId, kind, captureId, pro) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    // The advisory lock keeps two taps from racing past the free limit.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [userId]);
    if (!pro) {
      const counted = await client.query(
        `select count(*)::int as used
           from study_generations
          where user_id = $1 and created_at >= date_trunc('month', now())`,
        [userId],
      );
      if (Number(counted.rows[0]?.used ?? 0) >= FREE_STUDY_GENERATIONS) {
        throw new HttpError(
          402,
          `Free accounts can make ${FREE_STUDY_GENERATIONS} quizzes or card sets a month. Upgrade to Pro for unlimited study sets.`,
        );
      }
    }
    const inserted = await client.query(
      "insert into study_generations (user_id, kind, source_capture_id) values ($1, $2, $3) returning id",
      [userId, kind, captureId],
    );
    await client.query("commit");
    return inserted.rows[0].id;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getItem(req, res, itemId) {
  const { user } = await requireSession(req);
  const row = await itemForMember(user.id, itemId);
  if (!row) throw new HttpError(404, "That study item was not found.");
  sendJson(res, 200, { item: itemView(row, user.id, { includePayload: true }) });
}

async function deleteItem(req, res, itemId) {
  const { user } = await requireSession(req);
  assertSameOrigin(req);
  const result = await query("delete from study_items where id = $1 and author_id = $2 returning id", [
    itemId,
    user.id,
  ]);
  if (!result.rows[0]) throw new HttpError(404, "That study item was not found.");
  sendJson(res, 200, { deleted: true });
}

export async function handleStudy(req, res, tail) {
  const rest = tail[0] === "study" ? tail.slice(1) : tail;

  if (!rest.length) {
    requireMethod(req, ["GET"]);
    return overview(req, res);
  }

  if (rest[0] === "groups" && rest.length === 1) {
    requireMethod(req, ["POST"]);
    assertSameOrigin(req);
    return createGroup(req, res);
  }

  if (rest[0] === "join" && rest.length === 1) {
    requireMethod(req, ["POST"]);
    assertSameOrigin(req);
    return joinGroup(req, res);
  }

  if (rest[0] === "groups" && rest.length === 2) {
    const groupId = uuid.parse(rest[1]);
    if (req.method === "GET") return getGroup(req, res, groupId);
    if (req.method === "DELETE") {
      assertSameOrigin(req);
      return leaveGroup(req, res, groupId);
    }
    requireMethod(req, ["GET", "DELETE"]);
  }

  if (rest[0] === "groups" && rest.length === 3) {
    const groupId = uuid.parse(rest[1]);
    if (rest[2] === "items") {
      requireMethod(req, ["POST"]);
      return shareNote(req, res, groupId);
    }
    if (rest[2] === "generate") {
      requireMethod(req, ["POST"]);
      return generateForGroup(req, res, groupId);
    }
  }

  if (rest[0] === "items" && rest.length === 2) {
    const itemId = uuid.parse(rest[1]);
    if (req.method === "GET") return getItem(req, res, itemId);
    if (req.method === "DELETE") return deleteItem(req, res, itemId);
    requireMethod(req, ["GET", "DELETE"]);
  }

  throw new HttpError(404, "That study route was not found.");
}
