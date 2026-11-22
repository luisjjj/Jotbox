import { query } from "./pg.mjs";

/**
 * Decisions and actions are copied out of finished notes so the memory chat
 * can suggest open follow-ups without re-reading every meeting. Rebuilding a
 * capture's rows is idempotent: the old rows are replaced from the current
 * notes, so a regenerated summary cannot leave a stale action behind.
 */

const MAX_TEXT = 4_000;
const MAX_OWNER = 160;
const MAX_ITEMS = 400;

function clean(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function dueDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : text;
}

export function insightsFromNotes(notes) {
  if (!notes || typeof notes !== "object") return [];
  const items = [];

  for (const decision of Array.isArray(notes.decisions) ? notes.decisions : []) {
    const text = clean(decision, MAX_TEXT);
    if (text) items.push({ kind: "decision", text, ownerLabel: "", dueDate: null, status: "completed" });
    if (items.length >= MAX_ITEMS) break;
  }

  for (const action of Array.isArray(notes.actions) ? notes.actions : []) {
    const text = clean(action?.text, MAX_TEXT);
    if (!text) continue;
    items.push({
      kind: "action",
      text,
      ownerLabel: clean(action?.owner, MAX_OWNER),
      dueDate: dueDate(action?.due),
      status: action?.done ? "completed" : "open",
    });
    if (items.length >= MAX_ITEMS) break;
  }

  return items;
}

export async function syncMeetingInsights(db, capture) {
  const captureId = capture?.id;
  if (!captureId) return 0;
  await db.query("delete from meeting_insights where capture_id = $1", [captureId]);
  if (!capture.org_id) return 0;
  const items = insightsFromNotes(capture.notes);
  if (!items.length) return 0;
  const rows = items.map((item) => ({
    kind: item.kind,
    text: item.text,
    owner_label: item.ownerLabel,
    due_date: item.dueDate,
    status: item.status,
  }));
  await db.query(
    `insert into meeting_insights
       (capture_id, org_id, owner_id, kind, text, owner_label, due_date, status)
     select $1, $2, $3, row.kind, row.text, row.owner_label, row.due_date::date, row.status
       from jsonb_to_recordset($4::jsonb)
         as row(kind text, text text, owner_label text, due_date date, status text)`,
    [captureId, capture.org_id, capture.user_id, JSON.stringify(rows)],
  );
  return items.length;
}

export async function openInsights(userId, orgId, { days = 30, limit = 8 } = {}) {
  const result = await query(
    `select i.id, i.capture_id, i.text, i.owner_label, i.due_date, i.created_at,
            c.title as capture_title, c.created_at as capture_date,
            d.name as department_name
       from meeting_insights i
       join captures c on c.id = i.capture_id
       join org_members viewer on viewer.org_id = c.org_id and viewer.user_id = $1
       left join departments d on d.id = c.department_id
       left join capture_grants g on g.capture_id = c.id and g.user_id = $1
      where c.org_id = $2
        and i.status = 'open'
        and i.kind = 'action'
        and c.status = 'ready'
        and c.created_at > now() - ($3::int * interval '1 day')
        and (
          c.user_id = $1
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
      order by i.due_date nulls last, c.created_at desc
      limit $4`,
    [userId, orgId, Math.max(1, Math.min(365, Number(days) || 30)), Math.max(1, Math.min(50, Number(limit) || 8))],
  );
  return result.rows.map((row) => ({
    id: row.id,
    captureId: row.capture_id,
    text: row.text,
    owner: row.owner_label || "",
    dueDate: row.due_date ? new Date(row.due_date).toISOString().slice(0, 10) : null,
    title: row.capture_title,
    date: new Date(row.capture_date).toISOString().slice(0, 10),
    department: row.department_name ?? null,
  }));
}
