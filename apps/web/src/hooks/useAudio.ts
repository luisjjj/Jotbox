import { useEffect, useState } from "react";
import { loadAudio } from "@/lib/audioStore";
import { api } from "@/lib/api";

export function useAudioUrl(sessionId: string | null, hasAudio: boolean) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !hasAudio) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;

    const useStored = async () => {
      try {
        const { url: signed } = await api.getCaptureAudioUrl(sessionId);
        if (!cancelled) setUrl(signed);
      } catch {
        if (!cancelled) setUrl(null);
      }
    };

    void loadAudio(sessionId)
      .then((blob) => {
        if (cancelled) return;
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
          return;
        }
        return useStored();
      })
      .catch(() => {
        if (!cancelled) void useStored();
      });

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
