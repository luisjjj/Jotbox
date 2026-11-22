import { query } from "./pg.mjs";

/**
 * The organisation glossary is the list of names, acronyms and project words
 * that readers keep getting wrong. Enterprise captures send the top terms to
 * Scribe as keyterms; other plans keep the list for their own editor but do
 * not pay for keyterm tuning.
 */

const MAX_GLOSSARY_TERMS = 100;
const MAX_TERM_LENGTH = 50;

export function cleanGlossaryTerm(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERM_LENGTH);
}

export function glossaryTerms(rows, limit = MAX_GLOSSARY_TERMS) {
  const seen = new Set();
  const terms = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const term = cleanGlossaryTerm(row?.term ?? row);
    if (term.length < 2) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= limit) break;
  }
  return terms;
}

export async function glossaryForUser(userId, { limit = MAX_GLOSSARY_TERMS } = {}) {
  const result = await query(
    `select g.term
       from org_glossary g
       join org_members m on m.org_id = g.org_id
       join organisations o on o.id = g.org_id
      where m.user_id = $1
        and o.plan = 'enterprise'
      order by g.weight desc, g.created_at desc
      limit $2`,
    [userId, Math.max(1, Math.min(MAX_GLOSSARY_TERMS, Number(limit) || MAX_GLOSSARY_TERMS))],
  );
  return glossaryTerms(result.rows);
}

export async function listGlossary(orgId) {
  const result = await query(
    `select id, term, weight, created_at
       from org_glossary
      where org_id = $1
      order by weight desc, created_at desc
      limit $2`,
    [orgId, MAX_GLOSSARY_TERMS],
  );
  return result.rows.map((row) => ({
    id: row.id,
    term: row.term,
    weight: Number(row.weight) || 0,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
