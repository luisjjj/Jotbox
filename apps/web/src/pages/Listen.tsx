import { useMemo, useRef, useState, type ChangeEvent } from "react";
import clsx from "clsx";
import {
  AlertCircle,
  ArrowRight,
  AudioLines,
  Check,
  FileAudio,
  Loader2,
  Mic,
  MonitorUp,
  Pause,
  Pencil,
  Pin,
  Play,
  Square,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { APP_CONFIG } from "@jotbox/config";
import { useEngine } from "@/engine/SessionEngine";
import { useStudio } from "@/hooks/useStudio";
import { formatClock, KIND_META } from "@/lib/format";
import type { SessionKind } from "@/lib/types";
import { KindBadge, KindIcon } from "@/components/KindBadge";
import { TranscriptView } from "@/components/TranscriptView";
import { Waveform } from "@/components/Waveform";

const KINDS: SessionKind[] = ["meeting", "seminar", "lecture", "voice"];

function KindSelector({ kind, onChange }: { kind: SessionKind; onChange: (kind: SessionKind) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {KINDS.map((item) => {
        const active = item === kind;
        return (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            aria-pressed={active}
            className={clsx(
              "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all",
              active
                ? "border-accent bg-accent-soft shadow-sm"
                : "border-line bg-raised hover:border-line-strong hover:bg-raised-2",
            )}
          >
            <span
              className={clsx(
                "grid h-8 w-8 flex-none place-items-center rounded-lg",
                active ? "bg-accent text-accent-ink" : "bg-raised-2 text-muted",
              )}
            >
              <KindIcon kind={item} className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-[12.5px] font-semibold tracking-[-0.01em] text-ink">
                {KIND_META[item].label}
                {active && <Check className="h-3 w-3 text-accent" />}
              </span>
              <span className="mt-0.5 hidden text-[10.5px] leading-4 text-muted sm:block">
                {KIND_META[item].hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SourceCard({
  Icon,
  title,
  body,
  action,
  note,
  onClick,
  busy,
  disabled,
}: {
  Icon: LucideIcon;
  title: string;
  body: string;
  action: string;
  note: string;
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="card flex flex-col p-4 sm:p-5">
      <div className="flex items-start justify-between">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
          <Icon className="h-5 w-5" strokeWidth={1.8} />
        </span>
        <span className="chip text-[10px]">{note}</span>
      </div>
      <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.02em] text-ink">{title}</h3>
      <p className="mt-1.5 flex-1 text-[12.5px] leading-5 text-muted">{body}</p>
      <button type="button" className="btn btn-line mt-4 w-full justify-between" onClick={onClick} disabled={busy || disabled}>
        <span>{busy ? "Opening…" : action}</span>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
      </button>
    </div>
  );
}

function Setup() {
  const { kind, setKind, start, error, clearError, importFile, status } = useEngine();
  const studio = useStudio();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<"mic" | "tab" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [canShare] = useState(
    () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia),
  );
  const [uploading, setUploading] = useState(false);

  const launch = async (source: "mic" | "tab") => {
    setBusy(source);
    clearError();
    try {
      await start({ kind, source, title: title.trim() || undefined });
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > APP_CONFIG.maxFileSize) {
      toast.error("That file is over 80 MB. Split it or upload a smaller recording.");
      return;
    }
    setUploading(true);
    toast.success("Reading the recording…");
    try {
      await importFile(file, kind);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-[900px]">
      <p className="kicker">New capture</p>
      <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.04em] text-ink sm:text-[32px]">
        What are you listening to?
      </h1>
      <p className="mt-1.5 max-w-[46ch] text-[13.5px] leading-6 text-muted">
        Pick the shape of the session. JotBox listens, keeps the transcript, and writes the notes in that shape.
      </p>

      {error && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-rec-line bg-rec-soft p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-rec" />
          <p className="flex-1 text-[12.5px] leading-5 text-soft">{error}</p>
          <button type="button" className="icon-btn h-6 w-6" onClick={clearError} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="mt-6 space-y-5">
        <div>
          <p className="label">Session type</p>
          <KindSelector kind={kind} onChange={setKind} />
        </div>

        <div>
          <label className="label" htmlFor="capture-title">
            Name it <span className="font-normal text-faint">— optional</span>
          </label>
          <input
            id="capture-title"
            className="field"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={`e.g. ${kind === "lecture" ? "Constitutional law — Thursday" : kind === "seminar" ? "Climate policy panel" : kind === "voice" ? "Idea for the onboarding flow" : "Weekly product sync"}`}
            autoComplete="off"
            maxLength={120}
          />
        </div>

        <div>
          <p className="label">How should JotBox hear it?</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <SourceCard
              Icon={Mic}
              title="In the room"
              body="Your microphone picks up a meeting, lecture, or seminar. Best for one room and one speaker at a time."
              action="Use the microphone"
              note="Mic"
              onClick={() => void launch("mic")}
              busy={busy === "mic"}
              disabled={Boolean(busy) || uploading}
            />
            <SourceCard
              Icon={MonitorUp}
              title="On a call or a tab"
              body="Share a Meet, Zoom, or Teams tab. JotBox records the tab's audio and mixes in your microphone when you speak."
              action={canShare ? "Share a tab" : "Desktop Chrome or Edge"}
              note="Tab + mic"
              onClick={() => void launch("tab")}
              busy={busy === "tab"}
              disabled={!canShare || Boolean(busy) || uploading}
            />
          </div>
          {!canShare && (
            <p className="mt-2 text-[11px] leading-5 text-faint">
              Tab audio capture needs a desktop browser that supports screen sharing. On a phone, use the microphone.
            </p>
          )}
          {studio === false && (
            <p className="mt-2 text-[11px] leading-5 text-faint">
              Studio transcription is off, so call and upload audio is saved but not transcribed. The microphone still
              gets live captions, and you can paste a transcript after the session.
            </p>
          )}
        </div>

        <div className="card-quiet flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-raised text-muted">
              <FileAudio className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[13px] font-medium text-ink">Already have a recording?</p>
              <p className="mt-0.5 text-[11.5px] leading-5 text-muted">
                {APP_CONFIG.supportedAudioExtensions.join(" ").toUpperCase()} · up to 80 MB.{" "}
                {studio === false ? "Studio transcription is off — you can paste a transcript afterwards." : ""}
              </p>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.m4a"
            className="sr-only"
            onChange={(event) => void onFile(event)}
          />
          <button
            type="button"
            className="btn btn-line w-full flex-none sm:w-auto"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || Boolean(busy) || status === "processing"}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "Reading…" : "Upload audio"}
          </button>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-line bg-raised-2 px-3.5 py-3">
          <Pin className="mt-0.5 h-3.5 w-3.5 flex-none text-faint" />
          <p className="text-[11.5px] leading-5 text-muted">
            Need to keep working? Start here, then{" "}
            <Link to="/float" className="font-medium text-ink underline decoration-line-strong underline-offset-2">
              pin the compact window
            </Link>{" "}
            above your other apps. Audio is stored on this device unless studio transcription is enabled.
          </p>
        </div>
      </div>
    </div>
  );
}

function Studio() {
  const {
    status,
    source,
    kind,
    title,
    scratch,
    lines,
    interim,
    elapsed,
    captions,
    setScratch,
    setTitle,
    pause,
    resume,
    stop,
    pin,
    error,
    clearError,
  } = useEngine();
  const [pane, setPane] = useState<"notes" | "transcript">("notes");
  const paused = status === "paused";
  const words = useMemo(() => (scratch.trim() ? scratch.trim().split(/\s+/).length : 0), [scratch]);
  const [canPin] = useState(
    () => typeof window !== "undefined" && "documentPictureInPicture" in window,
  );
  const [busy, setBusy] = useState(false);

  const sourceLabel = source === "tab" ? "Tab + mic" : source === "upload" ? "Upload" : "Microphone";

  const handleStop = () => {
    toast.success("Writing your notes…", { id: "writing-notes" });
    void stop();
  };

  const handlePin = async () => {
    setBusy(true);
    try {
      await pin();
    } catch {
      toast.error("The floating window was blocked. Allow pop-ups for JotBox and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1080px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rec-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-rec">
              <span className="live-dot" />
              {paused ? "Paused" : "Listening"}
            </span>
            <span className="text-[24px] font-semibold tabular-nums tracking-[-0.03em] text-ink sm:text-[28px]">
              {formatClock(elapsed)}
            </span>
            <span className="hidden items-center gap-1 text-[11px] text-faint sm:flex">
              <AudioLines className="h-3.5 w-3.5" />
              {sourceLabel}
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <KindBadge kind={kind} />
            <input
              className="w-full min-w-0 bg-transparent text-[18px] font-semibold tracking-[-0.03em] text-ink outline-none placeholder:text-faint sm:text-[22px]"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Name this session"
              aria-label="Session title"
            />
          </div>
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Waveform active={!paused} bars={26} className="mr-auto hidden h-9 w-24 lg:flex" />
          {canPin ? (
            <button
              type="button"
              className="btn btn-line flex-1 sm:flex-none"
              onClick={handlePin}
              disabled={busy}
              title="Pin above other apps"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pin className="h-4 w-4" />}
              Float
            </button>
          ) : (
            <Link
              to="/float"
              className="btn btn-line flex-1 sm:flex-none"
              title="Floating needs Chrome or Edge on a computer"
            >
              <Pin className="h-4 w-4" />
              Float
            </Link>
          )}
          <button
            type="button"
            className="btn btn-line flex-1 sm:flex-none"
            onClick={paused ? resume : pause}
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? "Resume" : "Pause"}
          </button>
          <button type="button" className="btn btn-danger flex-1 sm:flex-none" onClick={handleStop}>
            <Square className="h-3.5 w-3.5 fill-current" />
            Stop & write
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-rec-line bg-rec-soft p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-rec" />
          <p className="flex-1 text-[12.5px] leading-5 text-soft">{error}</p>
          <button type="button" className="icon-btn h-6 w-6" onClick={clearError} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 lg:hidden">
        <div className="seg w-full">
          <button
            type="button"
            className="seg-item flex-1"
            data-active={pane === "notes"}
            onClick={() => setPane("notes")}
          >
            Your notes
            <span className="text-[10px] text-faint">{words}</span>
          </button>
          <button
            type="button"
            className="seg-item flex-1"
            data-active={pane === "transcript"}
            onClick={() => setPane("transcript")}
          >
            Transcript
            <span className="text-[10px] text-faint">{lines.length}</span>
          </button>
        </div>
      </div>

      <div className="card mt-3 overflow-hidden lg:mt-4">
        <div className="grid lg:grid-cols-2">
          <section
            className={clsx(
              "min-h-[54vh] flex-col border-line lg:flex lg:min-h-[calc(100dvh-19rem)] lg:border-r",
              pane === "notes" ? "flex" : "hidden",
            )}
            aria-label="Your notes"
          >
            <div className="hidden items-center justify-between border-b border-line px-4 py-3 sm:px-5 lg:flex">
              <div className="flex items-center gap-2">
                <Pencil className="h-3.5 w-3.5 text-muted" />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Your notes</h2>
              </div>
              <span className="text-[10.5px] tabular-nums text-faint">{words} words · saved</span>
            </div>
            <textarea
              className="min-h-[42vh] w-full flex-1 resize-none border-0 bg-transparent p-4 text-[15.5px] leading-7 text-ink outline-none placeholder:text-faint sm:p-5 lg:min-h-0"
              placeholder={
                "Write what you want to keep.\n\n• Decisions\n• Names, numbers, dates\n• What you owe someone"
              }
              value={scratch}
              onChange={(event) => setScratch(event.target.value)}
              spellCheck
            />
            <p className="border-t border-line px-4 py-2.5 text-[10.5px] leading-4 text-faint sm:px-5">
              Short lines work best. These become the spine of the written notes.
            </p>
          </section>

          <section
            className={clsx(
              "min-h-[54vh] flex-col lg:flex lg:min-h-[calc(100dvh-19rem)]",
              pane === "transcript" ? "flex" : "hidden",
            )}
            aria-label="Live transcript"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2">
                <AudioLines className="h-3.5 w-3.5 text-muted" />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Live transcript
                </h2>
              </div>
              <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
                {captions ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-[#3e7a5b]" />
                    Captions on
                  </>
                ) : (
                  "Captions unavailable"
                )}
              </span>
            </div>
            {!captions && (
              <div className="flex items-start gap-2 border-b border-line bg-raised-2 px-4 py-2.5 text-[11px] leading-5 text-muted sm:px-5">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-brass" />
                This browser has no live captions. Audio is still recording, and studio transcription runs after you
                stop.
              </div>
            )}
            <TranscriptView
              lines={lines}
              interim={interim}
              live
              className="flex-1 px-4 py-2 sm:px-5"
              emptyLabel="Speak, or play the meeting. Words will appear here as you listen."
            />
            <p className="border-t border-line px-4 py-2.5 text-[10.5px] leading-4 text-faint sm:px-5">
              Captions are provisional. The final transcript is cleaned up when the session ends.
            </p>
          </section>
        </div>
      </div>

      <p className="mt-3 text-center text-[10.5px] text-faint">
        Keep this tab open for live captions. You can switch apps — the audio keeps recording.
      </p>
    </div>
  );
}

export default function Listen() {
  const { status } = useEngine();

  if (status === "idle") return <Setup />;
  if (status === "processing") return <Processing />;
  return <Studio />;
}

function Processing() {
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl border border-line bg-raised shadow-sm">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </span>
      <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.03em] text-ink">Writing the notes</h1>
      <p className="mt-2 max-w-[34ch] text-[13px] leading-6 text-muted">
        Reading the recording, tidying the transcript, and shaping the summary and actions. This page will move on its
        own.
      </p>
      <div className="writing-track mt-6 w-48">
        <div className="writing-bar" />
      </div>
      <Link to="/library" className="btn btn-ghost mt-6">
        Go to the library
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

