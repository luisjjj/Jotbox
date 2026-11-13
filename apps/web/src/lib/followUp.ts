import { format } from "date-fns";
import { transcriptText } from "./format";
import { OUTPUT_PRESETS } from "./presets";
import type { Session } from "./types";

export type FollowUpChannel = "whatsapp" | "email" | "recap";
export type FollowUpLanguage = "english" | "pidgin";

export interface FollowUpResult {
  text: string;
  provider: string;
}

function actionLines(session: Session) {
  const actions = session.notes?.actions.filter((action) => !action.done) ?? [];
  return actions.map((action) => `- ${action.owner && action.owner !== "Unassigned" ? `${action.owner}: ` : ""}${action.text}`);
}

function summaryFor(session: Session) {
  const summary = session.notes?.summary.trim();
  if (summary) return summary;
  const scratch = session.scratch.trim();
  if (scratch) return scratch.split("\n").filter(Boolean).slice(0, 4).join(" ");
  return "No written summary yet. Open the notes before you send this on.";
}

export const CHANNEL_LABEL: Record<FollowUpChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  recap: "Recap",
};

export const LANGUAGE_LABEL: Record<FollowUpLanguage, string> = {
  english: "English",
  pidgin: "Pidgin",
};

export function localFollowUp(session: Session, channel: FollowUpChannel, language: FollowUpLanguage): FollowUpResult {
  const preset = OUTPUT_PRESETS[session.kind];
  const summary = summaryFor(session);
  const actions = actionLines(session);
  const actionBlock = actions.length ? actions.join("\n") : "- No open actions were written down.";
  const date = format(session.createdAt, "d MMM yyyy");
  let text = "";

  if (language === "pidgin") {
    if (channel === "whatsapp") {
      text = [
        `How far. Here is wetin we talk about for "${session.title}" (${date}).`,
        "",
        summary,
        "",
        "Wetin dey next:",
        actionBlock,
        "",
        "No wahala.",
      ].join("\n");
    } else if (channel === "email") {
      text = [
        `Subject: ${preset.followUpSubject}: ${session.title}`,
        "",
        "Hello,",
        "",
        `See the recap from ${date}:`,
        "",
        summary,
        "",
        "Wetin dey next:",
        actionBlock,
        "",
        "Thank you.",
      ].join("\n");
    } else {
      text = [`${session.title} (${date})`, "", summary, "", "Wetin dey next:", actionBlock].join("\n");
    }
  } else if (channel === "whatsapp") {
    text = [`*${session.title}*`, date, "", summary, "", "*Next steps*", actionBlock].join("\n");
  } else if (channel === "email") {
    text = [
      `Subject: ${preset.followUpSubject}: ${session.title}`,
      "",
      "Hello,",
      "",
      `Here is the recap from ${date}.`,
      "",
      summary,
      "",
      "Next steps:",
      actionBlock,
      "",
      "Thanks.",
    ].join("\n");
  } else {
    text = [`${session.title} (${date})`, "", summary, "", "Next steps:", actionBlock].join("\n");
  }

  return { text, provider: "device" };
}

export async function draftFollowUp(input: {
  session: Session;
  channel: FollowUpChannel;
  language: FollowUpLanguage;
}): Promise<FollowUpResult> {
  const { session, channel, language } = input;
  try {
    const response = await fetch("/api/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "followup",
        channel,
        language,
        session: {
          title: session.title,
          kind: session.kind,
          createdAt: session.createdAt,
          notes: session.notes,
          scratch: session.scratch.slice(0, 8_000),
          transcript: transcriptText(session.transcript).slice(0, 16_000),
        },
      }),
    });
    if (!response.ok) throw new Error("followup");
    const data = (await response.json()) as { text?: string; provider?: string };
    const text = (data.text ?? "").trim();
    if (!text) throw new Error("empty");
    return { text, provider: data.provider || "studio" };
  } catch {
    return localFollowUp(session, channel, language);
  }
}
