export const DASHBOARD_ROLES = ["student", "seminar", "hobbyist", "team"] as const;

export type DashboardRole = (typeof DASHBOARD_ROLES)[number];

export interface RoleMeta {
  label: string;
  short: string;
  blurb: string;
  homeTitle: string;
  homeBody: string;
  focus: string[];
}

export const ROLE_META: Record<DashboardRole, RoleMeta> = {
  student: {
    label: "Student",
    short: "Lectures and study",
    blurb: "Notes from lectures, with the words your lecturer said kept right beside them.",
    homeTitle: "Built for lecture days.",
    homeBody: "Your home starts with a capture button, your latest lecture notes, and the study tools you need after class.",
    focus: [
      "Record a lecture and get notes when you stop",
      "Copy, download, or print the latest note in one tap",
      "Recent lectures stay at the top of Home",
    ],
  },
  seminar: {
    label: "Seminar",
    short: "Talks and conferences",
    blurb: "Keep up with fast talks, panels, and workshops without typing through them.",
    homeTitle: "For talks worth keeping.",
    homeBody: "Seminar Home keeps the room in view: start a capture, then find the key points and the next session nearby.",
    focus: [
      "One clear place to record talks and panels",
      "Highlights and decisions ready after each session",
      "Upcoming classes and talks when a calendar is connected",
    ],
  },
  hobbyist: {
    label: "Hobbyist",
    short: "Ideas and voice notes",
    blurb: "Capture ideas, interviews, and voice notes without a tool built for boardrooms.",
    homeTitle: "A quiet place for your ideas.",
    homeBody: "Home stays simple: record what you are thinking about, then read it back as notes when you are ready.",
    focus: [
      "Record a voice note from anywhere",
      "Notes, jottings, and spoken words in one place",
      "No organisation tools in the way",
    ],
  },
  team: {
    label: "Work and teams",
    short: "Meetings and memory",
    blurb: "The full dashboard, with organisation memory, integrations, and meeting tools.",
    homeTitle: "The full workspace is ready.",
    homeBody: "Nothing changes for work accounts. Memory, connected calendars, and organisation tools stay where they are.",
    focus: [
      "Meetings, notes, and open actions",
      "Organisation memory and Ask across the workspace",
      "Calendar, Outlook, and Jira integrations",
    ],
  },
};

export function isDashboardRole(value: string | null | undefined): value is DashboardRole {
  return DASHBOARD_ROLES.includes(value as DashboardRole);
}

export function isLeanRole(role: DashboardRole | null | undefined) {
  return role === "student" || role === "seminar" || role === "hobbyist";
}

export function roleLabel(role: DashboardRole | null | undefined) {
  return isDashboardRole(role) ? ROLE_META[role].label : ROLE_META.team.label;
}
