export type SessionKind = "meeting" | "seminar" | "lecture" | "voice";

export type CaptureSource = "mic" | "tab" | "upload";

export interface TranscriptLine {
  id: string;
  text: string;
  at: number;
  speaker?: string;
}

export interface ActionItem {
  id: string;
  text: string;
  owner: string;
  done: boolean;
}

export interface NoteSection {
  heading: string;
  bullets: string[];
}

export interface SessionNotes {
  summary: string;
  highlights: string[];
  decisions?: string[];
  actions: ActionItem[];
  sections: NoteSection[];
  source: "studio" | "browser";
}

export type SessionStatus = "live" | "processing" | "ready" | "failed";

export interface Participant {
  id: string;
  name: string;
  external?: boolean;
}

export interface LiveInsights {
  decisions: string[];
  actions: { text: string; owner: string }[];
}

export interface Session {
  id: string;
  title: string;
  kind: SessionKind;
  createdAt: number;
  durationSec: number;
  status: SessionStatus;
  scratch: string;
  transcript: TranscriptLine[];
  notes: SessionNotes | null;
  hasAudio: boolean;
  error?: string;
  participants?: Participant[];
  live?: LiveInsights;
}

export interface SttWord {
  text: string;
  start: number;
  end: number;
  speaker?: number;
}
