export type IslandStatus = "idle" | "recording" | "paused" | "processing";

export interface IslandLine {
  speaker?: string;
  text: string;
}

export interface IslandState {
  status: IslandStatus;
  elapsed: number;
  title: string;
  interim: string;
  lines: IslandLine[];
  captions: boolean;
  kind: string;
  level: number;
  at: number;
}

export type IslandCommand = "pause" | "resume" | "stop" | "toggle-listen" | "open";

export interface JotBoxDesktopBridge {
  isDesktop: true;
  platform: string;
  version: string;
  publishState: (state: IslandState) => void;
  onState: (listener: (state: IslandState) => void) => () => void;
  onCommand: (listener: (command: IslandCommand) => void) => () => void;
  command: (command: IslandCommand) => void;
  setInteractive: (interactive: boolean) => void;
  openMain: () => void;
}

declare global {
  interface Window {
    jotboxDesktop?: JotBoxDesktopBridge;
  }
}

export function desktopBridge() {
  if (typeof window === "undefined") return undefined;
  return window.jotboxDesktop;
}

export function isDesktop() {
  return Boolean(desktopBridge()?.isDesktop);
}
