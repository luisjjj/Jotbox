import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { ApiError, api } from "@/lib/api";
import { saveAudio } from "@/lib/audioStore";
import { conditionStream, shapeRoomAudio } from "@/lib/audioConditioning";
import { buildNotes, studioAvailable } from "@/lib/buildNotes";
import { clearCaptureNotice, showCaptureNotice } from "@/lib/captureNotice";
import { desktopBridge } from "@/lib/desktop";
import { defaultTitle, formatClock } from "@/lib/format";
import { insightsCount, localInsights, mergeInsights, requestInsights } from "@/lib/insights";
import { closeLiveSession, liveExpired } from "@/lib/lifecycle";
import { chunkHasSpeech, createLevelWindow, isPauseForBoundary, noteLevel, type LiveLevelWindow } from "@/lib/liveGate";
import { transcribeChunk } from "@/lib/liveTranscribe";
import { stripLiveProfanity } from "@/lib/profanity";
import {
  focusContext,
  getFocusMode,
  getPickupMode,
  getSessionLanguage,
  isNoiseLine,
  isOffTopic,
  pickupConstraints,
} from "@/lib/listening";
import { useSessions } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { ensureUsage, refreshUsage, useUsage } from "@/lib/usageStore";
import { limitReachedMessage, uploadTooLongMessage } from "@/lib/planLimitCopy";
import { withProcessingTimeout } from "@/lib/processing";
import posthog, { posthogEnabled } from "@/lib/posthog";
import type { CaptureSource, LiveInsights, Participant, Session, SessionKind, TranscriptLine } from "@/lib/types";

type EngineStatus = "idle" | "recording" | "paused" | "processing";

type JobOutcome =
  | { state: "done"; title: string; lines: TranscriptLine[]; notes: NonNullable<Session["notes"]> }
  | { state: "failed"; message: string }
  | { state: "pending" }
  | { state: "unavailable" };

interface JobProgress {
  title: string;
  lines: TranscriptLine[];
}

const JOB_POLL_MS = 700;
const JOB_POLL_SLOW_MS = 2500;
const JOB_POLL_SLOW_AFTER_MS = 2 * 60_000;
// Long recordings can take a while to transcribe. Past this point the session
// page takes over the polling, so the wait never dies with the capture screen.
const JOB_POLL_MAX_MS = 25 * 60_000;

interface SpeechAlternative {
  transcript: string;
}

interface SpeechResult {
  isFinal: boolean;
  0: SpeechAlternative;
}

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}

interface SpeechRec extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface StartOptions {
  kind: SessionKind;
  source: Exclude<CaptureSource, "upload">;
  title?: string;
  participants?: Participant[];
}

interface EngineValue {
  status: EngineStatus;
  sessionId: string | null;
  kind: SessionKind;
  source: CaptureSource | null;
  title: string;
  scratch: string;
  lines: TranscriptLine[];
  live: LiveInsights;
  participants: Participant[];
  interim: string;
  elapsed: number;
  freeRemainingSec: number | null;
  error: string | null;
  captions: boolean;
  pip: Window | null;
  getLevel: () => number;
  start: (options: StartOptions) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  setScratch: (value: string) => void;
  setParticipants: (people: Participant[]) => void;
  setTitle: (value: string) => void;
  setKind: (kind: SessionKind) => void;
  importFile: (file: File, kind: SessionKind, participants?: Participant[]) => Promise<void>;
  pin: () => Promise<void>;
  clearError: () => void;
}

const EngineContext = createContext<EngineValue | null>(null);

function speechCtor() {
  const host = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

function messageFor(error: unknown, source: CaptureSource) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "NotFoundError") {
    return source === "tab"
      ? "The share was cancelled. Share the Meet or Zoom tab and tick share audio."
      : "Allow the microphone from the address bar, or upload a recording instead.";
  }
  if (error instanceof Error && error.message === "no-tab-audio") {
    return "That share had no audio. Share the call tab again and tick share audio.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "This browser cannot record. Try another browser, or upload a recording.";
  }
  return "The recording could not start.";
}

function pickMime() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

// The billing status call can sit behind a cold serverless start. Capture
// should not wait for it: use the cached quota and revalidate in the
// background. The server still rejects a save that is over the limit.
async function usageSnapshot() {
  const cached = useUsage.getState();
  if (cached.loaded) {
    void refreshUsage();
    return cached;
  }
  await Promise.race([
    ensureUsage(),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 1500);
    }),
  ]);
  return useUsage.getState();
}

function audioDuration(file: File) {
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    let settled = false;
    let timer = 0;
    const done = (seconds: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
    };
    timer = window.setTimeout(() => done(0), 4000);
    audio.addEventListener("loadedmetadata", () => done(audio.duration), { once: true });
    audio.addEventListener("error", () => done(0), { once: true });
    audio.preload = "metadata";
    audio.src = url;
  });
}

// Electron has no Web Speech API, so the desktop app sends short standalone
// chunks to the same transcription endpoint the final pass uses. Five seconds
// keeps the committed lines close to the room without cutting so much context
// that the reader loses accuracy. At the five second mark the segment waits for
// the next gap in speech, up to the hard cap, so a word is not sliced in half.
const LIVE_SEGMENT_MS = 5_000;
const LIVE_BOUNDARY_WINDOW_MS = 1_200;
const LIVE_QUEUE_LIMIT = 3;
// Server chunks arrive as a whole sentence. Reveal them a word at a time so
// the transcript keeps the rhythm of the room instead of jumping.
const LIVE_REVEAL_MS = 55;

