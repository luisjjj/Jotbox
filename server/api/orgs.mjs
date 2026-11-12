import { z } from "zod";
import { getPool, query } from "./pg.mjs";
import { requireSession } from "./auth.mjs";
import { answerOrganisationMemory } from "./memory-ai.mjs";
import {
  HttpError,
  assertSameOrigin,
  clientIp,
  readJson,
  requireMethod,
  sendJson,
  userAgent,
} from "./http.mjs";

const uuid = z.string().uuid();
const roleInput = z.enum(["admin", "manager", "member"]);
const visibilitySchema = z.enum(["private", "department", "organisation"]);
const sensitivitySchema = z.enum(["standard", "confidential"]);
const orgNameSchema = z.string().trim().min(2, "Give the organisation a name.").max(120, "That name is too long.");
const departmentNameSchema = z.string().trim().min(2, "Give the department a name.").max(80, "That name is too long.");

const MEMORY_STOPWORDS = new Set([
  "the", "and", "for", "was", "were", "what", "when", "where", "why", "who", "how", "our", "your", "their",
  "did", "does", "with", "from", "that", "this", "have", "has", "had", "are", "but", "not", "you", "about",
  "into", "then", "than", "them", "they", "there", "been", "being", "all", "any", "can", "could", "should",
  "would", "will", "just", "over", "under", "after", "before", "between", "across", "happen", "happened",
]);

const memoryBuckets = new Map();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0]?.message || "Check the details and try again.");
  }
  return result.data;
}

function partsOf(req) {
  return new URL(req.url || "/", "http://localhost").pathname.split("/").filter(Boolean);
}

function adminRole(role) {
  return role === "owner" || role === "admin";
}

async function audit({ req, orgId, actorId, action, captureId = null, metadata = {} }) {
  await query(
    `insert into audit_events (org_id, actor_id, action, capture_id, metadata, ip, user_agent)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [orgId, actorId, action, captureId, JSON.stringify(metadata).slice(0, 8_000), clientIp(req), userAgent(req)],
  );
}

async function requireOrgMember(req, orgId) {
  const { user } = await requireSession(req);
  const result = await query(
    `select m.role, m.department_id, o.name, o.retention_days, o.created_at
       from org_members m
       join organisations o on o.id = m.org_id
      where m.org_id = $1 and m.user_id = $2
      limit 1`,
    [orgId, user.id],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, "That organisation was not found.");
  return {
    orgId,
    user,
    role: row.role,
    departmentId: row.department_id,
    orgName: row.name,
    retentionDays: Number(row.retention_days),
    createdAt: new Date(row.created_at).getTime(),
  };
}

function requireAdmin(member) {
  if (!adminRole(member.role)) throw new HttpError(403, "Only an organisation admin can do that.");
}

async function departmentInOrg(orgId, departmentId) {
  if (!departmentId) return null;
  const result = await query("select id, name from departments where id = $1 and org_id = $2", [
    departmentId,
    orgId,
  ]);
  if (!result.rows[0]) throw new HttpError(400, "That department is not part of this organisation.");
  return result.rows[0];
}

function orgSummary(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    departmentId: row.department_id,
    departmentName: row.department_name ?? null,
    retentionDays: Number(row.retention_days),
    memberCount: Number(row.member_count ?? 0),
    departmentCount: Number(row.department_count ?? 0),
    captureCount: Number(row.capture_count ?? 0),
    createdAt: new Date(row.created_at).getTime(),
  };
}

function memberView(row) {
  return {
    userId: row.user_id,
    name: row.name || "",
    email: row.email,
    role: row.role,
    departmentId: row.department_id,
    departmentName: row.department_name ?? null,
    joinedAt: new Date(row.joined_at).getTime(),
  };
}

function shareView(row) {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    visibility: row.visibility,
    sensitivity: row.sensitivity,
    departmentId: row.department_id,
    departmentName: row.department_name ?? null,
    createdAt: new Date(row.created_at).getTime(),
    grantUserIds: Array.isArray(row.grant_user_ids) ? row.grant_user_ids : [],
  };
}

function auditView(row) {
  return {
    id: Number(row.id),
    action: row.action,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    captureId: row.capture_id,
    actorName: row.actor_name || "",
    actorEmail: row.actor_email || "",
    createdAt: new Date(row.created_at).getTime(),
  };
}

function notesToText(notes) {
  if (!notes || typeof notes !== "object") return "";
  const parts = [];
  if (typeof notes.summary === "string") parts.push(notes.summary);
  for (const item of Array.isArray(notes.highlights) ? notes.highlights : []) {
    if (typeof item === "string" && item.trim()) parts.push(item);
  }
  for (const action of Array.isArray(notes.actions) ? notes.actions : []) {
    if (!action || typeof action.text !== "string" || !action.text.trim()) continue;
    parts.push(`Action: ${action.text}${action.owner ? ` (${action.owner})` : ""}`);
  }
  for (const section of Array.isArray(notes.sections) ? notes.sections : []) {
    if (!section || typeof section !== "object") continue;
    if (typeof section.heading === "string" && section.heading.trim()) parts.push(`## ${section.heading}`);
    for (const bullet of Array.isArray(section.bullets) ? section.bullets : []) {
      if (typeof bullet === "string" && bullet.trim()) parts.push(bullet);
    }
  }
  return parts.join("\n");
}

