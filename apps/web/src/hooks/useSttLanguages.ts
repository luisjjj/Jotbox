import { useEffect, useState } from "react";

const FALLBACK = ["en", "pcm", "yo", "ha"];

let cached: string[] | null = null;
let inflight: Promise<string[]> | null = null;

function check() {
  if (!inflight) {
    inflight = fetch("/api/health")
      .then(async (response) => {
        if (!response.ok) return FALLBACK;
        const data = (await response.json()) as { languages?: unknown };
        return Array.isArray(data.languages) && data.languages.length
          ? data.languages.filter((value): value is string => typeof value === "string")
          : FALLBACK;
      })
      .catch(() => FALLBACK)
      .then((value) => {
        cached = value;
        inflight = null;
        return value;
      });
  }
  return inflight;
}

export function useSttLanguages() {
  const [languages, setLanguages] = useState<string[] | null>(cached);

  useEffect(() => {
    let alive = true;
    void check().then((value) => {
      if (alive) setLanguages(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return languages;
}
