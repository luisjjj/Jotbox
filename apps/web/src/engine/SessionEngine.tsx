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
import { saveAudio } from "@/lib/audioStore";
import { buildNotes, studioAvailable } from "@/lib/buildNotes";
import { defaultTitle, formatClock } from "@/lib/format";
import { insightsCount, localInsights, mergeInsights, requestInsights } from "@/lib/insights";
import { closeLiveSession, liveExpired } from "@/lib/lifecycle";
import {
  focusContext,
  getPickupMode,
  isNoiseLine,
  isOffTopic,
  pickupConstraints,
} from "@/lib/listening";
import { useSessions } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { ensureUsage } from "@/lib/usageStore";
import type { CaptureSource, LiveInsights, Participant, Session, SessionKind, TranscriptLine } from "@/lib/types";

type EngineStatus = "idle" | "recording" | "paused" | "processing";

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

const FREE_LIMIT_ERROR =
  "Your free listening minutes are finished for this month. Upgrade to Pro to keep listening.";
const UPLOAD_TOO_LONG =
  "That recording is longer than the free listening time you have left this month. Upgrade to Pro to keep listening.";

function shapeQuietVoices(input: AudioNode, context: AudioContext) {
  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 85;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -34;
  compressor.knee.value = 18;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.24;
  input.connect(highpass);
  highpass.connect(compressor);
  return compressor;
}