interface ServerLive {
  active: boolean;
  generation: number;
  recorder: MediaRecorder | null;
  timer: number;
  closing: boolean;
  queue: Blob[];
  sending: boolean;
  failures: number;
  level: LiveLevelWindow;
}

function copyStyles(target: Document) {
  document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    target.head.appendChild(node.cloneNode(true));
  });
  target.documentElement.className = document.documentElement.className;
  target.title = "JotBox";
  const style = target.createElement("style");
  style.textContent =
    "html,body{height:100%;margin:0;background:transparent!important;color:var(--ink);overflow:hidden;}";
  target.head.appendChild(style);
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const desktop = desktopBridge();
  const lastKind = useSessions((state) => state.lastKind);
  const theme = useTheme();
  const [status, setStatus] = useState<EngineStatus>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [kind, setKindState] = useState<SessionKind>(lastKind);
  const [source, setSource] = useState<CaptureSource | null>(null);
  const [title, setTitleState] = useState("");
  const [scratch, setScratchState] = useState("");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [live, setLive] = useState<LiveInsights>({ decisions: [], actions: [] });
  const [participants, setParticipantsState] = useState<Participant[]>([]);
  const [interim, setInterim] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [captions, setCaptions] = useState(true);
  const [pip, setPip] = useState<Window | null>(null);
  const [allowance, setAllowance] = useState<{ limit: number; baseline: number } | null>(null);

  const statusRef = useRef<EngineStatus>("idle");
  const startingRef = useRef(false);
  const idRef = useRef<string | null>(null);
  const kindRef = useRef(kind);
  const titleRef = useRef("");
  const titleTouched = useRef(false);
  const scratchRef = useRef("");
  const linesRef = useRef<TranscriptLine[]>([]);
  const createdRef = useRef(0);
  const elapsedRef = useRef(0);
  const tickStart = useRef<number | null>(null);
  const levelRef = useRef(0.05);
  const scratchTimer = useRef(0);
  const chunks = useRef<Blob[]>([]);
  const mimeRef = useRef("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const serverLiveRef = useRef<ServerLive>({
    active: false,
    generation: 0,
    recorder: null,
    timer: 0,
    closing: false,
    queue: [],
    sending: false,
    failures: 0,
    level: createLevelWindow(),
  });
  const speechRef = useRef<SpeechRec | null>(null);
  const previewRef = useRef<SpeechRec | null>(null);
  const revealRef = useRef({ timer: 0, queue: [] as string[], active: false, text: "" });
  const listenRef = useRef(false);
  const liveFallbackRef = useRef<(() => void) | null>(null);
  const stopStreamRef = useRef<() => void>(() => {});
  const analyserRef = useRef<AnalyserNode | null>(null);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const titledRef = useRef(false);
  const pipRef = useRef<Window | null>(null);
  const liveRef = useRef<LiveInsights>({ decisions: [], actions: [] });
  const participantsRef = useRef<Participant[]>([]);
  const insightBusy = useRef(false);
  const insightAt = useRef(0);
  const insightCount = useRef(0);
  const allowanceRef = useRef<{ limit: number; baseline: number } | null>(null);

  const setStatusBoth = (next: EngineStatus) => {
    statusRef.current = next;
    setStatus(next);
  };

  const setAllowanceBoth = (next: { limit: number; baseline: number } | null) => {
    allowanceRef.current = next;
    setAllowance(next);
  };

  const currentElapsed = () => {
    if (!tickStart.current) return elapsedRef.current;
    return elapsedRef.current + (Date.now() - tickStart.current) / 1000;
  };

  const persistLive = useCallback(() => {
    const id = idRef.current;
    if (!id || (statusRef.current !== "recording" && statusRef.current !== "paused")) return;
    useSessions.getState().upsert({
      id,
      title: titleRef.current || defaultTitle(kindRef.current),
      kind: kindRef.current,
      createdAt: createdRef.current,
      durationSec: currentElapsed(),
      status: "live",
      scratch: scratchRef.current,
      transcript: linesRef.current,
      notes: null,
      hasAudio: false,
      live: liveRef.current,
      participants: participantsRef.current,
    });
  }, []);

  const reset = () => {
    idRef.current = null;
    titleRef.current = "";
    titleTouched.current = false;
    scratchRef.current = "";
    linesRef.current = [];
    liveRef.current = { decisions: [], actions: [] };
    participantsRef.current = [];
    insightCount.current = 0;
    setLive({ decisions: [], actions: [] });
    setParticipantsState([]);
    elapsedRef.current = 0;
    tickStart.current = null;
    chunks.current = [];
    setAllowanceBoth(null);
    clearReveal();
    setSessionId(null);
    setTitleState("");
    setScratchState("");
    setLines([]);
    setInterim("");
    setElapsed(0);
    setSource(null);
    setCaptions(true);
    setStatusBoth("idle");
  };

  const openStream = async (nextSource: Exclude<CaptureSource, "upload">) => {
    let audioContext: AudioContext | null = null;
    try {
      audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      void audioContext.resume().catch(() => undefined);
    } catch {
      audioContext = null;
      analyserRef.current = null;
    }

    const analyser = analyserRef.current;
    const closeContext = () => {
      analyserRef.current = null;
      void audioContext?.close().catch(() => undefined);
    };

    const pickup = getPickupMode();

    if (nextSource === "mic") {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: pickupConstraints(pickup) });
      let recorded = mic;
      if (audioContext) {
        const running =
          audioContext.state === "running" ||
          (await Promise.race<boolean>([
            audioContext
              .resume()
              .then(() => audioContext.state === "running")
              .catch(() => false),
            new Promise<boolean>((resolve) => {
              window.setTimeout(() => resolve(audioContext.state === "running"), 600);
            }),
          ]));
        if (running) {
          try {
            recorded = conditionStream(mic, audioContext, pickup);
          } catch {
            recorded = mic;
          }
        }
      }
      if (audioContext && analyser) {
        try {
          audioContext.createMediaStreamSource(recorded).connect(analyser);
        } catch {
          /* metering only; the raw microphone still records */
        }
      }
      stopStreamRef.current = () => {
        mic.getTracks().forEach((track) => track.stop());
        closeContext();
      };
      return recorded;
    }

    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const tabAudio = display.getAudioTracks();
    if (!tabAudio.length) {
      display.getTracks().forEach((track) => track.stop());
      closeContext();
      throw new Error("no-tab-audio");
    }
    const tabStream = new MediaStream(tabAudio);

    let mic: MediaStream | null = null;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: pickupConstraints(pickup) });
    } catch {
      mic = null;
    }

    display.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (statusRef.current === "recording" || statusRef.current === "paused") void stopRef.current();
    });

    const cleanup = () => {
      display.getTracks().forEach((track) => track.stop());
      mic?.getTracks().forEach((track) => track.stop());
      closeContext();
    };

    const mix = (() => {
      if (!audioContext || !analyser) return null;
      try {
        const destination = audioContext.createMediaStreamDestination();
        const bus = audioContext.createGain();
        audioContext.createMediaStreamSource(tabStream).connect(bus);
        if (mic) {
          const micGain = audioContext.createGain();
          micGain.gain.value = pickup === "far" ? 1.35 : 1;
          audioContext.createMediaStreamSource(mic).connect(micGain);
          micGain.connect(bus);
        }
        const output = shapeRoomAudio(bus, audioContext, pickup);
        output.connect(destination);
        output.connect(analyser);
        return destination.stream;
      } catch {
        return null;
      }
    })();

    if (mix && audioContext) {
      const context = audioContext;
      const running =
        context.state === "running" ||
        (await Promise.race<boolean>([
          context
            .resume()
            .then(() => context.state === "running")
            .catch(() => false),
          new Promise<boolean>((resolve) => {
            window.setTimeout(() => resolve(context.state === "running"), 600);
          }),
        ]));
      if (running) {
        stopStreamRef.current = cleanup;
        return mix;
      }
    }

    // The audio mixer did not start: record the shared tab directly rather than
    // handing back a silent mixed stream. Metering can still use the analyser.
    stopStreamRef.current = cleanup;
    return tabStream;
  };

  const liveLineText = (raw: string) => {
    const text = stripLiveProfanity(raw.replace(/\s+/g, " ").trim());
    if (!text) return "";
    const context = focusContext({
      title: titleRef.current,
      kind: kindRef.current,
      participants: participantsRef.current,
      scratch: scratchRef.current,
    });
    if (isOffTopic(text, context) || isNoiseLine(text)) return "";
    const last = linesRef.current[linesRef.current.length - 1];
    if (last && last.text.trim().toLowerCase() === text.toLowerCase()) return "";
    return text;
  };

  const appendLiveText = (raw: string) => {
    const text = liveLineText(raw);
    if (!text) return;
    linesRef.current = [...linesRef.current, { id: crypto.randomUUID(), text, at: currentElapsed() }];
    setLines(linesRef.current);
    setInterim("");
    persistLive();
  };

  const clearReveal = () => {
    const reveal = revealRef.current;
    if (reveal.timer) window.clearTimeout(reveal.timer);
    reveal.timer = 0;
    reveal.queue = [];
    reveal.active = false;
    reveal.text = "";
  };

  const flushReveal = () => {
    const reveal = revealRef.current;
    const partial = reveal.text;
    const pending = [...reveal.queue];
    clearReveal();
    if (partial) appendLiveText(partial);
    for (const text of pending) appendLiveText(text);
    setInterim("");
  };

  const revealNext = () => {
    const reveal = revealRef.current;
    const next = reveal.queue.shift();
    if (next === undefined) {
      reveal.active = false;
      setInterim("");
      return;
    }
    reveal.active = true;
    const words = next.split(" ");
    let shown = 0;
    const step = () => {
      if (!reveal.active) return;
      shown += 1;
      if (shown < words.length) {
        reveal.text = words.slice(0, shown).join(" ");
        setInterim(reveal.text);
        reveal.timer = window.setTimeout(step, LIVE_REVEAL_MS);
        return;
      }
      reveal.timer = 0;
      reveal.text = "";
      appendLiveText(next);
      revealNext();
    };
    step();
  };

  // Server chunks land as a finished sentence. Queue them so each one writes
  // itself out instead of appearing all at once.
  const queueLiveText = (raw: string) => {
    const text = liveLineText(raw);
    if (!text) return;
    revealRef.current.queue.push(text);
    if (!revealRef.current.active) revealNext();
  };

  const stopServerLive = () => {
    const live = serverLiveRef.current;
    live.active = false;
    live.generation += 1;
    live.closing = false;
    if (live.timer) {
      window.clearTimeout(live.timer);
      live.timer = 0;
    }
    const recorder = live.recorder;
    live.recorder = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    live.queue = [];
  };

  const closeLiveSegment = (live: ServerLive) => {
    live.closing = false;
    if (live.timer) {
      window.clearTimeout(live.timer);
      live.timer = 0;
    }
    const recorder = live.recorder;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
  };

  const pumpServerLive = async (generation: number) => {
    const live = serverLiveRef.current;
    if (live.sending) return;
    live.sending = true;
    try {
      while (live.active && live.generation === generation && live.queue.length) {
        const blob = live.queue.shift()!;
        try {
          const text = await transcribeChunk(blob, {
            title: titleRef.current || defaultTitle(kindRef.current),
            kind: kindRef.current,
            participants: participantsRef.current,
          });
          if (!live.active || live.generation !== generation) break;
          live.failures = 0;
          queueLiveText(text);
        } catch {
          live.failures += 1;
          if (live.failures >= 2) {
            const fallback = liveFallbackRef.current;
            stopServerLive();
            flushReveal();
            if (fallback) fallback();
            else setCaptions(false);
            break;
          }
        }
      }
    } finally {
      live.sending = false;
      if (live.active && live.queue.length) void pumpServerLive(live.generation);
    }
  };

  const startServerSegment = () => {
    const live = serverLiveRef.current;
    const stream = streamRef.current;
    if (!live.active || !stream) return;
    const mime = pickMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 64_000,
      });
    } catch {
      live.active = false;
      setCaptions(false);
      return;
    }
    const generation = live.generation;
    live.level = createLevelWindow();
    const parts: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) parts.push(event.data);
    };
    recorder.onstop = () => {
      // A silent segment would still bill the live pass, so only loud segments
      // go to the queue. The final pass still reads the whole recording.
      if (live.generation === generation && parts.length && chunkHasSpeech(live.level)) {
        live.queue.push(new Blob(parts, { type: recorder.mimeType || mime || "audio/webm" }));
        if (live.queue.length > LIVE_QUEUE_LIMIT) live.queue.shift();
        void pumpServerLive(generation);
      }
      if (live.active && live.generation === generation) startServerSegment();
    };
    live.recorder = recorder;
    live.closing = false;
    try {
      recorder.start();
    } catch {
      live.active = false;
      setCaptions(false);
      return;
    }
    live.timer = window.setTimeout(() => {
      if (live.recorder !== recorder || recorder.state === "inactive") return;
      live.closing = true;
      live.timer = window.setTimeout(() => {
        if (live.recorder === recorder && recorder.state !== "inactive") {
          closeLiveSegment(live);
        }
      }, LIVE_BOUNDARY_WINDOW_MS);
    }, LIVE_SEGMENT_MS);
  };

  const armServerSpeech = (onExhausted?: () => void) => {
    const live = serverLiveRef.current;
    stopServerLive();
    liveFallbackRef.current = onExhausted ?? null;
    live.active = true;
    live.failures = 0;
    startServerSegment();
  };

  const stopSpeech = (ref: { current: SpeechRec | null }) => {
    const rec = ref.current;
    ref.current = null;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
  };

  const armWebSpeech = ({ commit = true }: { commit?: boolean } = {}) => {
    const Ctor = speechCtor();
    if (!Ctor) {
      if (commit) setCaptions(false);
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-NG";
    rec.onresult = (event) => {
      let pending = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) {
          if (commit) appendLiveText(text);
          pending = "";
        } else if (!isNoiseLine(text)) {
          pending += `${text} `;
        }
      }
      // A paced server line owns the interim slot while it writes itself out.
      if (!commit && revealRef.current.active) return;
      setInterim(pending.trim());
    };
    rec.onerror = (event) => {
      setInterim("");
      if (event.error === "not-allowed" || event.error === "network" || event.error === "service-not-allowed") {
        if (speechRef.current === rec) speechRef.current = null;
        if (previewRef.current === rec) previewRef.current = null;
        if (commit) setCaptions(false);
      }
    };
    rec.onend = () => {
      if (!listenRef.current) return;
      if (speechRef.current !== rec && previewRef.current !== rec) return;
      window.setTimeout(() => {
        if (!listenRef.current) return;
        if (speechRef.current !== rec && previewRef.current !== rec) return;
        try {
          rec.start();
        } catch {
          setInterim("");
          if (commit) setCaptions(false);
        }
      }, 300);
    };
    try {
      rec.start();
      if (commit) speechRef.current = rec;
      else previewRef.current = rec;
      listenRef.current = true;
    } catch {
      if (commit) setCaptions(false);
    }
  };

  const armSpeech = () => {
    // The server reader writes the committed lines. On the web, the browser
    // speech service runs alongside it as an instant preview, so words keep
    // writing while the fresh five-second chunk is still being read.
    stopSpeech(previewRef);
    stopSpeech(speechRef);
    armServerSpeech(() => {
      stopSpeech(previewRef);
      if (!desktop) {
        setInterim("");
        armWebSpeech();
        return;
      }
      setCaptions(false);
    });
    if (!desktop) armWebSpeech({ commit: false });
  };

  const finishRecorder = () => {
    listenRef.current = false;
    stopServerLive();
    stopSpeech(previewRef);
    stopSpeech(speechRef);
    flushReveal();
    setInterim("");
    const recorder = recorderRef.current;
    const blob = new Promise<Blob>((resolve) => {
      const pack = () => new Blob(chunks.current, { type: mimeRef.current || "audio/webm" });
      if (!recorder || recorder.state === "inactive") {
        resolve(pack());
        return;
      }
      recorder.addEventListener("stop", () => resolve(pack()), { once: true });
      recorder.stop();
    });
    return blob.finally(() => {
      stopStreamRef.current();
      stopStreamRef.current = () => {};
      streamRef.current = null;
      recorderRef.current = null;
    });
  };

  /**
   * Hands the audio to the server job queue. Returns "unavailable" when the
   * server cannot take it, so the caller can fall back to the inline path.
   * "pending" means the job is still running after a long wait; the session
   * keeps its job id so the session page can finish the wait on its own.
   */
  const runServerJob = useCallback(
    async ({
      session,
      blob,
      titleIsDefault,
      onProgress,
    }: {
      session: Session;
      blob: Blob;
      titleIsDefault: boolean;
      onProgress?: (progress: JobProgress) => void;
    }): Promise<JobOutcome> => {
      try {
        await api.saveCapture(session);
        const stored = await api.uploadCaptureAudio(session.id, blob);
        let job = (
          await api.startTranscribeJob({
            id: session.id,
            title: session.title,
            kind: session.kind,
            scratch: session.scratch,
            participants: (session.participants ?? []).map((person) => person.name),
            context: {
              title: session.title,
              kind: session.kind,
              names: (session.participants ?? []).map((person) => person.name),
              focus: getFocusMode(),
              language: getSessionLanguage(),
            },
            contentType: blob.type || "audio/webm",
            audioKey: stored.key,
            titleIsDefault,
          })
        ).job;
        // Keep the job on the session. A reload, or a wait longer than this
        // screen, can then pick it up without transcribing the audio twice.
        useSessions.getState().patch(session.id, { jobId: job.id });
        const startedAt = Date.now();
        const deadline = startedAt + JOB_POLL_MAX_MS;
        let delay = 250;
        let publishedAt = 0;
        while (job.status === "queued" || job.status === "running") {
          if (Date.now() > deadline) return { state: "pending" };
          await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
          job = await api.getTranscribeJob(job.id);
          // The server publishes the words before it starts writing notes.
          // Show them right away instead of waiting for the summary.
          if (job.result?.lines.length && job.updatedAt !== publishedAt) {
            publishedAt = job.updatedAt;
            onProgress?.({
              title: job.result.title || session.title,
              lines: job.result.lines,
            });
          }
          delay = Date.now() - startedAt > JOB_POLL_SLOW_AFTER_MS ? JOB_POLL_SLOW_MS : JOB_POLL_MS;
        }
        if (job.status === "done" && job.result?.notes) {
          return {
            state: "done",
            title: job.result.title || session.title,
            lines: job.result.lines,
            notes: job.result.notes,
          };
        }
        if (job.status === "done") {
          return { state: "failed", message: "The notes came back empty. Try again from the session page." };
        }
        if (job.status === "failed") {
          return { state: "failed", message: job.error || "The notes could not be written." };
        }
        return { state: "pending" };
      } catch (error) {
        // A plan limit is final: do not spend a provider call on the fallback.
        if (error instanceof ApiError && error.status === 402) {
          return { state: "failed", message: error.message };
        }
        return { state: "unavailable" };
      }
    },
    [],
  );

  const stop = useCallback(async () => {
    if (statusRef.current !== "recording" && statusRef.current !== "paused") return;
    const id = idRef.current;
    if (!id) return;
    const pipWindow = pipRef.current;
    pipRef.current = null;
    setPip(null);
    pipWindow?.close();
    setStatusBoth("processing");
    if (tickStart.current) {
      elapsedRef.current += (Date.now() - tickStart.current) / 1000;
      tickStart.current = null;
    }
    const duration = elapsedRef.current;
    const kindNow = kindRef.current;
    const titleNow = titleRef.current || defaultTitle(kindNow);
    const scratchNow = scratchRef.current;
    const createdAt = createdRef.current;
    const titleIsDefault = !titleTouched.current;
    let blob: Blob | null = null;
    try {
      blob = await finishRecorder();
      // Keep the local copy without holding up the upload and the page turn.
      if (blob.size > 0) void saveAudio(id, blob).catch(() => undefined);
    } catch {
      blob = null;
    }
    // finishRecorder flushes any line still writing itself out, so read the
    // transcript after it runs.
    const linesNow = linesRef.current;
    const base: Session = {
      id,
      title: titleNow,
      kind: kindNow,
      createdAt,
      durationSec: duration,
      status: "processing",
      scratch: scratchNow,
      transcript: linesNow,
      notes: null,
      hasAudio: Boolean(blob && blob.size > 0),
      live: liveRef.current,
      participants: participantsRef.current,
    };
    useSessions.getState().upsert(base);
    navigate(`/session/${id}`);
    const participantsNow = participantsRef.current;
    if (blob && blob.size > 0) {
      const outcome = await runServerJob({
        session: base,
        blob,
        titleIsDefault,
        onProgress: (progress) => {
          useSessions.getState().patch(base.id, { transcript: progress.lines });
        },
      });
      if (outcome.state === "pending") {
        reset();
        return;
      }
      if (outcome.state === "done") {
        useSessions.getState().upsert({
          ...base,
          title: outcome.title,
          status: "ready",
          transcript: outcome.lines,
          notes: outcome.notes,
        });
        void refreshUsage();
        reset();
        return;
      }
      if (outcome.state === "failed") {
        useSessions.getState().upsert({
          ...base,
          status: "failed",
          error: outcome.message,
        });
        reset();
        return;
      }
    }
    // The job may already have published words before it fell back here.
    const newest = useSessions.getState().sessions.find((item) => item.id === base.id);
    const fallbackLines = newest?.transcript.length ? newest.transcript : linesNow;
    try {
      const ai = await studioAvailable();
      const result = await withProcessingTimeout(
        buildNotes({
          kind: kindNow,
          title: titleNow,
          titleIsDefault,
          scratch: scratchNow,
          lines: fallbackLines,
          audio: blob,
          ai,
          participants: participantsNow,
        }),
      );
      useSessions.getState().upsert({
        ...base,
        title: result.title,
        status: "ready",
        transcript: result.lines,
        notes: result.notes,
      });
      if (posthogEnabled) {
        posthog.capture("capture_completed", {
          capture_kind: kindNow,
          duration_sec: Math.round(duration),
        });
      }
    } catch (caught) {
      useSessions.getState().upsert({
        ...base,
        status: "failed",
        error: caught instanceof Error ? caught.message : "The notes could not be written.",
      });
    }
    reset();
  }, [navigate, runServerJob]);

  stopRef.current = stop;

  const start = useCallback(
    async (options: StartOptions) => {
      if (startingRef.current || statusRef.current !== "idle") {
        setError("Finish the current session first.");
        return;
      }
      startingRef.current = true;
      setError(null);
      const usage = await usageSnapshot();
      if (usage.loaded && !usage.unlimited && (usage.remainingSeconds ?? 0) <= 0) {
        startingRef.current = false;
        setError(limitReachedMessage(usage.plan, usage.limitSeconds));
        return;
      }
      const nextAllowance =
        usage.loaded && !usage.unlimited && usage.limitSeconds !== null
          ? { limit: usage.limitSeconds, baseline: usage.usedSeconds }
          : null;
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const nextTitle = options.title?.trim() || titleRef.current.trim() || defaultTitle(options.kind);
      // Take the time before the recorder opens, so an exhausted plan is
      // refused before any speech provider is paid.
      if (usage.loaded && !usage.unlimited && usage.remainingSeconds !== null) {
        const seconds = Math.max(1, Math.min(4 * 3600, Math.ceil(usage.remainingSeconds)));
        try {
          await api.reserveQuota(id, seconds);
        } catch (caught) {
          if (caught instanceof ApiError && caught.status === 402) {
            startingRef.current = false;
            setError(caught.message);
            return;
          }
        }
      }
      try {
        const stream = await openStream(options.source);
        streamRef.current = stream;
        const mime = pickMime();
        const recorder = new MediaRecorder(stream, {
          ...(mime ? { mimeType: mime } : {}),
          audioBitsPerSecond: 64_000,
        });
        chunks.current = [];
        mimeRef.current = recorder.mimeType || mime || "audio/webm";
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.current.push(event.data);
        };
        recorder.start(4000);
        recorderRef.current = recorder;
        idRef.current = id;
        createdRef.current = createdAt;
        kindRef.current = options.kind;
        titleRef.current = nextTitle;
        if (!options.title?.trim()) titleTouched.current = false;
        elapsedRef.current = 0;
        tickStart.current = Date.now();
        linesRef.current = [];
        liveRef.current = { decisions: [], actions: [] };
        participantsRef.current = options.participants ?? [];
        insightCount.current = 0;
        setLive({ decisions: [], actions: [] });
        setParticipantsState(options.participants ?? []);
        setSessionId(id);
        setKindState(options.kind);
        setSource(options.source);
        setTitleState(nextTitle);
        setLines([]);
        clearReveal();
        setInterim("");
        setElapsed(0);
        setAllowanceBoth(nextAllowance);
        setStatusBoth("recording");
        startingRef.current = false;
        useSessions.getState().setLastKind(options.kind);
        useSessions.getState().upsert({
          id,
          title: nextTitle,
          kind: options.kind,
          createdAt,
          durationSec: 0,
          status: "live",
          scratch: scratchRef.current,
          transcript: [],
          notes: null,
          hasAudio: false,
          live: { decisions: [], actions: [] },
          participants: options.participants ?? [],
        });
        if (posthogEnabled) {
          posthog.capture("capture_started", {
            capture_kind: options.kind,
            capture_source: options.source,
          });
        }
        armSpeech();
      } catch (caught) {
        stopStreamRef.current();
        stopStreamRef.current = () => {};
        void api.releaseQuota(id).catch(() => undefined);
        setAllowanceBoth(null);
        startingRef.current = false;
        setError(messageFor(caught, options.source));
        setStatusBoth("idle");
      }
    },
    [],
  );

  const pause = useCallback(() => {
    if (statusRef.current !== "recording") return;
    if (tickStart.current) {
      elapsedRef.current += (Date.now() - tickStart.current) / 1000;
      tickStart.current = null;
    }
    setElapsed(elapsedRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.pause();
    listenRef.current = false;
    stopServerLive();
    stopSpeech(previewRef);
    stopSpeech(speechRef);
    flushReveal();
    setStatusBoth("paused");
    persistLive();
  }, [persistLive]);

  const resume = useCallback(() => {
    if (statusRef.current !== "paused") return;
    const left = allowanceRef.current;
    if (left && left.limit - left.baseline - currentElapsed() <= 0) {
      toast(limitReachedMessage(useUsage.getState().plan, left.limit), { id: "plan-limit" });
      return;
    }
    tickStart.current = Date.now();
    if (recorderRef.current?.state === "paused") recorderRef.current.resume();
    listenRef.current = true;
    if (speechRef.current) {
      try {
        speechRef.current.start();
      } catch {
        armSpeech();
      }
    } else {
      armSpeech();
    }
    setStatusBoth("recording");
  }, []);

  const importFile = useCallback(
    async (file: File, nextKind: SessionKind, people: Participant[] = []) => {
      if (startingRef.current || statusRef.current !== "idle") {
        setError("Finish the current session first.");
        return;
      }
      startingRef.current = true;
      const usage = await usageSnapshot();
      if (usage.loaded && !usage.unlimited && usage.remainingSeconds !== null && usage.remainingSeconds <= 0) {
        startingRef.current = false;
        setError(limitReachedMessage(usage.plan, usage.limitSeconds));
        return;
      }
      const duration = await audioDuration(file);
      if (
        usage.loaded &&
        !usage.unlimited &&
        usage.remainingSeconds !== null &&
        duration > usage.remainingSeconds
      ) {
        startingRef.current = false;
        setError(uploadTooLongMessage(usage.plan));
        return;
      }
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const nextTitle = file.name.replace(/\.[^.]+$/, "") || defaultTitle(nextKind);
      if (usage.loaded && !usage.unlimited && duration > 0) {
        try {
          await api.reserveQuota(id, Math.min(4 * 3600, Math.ceil(duration)));
        } catch (caught) {
          if (caught instanceof ApiError && caught.status === 402) {
            startingRef.current = false;
            setError(caught.message);
            return;
          }
        }
      }
      idRef.current = id;
      setSessionId(id);
      setStatusBoth("processing");
      setError(null);
      const base: Session = {
        id,
        title: nextTitle,
        kind: nextKind,
        createdAt,
        durationSec: duration,
        status: "processing",
        scratch: "",
        transcript: [],
        notes: null,
        hasAudio: true,
        participants: people,
      };
      useSessions.getState().upsert(base);
      navigate(`/session/${id}`);
      try {
        void saveAudio(id, file).catch(() => undefined);
        const outcome = await runServerJob({
          session: base,
          blob: file,
          titleIsDefault: true,
          onProgress: (progress) => {
            useSessions.getState().patch(base.id, { transcript: progress.lines });
          },
        });
        if (outcome.state === "pending") return;
        if (outcome.state === "done") {
          useSessions.getState().upsert({
            ...base,
            title: outcome.title,
            status: "ready",
            transcript: outcome.lines,
            notes: outcome.notes,
          });
          void refreshUsage();
          return;
        }
        if (outcome.state === "failed") {
          useSessions.getState().upsert({
            ...base,
            status: "failed",
            error: outcome.message,
          });
          return;
        }
        const ai = await studioAvailable();
        if (!ai) {
          useSessions.getState().upsert({
            ...base,
            status: "failed",
            error:
              "The recording is saved on this device. JotBox can't write notes from it right now. You can paste the words below and JotBox will write the notes from them.",
          });
          return;
        }
        const result = await withProcessingTimeout(
          buildNotes({
            kind: nextKind,
            title: nextTitle,
            titleIsDefault: true,
            scratch: "",
            lines: [],
            audio: file,
            ai: true,
            participants: people,
          }),
        );
        const wrote = result.lines.length > 0 || result.notes.highlights.length > 0;
        useSessions.getState().upsert({
          ...base,
          title: result.title,
          status: wrote ? "ready" : "failed",
          transcript: result.lines,
          notes: wrote ? result.notes : null,
          error: wrote ? undefined : "No words came back from that recording.",
        });
        if (wrote && posthogEnabled) {
          posthog.capture("audio_import_completed", {
            capture_kind: nextKind,
            duration_sec: Math.round(duration),
          });
        }
      } catch (caught) {
        useSessions.getState().upsert({
          ...base,
          status: "failed",
          error: caught instanceof Error ? caught.message : "JotBox could not read that recording.",
        });
      } finally {
        if (idRef.current === id) {
          idRef.current = null;
          setSessionId(null);
        }
        startingRef.current = false;
        setStatusBoth("idle");
      }
    },
    [navigate, runServerJob],
  );

  const pin = useCallback(async () => {
    if (desktop?.isDesktop) {
      toast.success("JotBox is already floating in its island.", { id: "island-pinned" });
      return;
    }
    const host = window as unknown as {
      documentPictureInPicture?: {
        requestWindow: (options?: {
          width?: number;
          height?: number;
          preferInitialWindowPlacement?: boolean;
        }) => Promise<Window>;
      };
    };
    if (!host.documentPictureInPicture) {
      setError("The floating pill needs a computer browser. You can still keep JotBox open in a small window.");
      return;
    }
    const pipWindow = await host.documentPictureInPicture.requestWindow({
      width: 324,
      height: 64,
      preferInitialWindowPlacement: true,
    });
    copyStyles(pipWindow.document);
    pipWindow.addEventListener("pagehide", () => setPip(null));
    pipRef.current = pipWindow;
    setPip(pipWindow);
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    desktop.publishState({
      status,
      elapsed,
      title: title || defaultTitle(kind),
      interim,
      lines: lines.slice(-2).map(({ speaker, text }) => ({ speaker, text })),
      captions,
      kind,
      level: levelRef.current,
      at: Date.now(),
    });
  }, [desktop, status, elapsed, title, kind, interim, lines, captions]);

  useEffect(() => {
    if (!desktop) return;
    return desktop.onCommand((command) => {
      if (command === "pause") pause();
      else if (command === "resume") resume();
      else if (command === "stop") void stopRef.current();
      else if (command === "toggle-listen") {
        if (statusRef.current === "recording" || statusRef.current === "paused") {
          void stopRef.current();
        } else if (statusRef.current === "idle") {
          void start({ kind: kindRef.current, source: "mic" });
        }
      }
    });
  }, [desktop, pause, resume, start]);

  useEffect(() => {
    pipRef.current = pip;
  }, [pip]);

  const setScratch = useCallback(
    (value: string) => {
      scratchRef.current = value;
      setScratchState(value);
      window.clearTimeout(scratchTimer.current);
      scratchTimer.current = window.setTimeout(persistLive, 350);
    },
    [persistLive],
  );

  const setParticipants = useCallback((people: Participant[]) => {
    participantsRef.current = people;
    setParticipantsState(people);
    const id = idRef.current;
    if (id) useSessions.getState().patch(id, { participants: people });
  }, []);

  useEffect(() => {
    if (status !== "recording" && status !== "paused") return;
    if (!lines.length) return;

    const merged = mergeInsights(liveRef.current, localInsights(lines));
    if (insightsCount(merged) !== insightsCount(liveRef.current)) {
      liveRef.current = merged;
      setLive(merged);
      persistLive();
    }

    const now = Date.now();
    if (
      insightBusy.current ||
      lines.length < 4 ||
      lines.length === insightCount.current ||
      now - insightAt.current < 60_000
    ) {
      return;
    }

    insightBusy.current = true;
    insightAt.current = now;
    insightCount.current = lines.length;
    const draft: Session = {
      id: idRef.current ?? "",
      title: titleRef.current || defaultTitle(kindRef.current),
      kind: kindRef.current,
      createdAt: createdRef.current,
      durationSec: currentElapsed(),
      status: "live",
      scratch: scratchRef.current,
      transcript: lines,
      notes: null,
      hasAudio: false,
    };
    void requestInsights(draft, liveRef.current).then((next) => {
      insightBusy.current = false;
      if (statusRef.current !== "recording" && statusRef.current !== "paused") return;
      if (!insightsCount(next)) return;
      const combined = mergeInsights(liveRef.current, next);
      if (insightsCount(combined) === insightsCount(liveRef.current)) return;
      liveRef.current = combined;
      setLive(combined);
      persistLive();
    });
  }, [lines, status, persistLive]);

  const setTitle = useCallback((value: string) => {
    titleRef.current = value;
    titleTouched.current = true;
    setTitleState(value);
    persistLive();
  }, [persistLive]);

  const setKind = useCallback((next: SessionKind) => {
    kindRef.current = next;
    setKindState(next);
    useSessions.getState().setLastKind(next);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    const store = useSessions.getState();
    for (const item of store.sessions) {
      const closed = closeLiveSession(item);
      if (closed) {
        store.patch(item.id, { status: closed.status, error: closed.error });
      } else if (item.status === "processing") {
        store.patch(item.id, {
          status: "failed",
          error:
            "The notes were still being written when this page closed. Rewrite them from the spoken words, or try the recording again.",
        });
      }
    }
  }, []);

  useEffect(() => {
    const data = new Uint8Array(128);
    let frame = 0;
    const tick = () => {
      const analyser = analyserRef.current;
      if (analyser && statusRef.current === "recording") {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / data.length);
        levelRef.current = Math.min(1, rms * 3.4);
        const live = serverLiveRef.current;
        if (live.active && live.recorder) {
          noteLevel(live.level, rms);
          if (live.closing && isPauseForBoundary(rms)) closeLiveSegment(live);
        }
      } else {
        levelRef.current *= 0.85;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (statusRef.current !== "recording" && statusRef.current !== "paused") return;
      if (createdRef.current && liveExpired(createdRef.current)) {
        toast("Four hours is the limit, so this capture has ended.");
        void stopRef.current();
        return;
      }
      const allowance = allowanceRef.current;
      if (allowance && statusRef.current === "recording") {
        if (allowance.limit - allowance.baseline - currentElapsed() <= 0) {
          toast(limitReachedMessage(useUsage.getState().plan, allowance.limit), { id: "plan-limit" });
          void stopRef.current();
          return;
        }
      }
      if (statusRef.current === "recording") setElapsed(currentElapsed());
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (status !== "recording" && status !== "paused") {
      if (titledRef.current) {
        titledRef.current = false;
        document.title = "JotBox: the notes are written while you listen";
      }
      return;
    }
    titledRef.current = true;
    document.title = `● ${formatClock(elapsed)} · JotBox`;
  }, [status, elapsed]);

  useEffect(() => {
    if (status !== "recording") {
      void clearCaptureNotice();
      return;
    }
    void showCaptureNotice(titleRef.current || defaultTitle(kindRef.current));
    type Sentinel = { release: () => Promise<void> };
    let sentinel: Sentinel | null = null;
    const wake = async () => {
      try {
        const host = navigator as Navigator & {
          wakeLock?: { request: (type: "screen") => Promise<Sentinel> };
        };
        sentinel = host.wakeLock ? await host.wakeLock.request("screen") : null;
      } catch {
        sentinel = null;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void wake();
    };
    void wake();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [status]);

  useEffect(() => {
    if (status !== "recording" && status !== "paused") return;
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [status]);

  useEffect(() => {
    if (!pip) return;
    pip.document.documentElement.classList.toggle("dark", document.documentElement.classList.contains("dark"));
  }, [pip, theme]);

  const freeRemainingSec = allowance
    ? Math.max(0, Math.ceil(allowance.limit - allowance.baseline - elapsed))
    : null;

  const value = useMemo<EngineValue>(
    () => ({
      status,
      sessionId,
      kind,
      source,
      title,
      scratch,
      lines,
      live,
      participants,
      interim,
      elapsed,
      freeRemainingSec,
      error,
      captions,
      pip,
      getLevel: () => levelRef.current,
      start,
      pause,
      resume,
      stop,
      setScratch,
      setParticipants,
      setTitle,
      setKind,
      importFile,
      pin,
      clearError,
    }),
    [
      status,
      sessionId,
      kind,
      source,
      title,
      scratch,
      lines,
      live,
      participants,
      interim,
      elapsed,
      freeRemainingSec,
      error,
      captions,
      pip,
      start,
      pause,
      resume,
      stop,
      setScratch,
      setParticipants,
      setTitle,
      setKind,
      importFile,
      pin,
      clearError,
    ],
  );

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine() {
  const value = useContext(EngineContext);
  if (!value) throw new Error("useEngine must be used inside EngineProvider");
  return value;
}
