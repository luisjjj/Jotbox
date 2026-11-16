import type { Session, SessionKind } from "./types";

export interface BriefPrevious {
  title: string;
  at: number;
  summary: string;
  decisions: string[];
  actions: { text: string; owner: string; done: boolean }[];
}

export interface BriefRequest {
  title: string;
  kind: SessionKind;
  previous: BriefPrevious;
}

export interface BriefResult {
  bullets: string[];
  source: "ai" | "local";
}

const RECURRING_STOP = new Set(
  "the and for with our your a an of to in on at by weekly daily monthly every meeting meetings sync standup check review call team".split(
    " ",
  ),
);

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string) {
  return normalized(value)
    .split(" ")
    .filter((word) => word.length > 2 && !RECURRING_STOP.has(word));
}

function titleScore(candidate: string, wanted: string) {
  const left = normalized(candidate);
  const right = normalized(wanted);
  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.includes(right) || right.includes(left)) {
    const [short, long] = left.length <= right.length ? [left, right] : [right, left];
    return short.length >= 4 && short.length / long.length >= 0.4 ? 82 : 40;
  }
  const wantedWords = new Set(words(wanted));
  const candidateWords = new Set(words(candidate));
  let overlap = 0;
  for (const word of wantedWords) {
    if (candidateWords.has(word)) overlap += 1;
  }
  if (!overlap) return 0;
  const ratio = overlap / Math.max(wantedWords.size, candidateWords.size);
  return 25 + Math.round(ratio * 45);
}

/**
 * Finds the earlier capture a new one is continuing: same kind, newest first,
 * with the title carrying the match. An empty title falls back to the latest
 * capture of the same kind.
 */
export function previousSessionFor(
  sessions: Session[],
  { title, kind }: { title: string; kind: SessionKind },
): Session | null {
  const candidates = sessions
    .filter((session) => session.status === "ready" && session.kind === kind && session.notes)
    .sort((a, b) => b.createdAt - a.createdAt);

  const wanted = title.trim();
  if (!wanted) return candidates[0] ?? null;

  let best: Session | null = null;
  let bestScore = 0;
  for (const session of candidates) {
    const score = titleScore(session.title, wanted);
    if (score > bestScore) {
      best = session;
      bestScore = score;
    }
  }
  return bestScore >= 40 ? best : null;
}

export function toBriefPrevious(session: Session): BriefPrevious {
  const notes = session.notes;
  return {
    title: session.title,
    at: session.createdAt,
    summary: notes?.summary ?? "",
    decisions: (notes?.decisions ?? []).filter((item) => typeof item === "string" && item.trim()),
    actions: (notes?.actions ?? []).map((action) => ({
      text: action.text,
      owner: action.owner,
      done: action.done,
    })),
  };
}

function clean(value: string, limit = 240) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit) : text;
}

export function localBrief(previous: BriefPrevious): string[] {
  const bullets: string[] = [];
  const push = (value: string) => {
    const text = clean(value);
    if (!text) return;
    if (bullets.some((item) => item.toLowerCase() === text.toLowerCase())) return;
    bullets.push(text);
  };

  for (const action of previous.actions) {
    if (bullets.length >= 3) break;
    if (action.done) continue;
    const owner = action.owner && action.owner !== "Unassigned" ? `${action.owner}: ` : "";
    push(`${owner}${action.text}`);
  }
  for (const decision of previous.decisions) {
    if (bullets.length >= 3) break;
    push(decision);
  }
  if (!bullets.length) push(previous.summary);
  return bullets.slice(0, 3);
}

export async function requestPreMeetingBrief(input: BriefRequest): Promise<BriefResult> {
  const fallback = localBrief(input.previous);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const response = await fetch("/api/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        mode: "brief",
        brief: {
          title: input.title,
          kind: input.kind,
          previous: input.previous,
        },
      }),
    }).finally(() => clearTimeout(timer));
    if (!response.ok) throw new Error("brief");
    const data = (await response.json()) as { bullets?: unknown };
    const bullets = Array.isArray(data.bullets)
      ? data.bullets
          .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
          .map((item) => clean(item))
          .slice(0, 3)
      : [];
    if (!bullets.length) throw new Error("empty");
    return { bullets, source: "ai" };
  } catch {
    return { bullets: fallback, source: "local" };
  }
}