function farMicStream(stream: MediaStream, context: AudioContext) {
  const source = context.createMediaStreamSource(stream);
  const destination = context.createMediaStreamDestination();
  shapeQuietVoices(source, context).connect(destination);
  return destination.stream;
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
  const speechRef = useRef<SpeechRec | null>(null);
  const listenRef = useRef(false);
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
      if (pickup === "far" && audioContext) {
        try {
          await audioContext.resume();
          if (audioContext.state === "running") recorded = farMicStream(mic, audioContext);
        } catch {
          recorded = mic;
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
        const output = pickup === "far" ? shapeQuietVoices(bus, audioContext) : bus;
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

  const armSpeech = () => {
    const Ctor = speechCtor();
    if (!Ctor) {
      setCaptions(false);
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-NG";
    rec.onresult = (event) => {
      const context = focusContext({
        title: titleRef.current,
        kind: kindRef.current,
        participants: participantsRef.current,
        scratch: scratchRef.current,
      });
      let pending = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) {
          const last = linesRef.current[linesRef.current.length - 1];
          if (last && last.text.trim().toLowerCase() === text.toLowerCase()) {
            pending = "";
            continue;
          }
          if (isOffTopic(text, context)) {
            pending = "";
            continue;
          }
          linesRef.current = [
            ...linesRef.current,
            { id: crypto.randomUUID(), text, at: currentElapsed() },
          ];
          setLines(linesRef.current);
          pending = "";
          persistLive();
        } else if (!isNoiseLine(text)) {
          pending += `${text} `;
        }
      }
      setInterim(pending.trim());
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "network" || event.error === "service-not-allowed") {
        setCaptions(false);
      }
    };
    rec.onend = () => {
      if (!listenRef.current) return;
      window.setTimeout(() => {
        if (!listenRef.current) return;
        try {
          rec.start();
        } catch {
          setCaptions(false);
        }
      }, 300);
    };
    try {
      rec.start();
      speechRef.current = rec;
      listenRef.current = true;
    } catch {
      setCaptions(false);
    }
  };

  const finishRecorder = () => {
    listenRef.current = false;
    try {
      speechRef.current?.stop();
    } catch {
      /* already stopped */
    }
    speechRef.current = null;
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
      recorderRef.current = null;
    });
  };

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
    const linesNow = linesRef.current;
    const createdAt = createdRef.current;
    const titleIsDefault = !titleTouched.current;
    let blob: Blob | null = null;
    try {
      blob = await finishRecorder();
      if (blob.size > 0) await saveAudio(id, blob);
    } catch {
      blob = null;
    }
    useSessions.getState().upsert({
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
    });
    navigate(`/session/${id}`);
    try {
      const ai = await studioAvailable();
      const result = await buildNotes({
        kind: kindNow,
        title: titleNow,
        titleIsDefault,
        scratch: scratchNow,
        lines: linesNow,
        audio: blob,
        ai,
        participants: participantsRef.current,
      });
      useSessions.getState().upsert({
        id,
        title: result.title,
        kind: kindNow,
        createdAt,
        durationSec: duration,
        status: "ready",
        scratch: scratchNow,
        transcript: result.lines,
        notes: result.notes,
        hasAudio: Boolean(blob && blob.size > 0),
        live: liveRef.current,
        participants: participantsRef.current,
      });
    } catch (caught) {
      useSessions.getState().upsert({
        id,
        title: titleNow,
        kind: kindNow,
        createdAt,
        durationSec: duration,
        status: "failed",
        scratch: scratchNow,
        transcript: linesNow,
        notes: null,
        hasAudio: Boolean(blob && blob.size > 0),
        live: liveRef.current,
        participants: participantsRef.current,
        error: caught instanceof Error ? caught.message : "The notes could not be written.",
      });
    }
    reset();
  }, [navigate]);

  stopRef.current = stop;

  const start = useCallback(
    async (options: StartOptions) => {
      if (statusRef.current === "recording" || statusRef.current === "paused" || statusRef.current === "processing") {
        setError("Finish the current session first.");
        return;
      }
      setError(null);
      const usage = await ensureUsage();
      if (usage.loaded && !usage.unlimited && (usage.remainingSeconds ?? 0) <= 0) {
        setError(FREE_LIMIT_ERROR);
        return;
      }
      const nextAllowance =
        usage.loaded && !usage.unlimited && usage.limitSeconds !== null
          ? { limit: usage.limitSeconds, baseline: usage.usedSeconds }
          : null;
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const nextTitle = options.title?.trim() || titleRef.current.trim() || defaultTitle(options.kind);
      try {
        const stream = await openStream(options.source);
        const mime = pickMime();
        const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
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
        setInterim("");
        setElapsed(0);
        setAllowanceBoth(nextAllowance);
        setStatusBoth("recording");
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
        armSpeech();
      } catch (caught) {
        stopStreamRef.current();
        stopStreamRef.current = () => {};
        setAllowanceBoth(null);
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
    try {
      speechRef.current?.stop();
    } catch {
      /* already stopped */
    }
    setStatusBoth("paused");
    persistLive();
  }, [persistLive]);

  const resume = useCallback(() => {
    if (statusRef.current !== "paused") return;
    const left = allowanceRef.current;
    if (left && left.limit - left.baseline - currentElapsed() <= 0) {
      toast(FREE_LIMIT_ERROR, { id: "free-limit" });
      return;
    }
    tickStart.current = Date.now();
    if (recorderRef.current?.state === "paused") recorderRef.current.resume();
    listenRef.current = true;
    try {
      speechRef.current?.start();
    } catch {
      armSpeech();
    }
    setStatusBoth("recording");
  }, []);

  const importFile = useCallback(
    async (file: File, nextKind: SessionKind, people: Participant[] = []) => {
      if (statusRef.current !== "idle") {
        setError("Finish the current session first.");
        return;
      }
      const usage = await ensureUsage();
      if (usage.loaded && !usage.unlimited && usage.remainingSeconds !== null && usage.remainingSeconds <= 0) {
        setError(FREE_LIMIT_ERROR);
        return;
      }
      const duration = await audioDuration(file);
      if (
        usage.loaded &&
        !usage.unlimited &&
        usage.remainingSeconds !== null &&
        duration > usage.remainingSeconds
      ) {
        setError(UPLOAD_TOO_LONG);
        return;
      }
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const nextTitle = file.name.replace(/\.[^.]+$/, "") || defaultTitle(nextKind);
      setStatusBoth("processing");
      setError(null);
      useSessions.getState().upsert({
        id,
        title: nextTitle,
        kind: nextKind,
        createdAt,
        durationSec: duration,
        status: "processing",
        scratch: "",
        transcript: [],
        notes: null,
        hasAudio: false,
        participants: people,
      });
      navigate(`/session/${id}`);
      try {
        await saveAudio(id, file);
        const ai = await studioAvailable();
        if (!ai) {
          useSessions.getState().upsert({
            id,
            title: nextTitle,
            kind: nextKind,
            createdAt,
            durationSec: duration,
            status: "failed",
            scratch: "",
            transcript: [],
            notes: null,
            hasAudio: true,
            participants: people,
            error:
              "The recording is saved on this device. JotBox can't write notes from it right now. You can paste the words below and JotBox will write the notes from them.",
          });
          return;
        }
        const result = await buildNotes({
          kind: nextKind,
          title: nextTitle,
          titleIsDefault: true,
          scratch: "",
          lines: [],
          audio: file,
          ai: true,
          participants: people,
        });
        const wrote = result.lines.length > 0 || result.notes.highlights.length > 0;
        useSessions.getState().upsert({
          id,
          title: result.title,
          kind: nextKind,
          createdAt,
          durationSec: duration,
          status: wrote ? "ready" : "failed",
          scratch: "",
          transcript: result.lines,
          notes: wrote ? result.notes : null,
          hasAudio: true,
          participants: people,
          error: wrote ? undefined : "No words came back from that recording.",
        });
      } catch (caught) {
        useSessions.getState().upsert({
          id,
          title: nextTitle,
          kind: nextKind,
          createdAt,
          durationSec: duration,
          status: "failed",
          scratch: "",
          transcript: [],
          notes: null,
          hasAudio: true,
          participants: people,
          error: caught instanceof Error ? caught.message : "JotBox could not read that recording.",
        });
      } finally {
        setStatusBoth("idle");
      }
    },
    [navigate],
  );

  const pin = useCallback(async () => {
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
  }, []);

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
        levelRef.current = Math.min(1, Math.sqrt(sum / data.length) * 3.4);
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
          toast(FREE_LIMIT_ERROR, { id: "free-limit" });
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
    if (status !== "recording") return;
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
