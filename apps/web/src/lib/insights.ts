import type { LiveInsights, Session, TranscriptLine } from "./types";

const DECISION =
  /\b(we agreed|we decided|we settled|the decision|decision is|make we|we go|we will|we'll|no wahala|conclusion|final word)\b/i;
const ACTION =
  /\b(i go|you go|i'll|i will|we'll|we will|send|share|follow up|confirm|check|prepare|submit|call|email|review|make sure|before|by (monday|tuesday|wednesday|thursday|friday|tomorrow|next week))\b/i;
const NOISE = /^(okay|ok|yeah|yes|no|hmm|ah|so|well|alright)[\s,.!?]*$/i;

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
}

function candidate(text: string) {
  const value = clean(text);
  if (value.length < 12 || value.length > 220 || NOISE.test(value)) return "";
  return value;
}

function ownerFor(text: string) {
  if (/\b(i go|i'll|i will|i need to|my own)\b/i.test(text)) return "You";
  if (/\b(make we|we'll|we will|our side)\b/i.test(text)) return "Team";
  return "Unassigned";
}

export function localInsights(lines: TranscriptLine[]): LiveInsights {
  const decisions: string[] = [];
  const actions: { text: string; owner: string }[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const text = candidate(line.text);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;

    if (DECISION.test(text) && decisions.length < 4) {
      seen.add(key);
      decisions.push(text);
      continue;
    }
    if (ACTION.test(text) && actions.length < 4) {
      seen.add(key);
      actions.push({ text, owner: line.speaker || ownerFor(text) });
    }
  }

  return { decisions, actions };
}

function pushUnique(target: string[], values: string[], limit: number) {
  for (const value of values) {
    if (target.length >= limit) break;
    if (!target.some((item) => item.toLowerCase() === value.toLowerCase())) target.push(value);
  }
}

export function mergeInsights(current: LiveInsights, next: LiveInsights): LiveInsights {
  const decisions: string[] = [];
  const actions: { text: string; owner: string }[] = [];
  pushUnique(decisions, current.decisions, 6);
  pushUnique(decisions, next.decisions, 6);
  for (const action of [...current.actions, ...next.actions]) {
    if (actions.length >= 6) break;
    if (!actions.some((item) => item.text.toLowerCase() === action.text.toLowerCase())) actions.push(action);
  }
  return { decisions, actions };
}

export function insightsCount(insights: LiveInsights) {
  return insights.decisions.length + insights.actions.length;
}

export async function requestInsights(session: Session, existing: LiveInsights): Promise<LiveInsights> {
  try {
    const response = await fetch("/api/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "insights",
        existing,
        session: {
          title: session.title,
          kind: session.kind,
          notes: session.notes,
          transcript: session.transcript.map((line) => ({
            at: line.at,
            speaker: line.speaker,
            text: line.text,
          })),
        },
      }),
    });
    if (!response.ok) throw new Error("insights");
    const data = (await response.json()) as Partial<LiveInsights>;
    return {
      decisions: Array.isArray(data.decisions) ? data.decisions.filter((item) => typeof item === "string") : [],
      actions: Array.isArray(data.actions)
        ? data.actions.filter((item) => item && typeof item.text === "string" && item.text.trim())
        : [],
    };
  } catch {
    return { decisions: [], actions: [] };
  }
}
