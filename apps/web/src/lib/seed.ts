import { sampleSessions } from "./samples";
import { useSessions } from "./store";

export function loadSampleSessions() {
  for (const session of sampleSessions()) {
    useSessions.getState().upsert(session);
  }
}

export function isSample(id: string) {
  return id.startsWith("sample-");
}
