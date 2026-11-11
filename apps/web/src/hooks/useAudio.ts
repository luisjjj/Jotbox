import { useEffect, useState } from "react";
import { loadAudio } from "@/lib/audioStore";

export function useAudioUrl(sessionId: string | null, hasAudio: boolean) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !hasAudio) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;

    void loadAudio(sessionId)
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));

    return () => {
      cancelled = true;
      if (objectUrl) {
        const stale = objectUrl;
        window.setTimeout(() => URL.revokeObjectURL(stale), 1500);
      }
    };
  }, [sessionId, hasAudio]);

  return url;
}
