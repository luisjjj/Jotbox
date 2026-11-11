import { useEffect, useState } from "react";
import { studioAvailable } from "@/lib/buildNotes";

let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

function check() {
  if (!inflight) {
    inflight = studioAvailable().then((value) => {
      cached = value;
      inflight = null;
      return value;
    });
  }
  return inflight;
}

export function useStudio() {
  const [available, setAvailable] = useState<boolean | null>(cached);

  useEffect(() => {
    let alive = true;
    void check().then((value) => {
      if (alive) setAvailable(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return available;
}

export function refreshStudio() {
  cached = null;
  inflight = null;
  return check();
}