function transcriptToText(transcript) {
  if (!Array.isArray(transcript)) return "";
  return transcript
    .flatMap((line) => {
      if (!line || typeof line.text !== "string" || !line.text.trim()) return [];
      const speaker = typeof line.speaker === "string" && line.speaker.trim() ? `${line.speaker.trim()}: ` : "";
      return [`${speaker}${line.text.trim()}`];
    })
    .join("\n");
}

function occurrences(haystack, term) {
  if (!haystack) return 0;
  let count = 0;
  let from = 0;
  const text = String(haystack).toLowerCase();
  while (count < 8) {
    const index = text.indexOf(term, from);
    if (index === -1) break;
    count += 1;
    from = index + term.length;
  }
  return count;
}

function questionTerms(question) {
  const words = String(question).toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  return [...new Set(words)].filter((word) => !MEMORY_STOPWORDS.has(word)).slice(0, 14);
}

function rateLimitMemory(userId, orgId) {
  const key = `${userId}:${orgId}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const entry = memoryBuckets.get(key);
  if (!entry || now - entry.startedAt > windowMs) {
    memoryBuckets.set(key, { count: 1, startedAt: now });
    return;
  }
  entry.count += 1;
  if (entry.count > 30) {
    throw new HttpError(429, "That is a lot of questions in one hour. Try again shortly.");
  }
}

async function listOrgs(req, res) {
  requireMethod(req, ["GET"]);
  const { user } = await requireSession(req);
  const result = await query(
    `select o.id, o.name, o.retention_days, o.created_at, m.role, m.department_id, d.name as department_name,
            (select count(*) from org_members om where om.org_id = o.id)::int as member_count,
            (select count(*) from departments dp where dp.org_id = o.id)::int as department_count,
            (select count(*) from captures c where c.org_id = o.id)::int as capture_count
       from organisations o
       join org_members m on m.org_id = o.id
       left join departments d on d.id = m.department_id
      where m.user_id = $1
      order by o.name asc`,
    [user.id],
  );
  sendJson(res, 200, { orgs: result.rows.map(orgSummary) });
}

async function createOrg(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  const { user } = await requireSession(req);
  const body = await readJson(req, 20_000);
  const name = parse(orgNameSchema, body?.name);

  const client = await getPool().connect();
  try {
    await client.query("begin");
    const created = await client.query(
      "insert into organisations (name, created_by) values ($1, $2) returning id, name, retention_days, created_at",
      [name, user.id],
    );
    const org = created.rows[0];
    const department = await client.query(
      "insert into departments (org_id, name) values ($1, $2) returning id, name",
      [org.id, "General"],
    );
    await client.query(
      "insert into org_members (org_id, user_id, role, department_id) values ($1, $2, 'owner', $3)",
      [org.id, user.id, department.rows[0].id],
    );
    await client.query(
      `insert into audit_events (org_id, actor_id, action, metadata, ip, user_agent)
       values ($1, $2, 'org.create', $3::jsonb, $4, $5)`,
      [org.id, user.id, JSON.stringify({ name: org.name }), clientIp(req), userAgent(req)],
    );
    await client.query("commit");

    sendJson(res, 201, {
      org: orgSummary({
        ...org,
        role: "owner",
        department_id: department.rows[0].id,
        department_name: department.rows[0].name,
        member_count: 1,
        department_count: 1,
        capture_count: 0,
      }),
    });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getOrg(req, res) {
  requireMethod(req, ["GET"]);
  const member = await requireOrgMember(req, orgIdFrom(req));
  const admin = adminRole(member.role);

  const [departments, members, shares, captureCount, auditEvents] = await Promise.all([
    query(
      `select d.id, d.name, d.created_at,
              (select count(*) from org_members m where m.department_id = d.id)::int as member_count
         from departments d
        where d.org_id = $1
        order by d.name asc`,
      [member.orgId],
    ),
    query(
      `select m.user_id, m.role, m.department_id, m.joined_at, u.name, u.email, d.name as department_name
         from org_members m
         join users u on u.id = m.user_id
         left join departments d on d.id = m.department_id
        where m.org_id = $1
        order by case m.role when 'owner' then 0 when 'admin' then 1 when 'manager' then 2 else 3 end,
                 lower(coalesce(u.name, u.email)) asc`,
      [member.orgId],
    ),
    query(
      `select c.id, c.title, c.kind, c.visibility, c.sensitivity, c.department_id, c.created_at,
              d.name as department_name,
              coalesce((select json_agg(g.user_id) from capture_grants g where g.capture_id = c.id), '[]'::json) as grant_user_ids
         from captures c
         left join departments d on d.id = c.department_id
        where c.org_id = $1 and c.user_id = $2
        order by c.created_at desc
        limit 100`,
      [member.orgId, member.user.id],
    ),
    query("select count(*)::int as count from captures where org_id = $1", [member.orgId]),
    admin
      ? query(
          `select a.id, a.action, a.metadata, a.capture_id, a.created_at, u.name as actor_name, u.email as actor_email
             from audit_events a
             left join users u on u.id = a.actor_id
            where a.org_id = $1
            order by a.created_at desc
            limit 40`,
          [member.orgId],
        )
      : Promise.resolve({ rows: [] }),
  ]);

  sendJson(res, 200, {
    org: {
      id: member.orgId,
      name: member.orgName,
      role: member.role,
      departmentId: member.departmentId,
      retentionDays: member.retentionDays,
      createdAt: member.createdAt,
      memberCount: members.rows.length,
      departmentCount: departments.rows.length,
      captureCount: Number(captureCount.rows[0]?.count ?? 0),
    },
    departments: departments.rows.map((row) => ({
      id: row.id,
      name: row.name,
      memberCount: Number(row.member_count ?? 0),
      createdAt: new Date(row.created_at).getTime(),
    })),
    members: members.rows.map(memberView),
    shares: shares.rows.map(shareView),
    audit: admin ? auditEvents.rows.map(auditView) : [],
  });
}

async function updateOrg(req, res) {
  requireMethod(req, ["PATCH"]);
  assertSameOrigin(req);
  const member = await requireOrgMember(req, orgIdFrom(req));
  requireAdmin(member);
  const body = await readJson(req, 20_000);
  const name = body?.name === undefined ? undefined : parse(orgNameSchema, body.name);
  const retentionDays =
    body?.retentionDays === undefined
      ? undefined
      : parse(z.number().int().min(30, "Keep at least 30 days.").max(3650, "Keep 10 years at most."), body.retentionDays);

  if (name === undefined && retentionDays === undefined) {
    throw new HttpError(400, "Nothing to update.");
  }

  const sets = [];
  const params = [];
  if (name !== undefined) {
    params.push(name);
    sets.push(`name = $${params.length}`);
  }
  if (retentionDays !== undefined) {
    params.push(retentionDays);
    sets.push(`retention_days = $${params.length}`);
  }
  params.push(member.orgId);
  const updated = await query(
    `update organisations set ${sets.join(", ")} where id = $${params.length}
     returning id, name, retention_days, created_at`,
    params,
  );

  await audit({
    req,
    orgId: member.orgId,
    actorId: member.user.id,
    action: "org.update",
    metadata: { name, retentionDays },
  });

  const row = updated.rows[0];
  sendJson(res, 200, {
    org: {
      id: row.id,
      name: row.name,
      role: member.role,
      retentionDays: Number(row.retention_days),
      createdAt: new Date(row.created_at).getTime(),
    },
  });
}

async function createDepartment(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  const member = await requireOrgMember(req, orgIdFrom(req));
  requireAdmin(member);
  const body = await readJson(req, 20_000);
  const name = parse(departmentNameSchema, body?.name);

  let row;
  try {
    const inserted = await query(
      "insert into departments (org_id, name) values ($1, $2) returning id, name, created_at",
      [member.orgId, name],
    );
    row = inserted.rows[0];
  } catch (error) {
    if (error?.code === "23505") throw new HttpError(409, "A department with that name already exists.");
    throw error;
  }

  await audit({
    req,
    orgId: member.orgId,
    actorId: member.user.id,
    action: "department.create",
    metadata: { name: row.name },
  });

  sendJson(res, 201, {
    department: { id: row.id, name: row.name, memberCount: 0, createdAt: new Date(row.created_at).getTime() },
  });
}

async function addMember(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  const member = await requireOrgMember(req, orgIdFrom(req));
  requireAdmin(member);
  const body = await readJson(req, 20_000);
  const email = parse(z.string().trim().toLowerCase().email("Enter a valid email address.").max(254), body?.email);
  const role = parse(roleInput, body?.role ?? "member");
  const departmentId = body?.departmentId ? parse(uuid, body.departmentId) : null;

  if (role === "admin" && member.role !== "owner") {
    throw new HttpError(403, "Only the owner can add another admin.");
  }
  await departmentInOrg(member.orgId, departmentId);

  const found = await query("select id, name, email from users where lower(email) = lower($1) limit 1", [email]);
  const user = found.rows[0];
  if (!user) {
    throw new HttpError(404, "No JotBox account uses that email yet. Ask them to create one first.");
  }

  try {
    await query(
      "insert into org_members (org_id, user_id, role, department_id) values ($1, $2, $3, $4)",
      [member.orgId, user.id, role, departmentId],
    );
  } catch (error) {
    if (error?.code === "23505") throw new HttpError(409, "They are already in this organisation.");
    throw error;
  }

  await audit({
    req,
    orgId: member.orgId,
    actorId: member.user.id,
    action: "member.add",
    metadata: { userId: user.id, email: user.email, role, departmentId },
  });

  sendJson(res, 201, {
    member: {
      userId: user.id,
      name: user.name || "",
      email: user.email,
      role,
      departmentId,
      departmentName: null,
      joinedAt: Date.now(),
    },
  });
}

async function updateMember(req, res) {
  requireMethod(req, ["PATCH"]);
  assertSameOrigin(req);
  const member = await requireOrgMember(req, orgIdFrom(req));
  requireAdmin(member);
  const parts = partsOf(req);
  const targetId = parse(uuid, parts[4]);
  const body = await readJson(req, 20_000);
  const role = body?.role === undefined ? undefined : parse(roleInput, body.role);
  const hasDepartment = Object.prototype.hasOwnProperty.call(body ?? {}, "departmentId");
  const departmentId = hasDepartment ? (body.departmentId ? parse(uuid, body.departmentId) : null) : undefined;

  if (role === undefined && departmentId === undefined) throw new HttpError(400, "Nothing to update.");

  const targetResult = await query("select role, department_id from org_members where org_id = $1 and user_id = $2", [
    member.orgId,
    targetId,
  ]);
  const target = targetResult.rows[0];
  if (!target) throw new HttpError(404, "That member was not found.");
  if (target.role === "owner") throw new HttpError(403, "The owner's access cannot be changed here.");
  if (member.role === "admin" && target.role === "admin") {
    throw new HttpError(403, "Only the owner can change another admin.");
  }
  if (role === "admin" && member.role !== "owner") {
    throw new HttpError(403, "Only the owner can make another admin.");
  }
  if (targetId === member.user.id && role !== undefined) {
    throw new HttpError(403, "You cannot change your own role.");
  }
  if (departmentId !== undefined) await departmentInOrg(member.orgId, departmentId);

  const sets = [];
  const params = [];
  if (role !== undefined) {
    params.push(role);
    sets.push(`role = $${params.length}`);
  }
  if (departmentId !== undefined) {
    params.push(departmentId);
    sets.push(`department_id = $${params.length}`);
  }
  params.push(member.orgId, targetId);
  await query(
    `update org_members set ${sets.join(", ")} where org_id = $${params.length - 1} and user_id = $${params.length}`,
    params,
  );

  await audit({
    req,
    orgId: member.orgId,
    actorId: member.user.id,
    action: "member.update",
    metadata: { userId: targetId, role, departmentId },
  });

  const updated = await query(
    `select m.user_id, m.role, m.department_id, m.joined_at, u.name, u.email, d.name as department_name
       from org_members m join users u on u.id = m.user_id
       left join departments d on d.id = m.department_id
      where m.org_id = $1 and m.user_id = $2`,
    [member.orgId, targetId],
  );
  sendJson(res, 200, { member: memberView(updated.rows[0]) });
}

async function removeMember(req, res) {
  requireMethod(req, ["DELETE"]);
  assertSameOrigin(req);
  const member = await requireOrgMember(req, orgIdFrom(req));
  requireAdmin(member);
  const parts = partsOf(req);
  const targetId = parse(uuid, parts[4]);

  const targetResult = await query("select role from org_members where org_id = $1 and user_id = $2", [
    member.orgId,
    targetId,
  ]);
  const target = targetResult.rows[0];
  if (!target) throw new HttpError(404, "That member was not found.");
  if (target.role === "owner") throw new HttpError(403, "The owner cannot be removed.");
  if (member.role === "admin" && target.role === "admin") {
    throw new HttpError(403, "Only the owner can remove another admin.");
  }

  await query("delete from org_members where org_id = $1 and user_id = $2", [member.orgId, targetId]);
  await audit({
    req,
    orgId: member.orgId,
    actorId: member.user.id,
    action: "member.remove",
    metadata: { userId: targetId, role: target.role },
  });
  res.statusCode = 204;
  res.end();
}

async function getShares(req, res) {
  requireMethod(req, ["GET"]);
  const member = await requireOrgMember(req, orgIdFrom(req));
  const result = await query(
    `select c.id, c.title, c.kind, c.visibility, c.sensitivity, c.department_id, c.created_at,
            d.name as department_name,
            coalesce((select json_agg(g.user_id) from capture_grants g where g.capture_id = c.id), '[]'::json) as grant_user_ids
       from captures c
       left join departments d on d.id = c.department_id
      where c.org_id = $1 and c.user_id = $2
      order by c.created_at desc
      limit 100`,
    [member.orgId, member.user.id],
  );
  sendJson(res, 200, { shares: result.rows.map(shareView) });
}

async function shareCapture(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  const member = await requireOrgMember(req, orgIdFrom(req));
  const body = await readJson(req, 200_000);
  const input = parse(
    z.object({
      captureId: uuid,
      visibility: visibilitySchema.default("private"),
      sensitivity: sensitivitySchema.default("standard"),
      departmentId: uuid.nullable().optional(),
      grantUserIds: z.array(uuid).max(100).default([]),
    }),
    body,
  );

  const owned = await query("select id, title, org_id from captures where id = $1 and user_id = $2", [
    input.captureId,
    member.user.id,
  ]);
  const capture = owned.rows[0];
  if (!capture) throw new HttpError(404, "That meeting is not yours to share.");
  if (capture.org_id && capture.org_id !== member.orgId) {
    throw new HttpError(409, "That meeting already belongs to another organisation.");
  }

  let departmentId = input.departmentId ?? null;
  if (input.visibility === "department") {
    if (!departmentId) throw new HttpError(400, "Choose the department that should see this meeting.");
    await departmentInOrg(member.orgId, departmentId);
    if (!adminRole(member.role) && departmentId !== member.departmentId) {
      throw new HttpError(403, "You can only share to your own department.");
    }
  } else {
    departmentId = null;
  }

  if (input.visibility === "organisation" && !adminRole(member.role)) {
    throw new HttpError(403, "Only an admin can share a meeting with the whole organisation.");
  }

  const grantIds = [...new Set(input.grantUserIds.filter((id) => id !== member.user.id))];
  if (grantIds.length) {
    const granted = await query(
      "select user_id from org_members where org_id = $1 and user_id = any($2::uuid[])",
      [member.orgId, grantIds],
    );
    if (granted.rows.length !== grantIds.length) {
      throw new HttpError(400, "One of those people is not in this organisation.");
    }
  }

  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query(
      `update captures
          set org_id = $1, department_id = $2, visibility = $3, sensitivity = $4
        where id = $5 and user_id = $6`,
      [member.orgId, departmentId, input.visibility, input.sensitivity, input.captureId, member.user.id],
    );
    await client.query("delete from capture_grants where capture_id = $1", [input.captureId]);
    for (const userId of grantIds) {
      await client.query(
        "insert into capture_grants (capture_id, user_id, granted_by) values ($1, $2, $3)",
        [input.captureId, userId, member.user.id],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  await audit({
    req,
    orgId: member.orgId,
    actorId: member.user.id,
    action: "capture.share",
    captureId: input.captureId,
    metadata: {
      title: capture.title,
      visibility: input.visibility,
      sensitivity: input.sensitivity,
      departmentId,
      grantUserIds: grantIds,
    },
  });

  sendJson(res, 200, {
    share: {
      id: capture.id,
      title: capture.title,
      visibility: input.visibility,
      sensitivity: input.sensitivity,
      departmentId,
      grantUserIds: grantIds,
    },
  });
}

async function viewCapture(req, res) {
  requireMethod(req, ["GET"]);
  const member = await requireOrgMember(req, orgIdFrom(req));
  const parts = partsOf(req);
  const captureId = parse(uuid, parts[4]);

  const result = await query(
    `select c.id, c.title, c.kind, c.status, c.created_at, c.duration_sec, c.notes, c.transcript,
            c.visibility, c.sensitivity, c.department_id, d.name as department_name, u.name as owner_name
       from captures c
       join org_members viewer on viewer.org_id = c.org_id and viewer.user_id = $2
       join users u on u.id = c.user_id
       left join departments d on d.id = c.department_id
       left join capture_grants g on g.capture_id = c.id and g.user_id = $2
      where c.org_id = $1 and c.id = $3
        and c.created_at > now() - ($4::int * interval '1 day')
        and (
          c.user_id = $2
          or g.user_id is not null
          or (
            c.sensitivity = 'standard'
            and (
              c.visibility = 'organisation'
              or (
                c.visibility = 'department'
                and (c.department_id = viewer.department_id or viewer.role in ('owner', 'admin'))
              )
            )
          )
        )
      limit 1`,
    [member.orgId, member.user.id, captureId, member.retentionDays],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, "That meeting is not available to you.");

  await audit({
    req,
    orgId: member.orgId,
    actorId: member.user.id,
    action: "memory.source_view",
    captureId: row.id,
    metadata: { title: row.title },
  });

  sendJson(res, 200, {
    capture: {
      id: row.id,
      title: row.title,
      kind: row.kind,
      status: row.status,
      createdAt: new Date(row.created_at).getTime(),
      durationSec: Number(row.duration_sec),
      notes: row.notes ?? null,
      transcript: row.transcript ?? [],
      visibility: row.visibility,
      sensitivity: row.sensitivity,
      departmentId: row.department_id,
      departmentName: row.department_name ?? null,
      ownerName: row.owner_name || "",
    },
  });
}

async function unshareCapture(req, res) {  requireMethod(req, ["DELETE"]);
  assertSameOrigin(req);
  const { user } = await requireSession(req);
  const parts = partsOf(req);
  const orgId = parse(uuid, parts[2]);
  const captureId = parse(uuid, parts[4]);

  const owned = await query("select id, title from captures where id = $1 and user_id = $2 and org_id = $3", [
    captureId,
    user.id,
    orgId,
  ]);
  const capture = owned.rows[0];
  if (!capture) throw new HttpError(404, "That shared meeting was not found.");

  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query(
      `update captures
          set org_id = null, department_id = null, visibility = 'private', sensitivity = 'standard'
        where id = $1 and user_id = $2`,
      [captureId, user.id],
    );
    await client.query("delete from capture_grants where capture_id = $1", [captureId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  await audit({
    req,
    orgId,
    actorId: user.id,
    action: "capture.unshare",
    captureId,
    metadata: { title: capture.title },
  });
  res.statusCode = 204;
  res.end();
}

async function getAudit(req, res) {
  requireMethod(req, ["GET"]);
  const member = await requireOrgMember(req, orgIdFrom(req));
  requireAdmin(member);
  const result = await query(
    `select a.id, a.action, a.metadata, a.capture_id, a.created_at, u.name as actor_name, u.email as actor_email
       from audit_events a
       left join users u on u.id = a.actor_id
      where a.org_id = $1
      order by a.created_at desc
      limit 60`,
    [member.orgId],
  );
  sendJson(res, 200, { audit: result.rows.map(auditView) });
}

async function queryMemory(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  const member = await requireOrgMember(req, orgIdFrom(req));
  const body = await readJson(req, 32_000);
  const question = parse(
    z.string().trim().min(3, "Ask a question about the record.").max(500, "Keep the question under 500 characters."),
    body?.question,
  );

  rateLimitMemory(member.user.id, member.orgId);

  const accessible = await query(
    `select c.id, c.title, c.kind, c.created_at, c.notes, c.transcript,
            c.visibility, c.sensitivity, c.department_id, d.name as department_name, u.name as owner_name
       from captures c
       join org_members viewer on viewer.org_id = c.org_id and viewer.user_id = $2
       join users u on u.id = c.user_id
       left join departments d on d.id = c.department_id
       left join capture_grants g on g.capture_id = c.id and g.user_id = $2
      where c.org_id = $1
        and c.status = 'ready'
        and c.created_at > now() - ($3::int * interval '1 day')
        and (
          c.user_id = $2
          or g.user_id is not null
          or (
            c.sensitivity = 'standard'
            and (
              c.visibility = 'organisation'
              or (
                c.visibility = 'department'
                and (c.department_id = viewer.department_id or viewer.role in ('owner', 'admin'))
              )
            )
          )
        )
      order by c.created_at desc
      limit 200`,
    [member.orgId, member.user.id, member.retentionDays],
  );

  if (!accessible.rows.length) {
    await audit({
      req,
      orgId: member.orgId,
      actorId: member.user.id,
      action: "memory.query",
      metadata: { question, considered: 0, used: 0, cited: [] },
    });
    sendJson(res, 200, {
      answer: "No meetings that you can access were found inside this organisation's retention window.",
      timeline: [],
      recorded: [],
      inferences: [],
      reasonMissing: false,
      reasonNote: "",
      sources: [],
      scope: {
        role: member.role,
        retentionDays: member.retentionDays,
        considered: 0,
        used: 0,
        provider: "none",
        model: "none",
      },
    });
    return;
  }

  const terms = questionTerms(question);
  const scored = accessible.rows.map((row) => {
    const notesText = notesToText(row.notes);
    const transcriptText = transcriptToText(row.transcript);
    let score = 0;
    for (const term of terms) {
      score += 6 * Math.min(3, occurrences(row.title, term));
      score += 3 * Math.min(4, occurrences(notesText, term));
      score += Math.min(6, occurrences(transcriptText, term));
    }
    return { row, notesText, transcriptText, score };
  });

  const matched = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  const selected = (matched.length ? matched : scored).slice(0, 14);
  selected.sort((a, b) => new Date(a.row.created_at).getTime() - new Date(b.row.created_at).getTime());

  const records = selected.map(({ row, notesText, transcriptText }) => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    date: new Date(row.created_at).toISOString().slice(0, 10),
    department: row.department_name,
    visibility: row.visibility,
    sensitivity: row.sensitivity,
    owner: row.owner_name,
    notes: row.notes,
    notesText: notesText.slice(0, 8_000),
    transcriptText: transcriptText.slice(0, 5_000),
  }));

  try {
    const answer = await answerOrganisationMemory({ question, records });
    const sourceMap = new Map(
      selected.map(({ row }) => [
        row.id,
        {
          id: row.id,
          title: row.title,
          kind: row.kind,
          date: new Date(row.created_at).toISOString(),
          department: row.department_name ?? null,
          sensitivity: row.sensitivity,
          owner: row.owner_name || "",
        },
      ]),
    );
    const cited = new Set([
      ...answer.timeline.flatMap((item) => item.sourceIds),
      ...answer.recorded.flatMap((item) => item.sourceIds),
    ]);
    const sources = [...cited].flatMap((id) => (sourceMap.has(id) ? [sourceMap.get(id)] : []));

    await audit({
      req,
      orgId: member.orgId,
      actorId: member.user.id,
      action: "memory.query",
      metadata: {
        question,
        provider: answer.provider,
        considered: accessible.rows.length,
        used: selected.length,
        cited: sources.map((source) => source.id),
        reasonMissing: answer.reasonMissing,
      },
    });

    sendJson(res, 200, {
      answer: answer.answer,
      timeline: answer.timeline,
      recorded: answer.recorded,
      inferences: answer.inferences,
      reasonMissing: answer.reasonMissing,
      reasonNote: answer.reasonNote,
      sources,
      scope: {
        role: member.role,
        retentionDays: member.retentionDays,
        considered: accessible.rows.length,
        used: selected.length,
        provider: answer.provider,
        model: answer.model,
      },
    });
  } catch (error) {
    await audit({
      req,
      orgId: member.orgId,
      actorId: member.user.id,
      action: "memory.query_failed",
      metadata: {
        question,
        considered: accessible.rows.length,
        used: selected.length,
        message: error instanceof Error ? error.message.slice(0, 300) : "failed",
      },
    });
    throw error;
  }
}

function orgIdFrom(req) {
  const parts = partsOf(req);
  const orgId = parse(uuid, parts[2]);
  return orgId;
}

export async function handleOrgs(req, res) {
  const parts = partsOf(req);
  if (parts.length === 2) {
    if (req.method === "GET") return listOrgs(req, res);
    if (req.method === "POST") return createOrg(req, res);
    requireMethod(req, ["GET", "POST"]);
  }

  const orgId = parse(uuid, parts[2]);
  const tail = parts.slice(3);

  if (!tail.length) {
    if (req.method === "GET") return getOrg(req, res);
    if (req.method === "PATCH") return updateOrg(req, res);
    requireMethod(req, ["GET", "PATCH"]);
  }

  if (tail.length === 1) {
    if (tail[0] === "departments") return createDepartment(req, res);
    if (tail[0] === "members") return addMember(req, res);
    if (tail[0] === "shares") return getShares(req, res);
    if (tail[0] === "captures") return shareCapture(req, res);
    if (tail[0] === "audit") return getAudit(req, res);
    if (tail[0] === "memory") return queryMemory(req, res);
  }

  if (tail.length === 2) {
    if (tail[0] === "members") {
      if (req.method === "PATCH") return updateMember(req, res);
      if (req.method === "DELETE") return removeMember(req, res);
      requireMethod(req, ["PATCH", "DELETE"]);
    }
    if (tail[0] === "captures") {
      if (req.method === "GET") return viewCapture(req, res);
      if (req.method === "DELETE") return unshareCapture(req, res);
      requireMethod(req, ["GET", "DELETE"]);
    }
  }

  throw new HttpError(404, "That organisation route was not found.");
}
