import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ChangeEvent } from "react";
import clsx from "clsx";
import { format } from "date-fns";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  Download,
  FileDown,
  FilePlus2,
  FileText,
  Link2,
  Loader2,
  Megaphone,
  Pause,
  PencilLine,
  Play,
  Plus,
  Printer,
  Send,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-hot-toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { FollowUpDialog } from "@/components/FollowUpDialog";
import { NoticeDialog } from "@/components/NoticeDialog";
import { PaywallDialog } from "@/components/Paywall";
import { PeopleCard } from "@/components/PeopleCard";
import { SessionAsk } from "@/components/SessionAsk";
import { ShareDialog } from "@/components/ShareDialog";
import { KindBadge } from "@/components/KindBadge";
import { SessionStatusChip } from "@/components/SessionRow";
import { TranscriptView } from "@/components/TranscriptView";
import { deleteAudio, loadAudio } from "@/lib/audioStore";
import { buildNotes, studioAvailable } from "@/lib/buildNotes";
import { copyNotes, downloadMarkdown, printSession } from "@/lib/exportNotes";
import { downloadSessionPdf } from "@/lib/pdf";
import { formatClock, isDefaultTitle, notesLookEmpty } from "@/lib/format";
import { OUTPUT_PRESETS } from "@/lib/presets";
import { isSample } from "@/lib/seed";
import { useSessions } from "@/lib/store";
import { linesFromText } from "@/lib/transcript";
import type { Session, TranscriptLine } from "@/lib/types";
import { usePro } from "@/lib/usageStore";
import { useEngine } from "@/engine/SessionEngine";
import { useAudioUrl } from "@/hooks/useAudio";

interface AudioHandle {
  seek: (seconds: number) => void;
}

const AudioPlayer = forwardRef<AudioHandle, { src: string; fallbackDuration: number }>(function AudioPlayer(
  { src, fallbackDuration },
  ref,
) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(() => (fallbackDuration > 0 ? fallbackDuration : 0));

  useImperativeHandle(ref, () => ({
    seek(seconds: number) {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = seconds;
      void audio.play().then(() => setPlaying(true)).catch(() => undefined);
    },
  }));

  useEffect(() => {
    setPlaying(false);
    setTime(0);
    setDuration(fallbackDuration > 0 ? fallbackDuration : 0);
  }, [src, fallbackDuration]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().then(() => setPlaying(true)).catch(() => undefined);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const onScrub = (event: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Number(event.target.value);
    audio.currentTime = next;
    setTime(next);
  };

  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const percent = total > 0 ? Math.min(100, (time / total) * 100) : 0;

  return (
    <div className="card flex items-center gap-3 p-3">
      <button
        type="button"
        className="grid h-10 w-10 flex-none place-items-center rounded-full bg-accent text-accent-ink transition-opacity hover:opacity-90"
        onClick={toggle}
        aria-label={playing ? "Pause recording" : "Play recording"}
      >
        {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between text-[12px] tabular-nums text-faint">
          <span>{formatClock(time)}</span>
          <span>{total ? formatClock(total) : "Unknown"}</span>
        </div>
        <input
          type="range"
          min={0}
          max={total || 0}
          step={0.1}
          value={time}
          onChange={onScrub}
          className="range mt-1.5 w-full"
          style={{
            background: `linear-gradient(to right, var(--accent) ${percent}%, var(--line) ${percent}%)`,
          }}
          aria-label="Recording position"
        />
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setDuration(value);
        }}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
    </div>
  );
});

function Panel({
  session,
  onEditTranscript,
}: {
  session: Session;
  onEditTranscript: () => void;
}) {
  const [panel, setPanel] = useState<"transcript" | "notes">("transcript");
  const audioUrl = useAudioUrl(session.id, session.hasAudio);
  const audioRef = useRef<AudioHandle>(null);

  return (
    <div className="space-y-3">
      {audioUrl && <AudioPlayer ref={audioRef} src={audioUrl} fallbackDuration={session.durationSec} />}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
          <div className="seg">
            <button
              type="button"
              className="seg-item"
              data-active={panel === "transcript"}
              onClick={() => setPanel("transcript")}
            >
              Spoken words
            </button>
            <button
              type="button"
              className="seg-item"
              data-active={panel === "notes"}
              onClick={() => setPanel("notes")}
            >
              My jottings
            </button>
          </div>
          <span className="pr-1 text-[12px] tabular-nums text-faint">{session.transcript.length} lines</span>
        </div>
        {panel === "transcript" ? (
          <TranscriptView
            lines={session.transcript}
            onSeek={(seconds) => {
              audioRef.current?.seek(seconds);
            }}
            className="max-h-[360px] px-3.5 py-2"
            emptyLabel="No spoken words were captured for this session."
          />
        ) : (
          <div className="scroll-quiet max-h-[360px] overflow-y-auto px-3.5 py-3">
            <p className="whitespace-pre-wrap text-[14.5px] leading-6 text-soft">
              {session.scratch.trim() || "You did not jot anything during this session."}
            </p>
          </div>
        )}
        <div className="border-t border-line p-2">
          <button type="button" className="btn btn-ghost btn-sm w-full justify-start" onClick={onEditTranscript}>
            <Plus className="h-3.5 w-3.5" />
            Add or edit spoken words
          </button>
        </div>
      </div>
    </div>
  );
}

function NoteSkeleton() {
  return (
    <div className="mt-6" aria-hidden="true">
      <div className="h-2.5 w-16 rounded-full bg-line" />
      <div className="mt-4 space-y-2.5">
        <div className="h-3.5 w-[92%] rounded-full bg-line" />
        <div className="h-3.5 w-[84%] rounded-full bg-line" />
        <div className="h-3.5 w-[58%] rounded-full bg-line" />
      </div>
      <div className="mt-8 h-2.5 w-20 rounded-full bg-line" />
      <div className="mt-4 space-y-2.5">
        <div className="h-3 w-[88%] rounded-full bg-line" />
        <div className="h-3 w-[76%] rounded-full bg-line" />
        <div className="h-3 w-[82%] rounded-full bg-line" />
        <div className="h-3 w-[44%] rounded-full bg-line" />
      </div>
    </div>
  );
}

export default function SessionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const session = useSessions((state) => state.sessions.find((item) => item.id === id));
  const patch = useSessions((state) => state.patch);
  const toggleAction = useSessions((state) => state.toggleAction);
  const remove = useSessions((state) => state.remove);
  const engine = useEngine();
  const pro = usePro();

  const [title, setTitle] = useState(session?.title ?? "");
  const [copying, setCopying] = useState(false);
  const [preparingPdf, setPreparingPdf] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [pdfPaywall, setPdfPaywall] = useState(false);

  useEffect(() => {
    setTitle(session?.title ?? "");
  }, [session?.id, session?.title]);

  useEffect(() => {
    if (session) document.title = `${session.title} · JotBox`;
    return () => {
      document.title = "JotBox: the notes are written while you listen";
    };
  }, [session?.title, session]);

  const openCount = session?.notes?.actions.filter((action) => !action.done).length ?? 0;
  const preset = session ? OUTPUT_PRESETS[session.kind] : OUTPUT_PRESETS.meeting;

  const meta = useMemo(() => {
    if (!session) return null;
    return {
      date: format(session.createdAt, "EEEE, d MMMM · HH:mm"),
      duration: session.durationSec > 0 ? formatClock(session.durationSec) : null,
    };
  }, [session]);

  if (!session || !meta) {
    return (
      <div className="mx-auto max-w-[520px] pt-10">
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title="That session is not here"
          body="It may have been deleted, or it lives on a different device. Sessions are stored in this browser."
        >
          <Link to="/library" className="btn btn-primary">
            Back to the library
          </Link>
        </EmptyState>
      </div>
    );
  }

  const commitTitle = () => {
    const next = title.trim();
    if (!next) {
      setTitle(session.title);
      return;
    }
    if (next !== session.title) patch(session.id, { title: next });
  };

  const regenerate = async (lines?: TranscriptLine[], scratch?: string) => {
    const useLines = lines ?? session.transcript;
    const useScratch = scratch ?? session.scratch;
    let audio: Blob | null = null;
    if (!useLines.length && !useScratch.trim() && session.hasAudio) {
      try {
        const saved = await loadAudio(session.id);
        audio = saved && saved.size > 0 ? saved : null;
      } catch {
        audio = null;
      }
    }
    if (!useLines.length && !useScratch.trim() && !audio) {
      toast.error("Record audio, or add the spoken words, before asking for notes.");
      return false;
    }
    setRebuilding(true);
    try {
      const ai = await studioAvailable();
      if (audio && !ai) {
        toast.error("Automatic words are off. Add or paste the spoken words instead.");
        return false;
      }
      const result = await buildNotes({
        kind: session.kind,
        title: session.title,
        titleIsDefault: isDefaultTitle(session.title, session.kind),
        scratch: useScratch,
        lines: useLines,
        audio,
        ai,
        participants: session.participants ?? [],
      });
      patch(session.id, {
        notes: result.notes,
        status: "ready",
        error: undefined,
        transcript: result.lines,
        title: result.title,
      });
      toast.success(audio ? "Words and notes are ready" : ai ? "Notes rewritten" : "Notes written on this device");
      return true;
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The notes could not be written.");
      return false;
    } finally {
      setRebuilding(false);
    }
  };

  const openTranscriptEditor = () => {
    setDraft(session.transcript.map((line) => line.text).join("\n"));
    setEditing(true);
  };

  const retry = async () => {
    if (!session.hasAudio) {
      await regenerate();
      return;
    }
    const ai = await studioAvailable();
    if (!ai) {
      toast.error("Automatic words are off. Add or paste the spoken words instead.");
      return;
    }
    setRebuilding(true);
    try {
      const blob = await loadAudio(session.id);
      if (!blob) {
        await regenerate();
        return;
      }
      const result = await buildNotes({
        kind: session.kind,
        title: session.title,
        titleIsDefault: isDefaultTitle(session.title, session.kind),
        scratch: session.scratch,
        lines: session.transcript,
        audio: blob,
        ai: true,
        participants: session.participants ?? [],
      });
      patch(session.id, {
        notes: result.notes,
        status: "ready",
        error: undefined,
        transcript: result.lines,
        title: result.title,
      });
      toast.success("Words and notes are ready");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "JotBox could not read that recording.");
    } finally {
      setRebuilding(false);
    }
  };

  const saveTranscript = async () => {
    const lines = linesFromText(draft);
    if (!lines.length) {
      toast.error("Paste a few lines of the session first.");
      return;
    }
    setSavingTranscript(true);
    patch(session.id, { transcript: lines, status: "ready", error: undefined });
    setEditing(false);
    await regenerate(lines, session.scratch);
    setSavingTranscript(false);
  };

  const copy = async () => {
    setCopying(true);
    try {
      await copyNotes(session);
      toast.success("Notes copied");
    } catch {
      toast.error("Copy failed. Try downloading instead.");
    } finally {
      setCopying(false);
    }
  };

  const savePdf = async () => {
    if (!pro) {
      setPdfPaywall(true);
      return;
    }
    setPreparingPdf(true);
    try {
      await downloadSessionPdf(session);
      toast.success("PDF downloaded");
    } catch {
      toast.error("The PDF could not be made. Try printing instead.");
    } finally {
      setPreparingPdf(false);
    }
  };

  const handleDelete = () => {
    setConfirmDelete(false);
    remove(session.id);
    void deleteAudio(session.id);
    toast.success("Session deleted");
    navigate("/library");
  };

  const hasContent = Boolean(session.notes) || session.transcript.length > 0 || Boolean(session.scratch.trim());
  const canRetry = hasContent || session.hasAudio;
  const failureTitle = session.error?.includes("interrupted")
    ? "This capture was interrupted"
    : session.error?.includes("still being written")
      ? "The notes were not finished"
      : "The notes could not be written";
  const processing = session.status === "processing";
  const failed = session.status === "failed";
  const orphanedLive =
    session.status === "live" &&
    !(engine.sessionId === session.id && (engine.status === "recording" || engine.status === "paused"));
  const notesEmpty = notesLookEmpty(session.notes);
  const showNotes = session.notes && !notesEmpty;

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <Link to="/library" className="btn btn-ghost -ml-2">
          <ArrowLeft className="h-4 w-4" />
          Library
        </Link>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            className="icon-btn hidden sm:inline-flex"
            onClick={() => void copy()}
            disabled={copying || !hasContent}
            title="Copy notes as Markdown"
            aria-label="Copy notes as Markdown"
          >
            {copying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
          </button>
          <button
            type="button"
            className="icon-btn hidden sm:inline-flex"
            onClick={() => {
              downloadMarkdown(session);
              toast.success("Markdown downloaded");
            }}
            disabled={!hasContent}
            title="Download as Markdown"
            aria-label="Download as Markdown"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void savePdf()}
            disabled={preparingPdf || !hasContent}
            title={pro ? "Download a branded PDF" : "Branded PDF is part of Pro"}
            aria-label={pro ? "Download a branded PDF" : "Branded PDF is part of Pro"}
          >
            {preparingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          </button>
          <button
            type="button"
            className="icon-btn hidden sm:inline-flex"
            onClick={() => {
              const opened = printSession(session);
              if (!opened) toast.error("Allow pop-ups to print or save as PDF.");
            }}
            disabled={!hasContent}
            title="Print or save as PDF"
            aria-label="Print or save as PDF"
          >
            <Printer className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShareOpen(true)}
            disabled={!hasContent}
            title="Share a read-only link"
            aria-label="Share a read-only link"
          >
            <Link2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setFollowUpOpen(true)}
            disabled={!session.notes}
            title="Send the follow-up"
            aria-label="Send the follow-up"
          >
            <Send className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setNoticeOpen(true)}
            title="Listening notice"
            aria-label="Listening notice"
          >
            <Megaphone className="h-4 w-4" />
          </button>
          <span className="mx-1 h-5 w-px bg-line" />
          <button
            type="button"
            className="icon-btn hover:text-rec"
            onClick={() => setConfirmDelete(true)}
            title="Delete session"
            aria-label="Delete session"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <header className="mt-4 border-b border-line pb-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <KindBadge kind={session.kind} />
          <span className="hidden text-[13.5px] text-muted sm:inline">{meta.date}</span>
          <span className="text-[13.5px] text-muted sm:hidden">
            {format(session.createdAt, "d MMM · HH:mm")}
          </span>
          {meta.duration && (
            <>
              <span className="text-faint">·</span>
              <span className="text-[13.5px] tabular-nums text-muted">{meta.duration}</span>
            </>
          )}
          {isSample(session.id) && <span className="chip">Example</span>}
          <SessionStatusChip session={session} />
        </div>
        <h1 className="sr-only">{session.title}</h1>
        <input
          className="mt-2.5 w-full min-w-0 rounded-md border-b border-transparent bg-transparent pb-1 text-[28px] font-semibold leading-tight tracking-[-0.04em] text-ink outline-none transition-colors hover:border-line focus:border-accent sm:text-[34px]"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          aria-label="Session title"
          spellCheck={false}
        />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-faint">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            {session.notes?.source === "studio"
              ? "Written from the spoken words and your jottings"
              : session.notes
                ? "Quick notes · written on this device"
                : "Notes have not been written yet"}
          </span>
          {session.notes && <span className="hidden sm:inline">·</span>}
          {session.notes && <span>{openCount} open action{openCount === 1 ? "" : "s"}</span>}
        </div>
      </header>

      <div className="mt-6 grid gap-7 xl:grid-cols-[minmax(0,1fr)_330px] 2xl:grid-cols-[minmax(0,1fr)_370px] xl:gap-8">
        <div className="min-w-0">
          {!processing && <SessionAsk session={session} />}

          {processing && (
            <div className="card p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg bg-accent-soft text-accent">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </span>
                <div>
                  <p className="text-[16px] font-semibold text-ink">Reading the recording</p>
                  <p className="mt-1 text-[14.5px] leading-5 text-muted">
                    Tidying the spoken words and writing the notes. You can leave this page. It keeps working.
                  </p>
                </div>
              </div>
              <div className="writing-track mt-5">
                <div className="writing-bar" />
              </div>
              <NoteSkeleton />
            </div>
          )}

          {failed && (
            <div className="rounded-xl border border-rec-line bg-rec-soft p-4">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-rec" />
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-ink">{failureTitle}</p>
                  <p className="mt-1 break-words text-[14px] leading-5 text-soft">
                    {session.error ?? "Something went wrong after the recording stopped."}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-line btn-sm"
                  onClick={() => void retry()}
                  disabled={rebuilding || !canRetry}
                >
                  {rebuilding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  Try again
                </button>
                <button type="button" className="btn btn-line btn-sm" onClick={openTranscriptEditor}>
                  <FilePlus2 className="h-3.5 w-3.5" />
                  Add spoken words
                </button>
              </div>
            </div>
          )}

          {orphanedLive && !processing && (
            <div className="rounded-xl border border-line bg-accent-soft px-4 py-3">
              <p className="text-[14.5px] font-medium text-ink">This capture is not running right now.</p>
              <p className="mt-1 text-[13.5px] leading-5 text-muted">
                If the tab closed mid-session, the audio is gone but the spoken words that made it survive. Write the
                notes from what is here.
              </p>
              <button type="button" className="btn btn-line btn-sm mt-2.5" onClick={() => void regenerate()}>
                <Wand2 className="h-3.5 w-3.5" />
                Write notes from what is here
              </button>
            </div>
          )}

          {!processing && showNotes && session.notes && (
            <article className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">
                  {preset.summaryLabel}
                </h2>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm -mr-2 text-[13px]"
                  onClick={() => void regenerate()}
                  disabled={rebuilding}
                  title="Rewrite the notes from the spoken words and jottings"
                >
                  {rebuilding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  Rewrite
                </button>
              </div>
              <p className="mt-2.5 max-w-[70ch] text-[21.5px] font-normal leading-[1.55] tracking-[0.002em] text-soft sm:text-[23px]">
                {session.notes.summary}
              </p>

              {session.notes.highlights.length > 0 && (
                <section className="mt-8">
                  <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">
                    {preset.highlightsLabel}
                  </h2>
                  <ul className="mt-3 space-y-2.5">
                    {session.notes.highlights.map((highlight) => (
                      <li key={highlight} className="flex gap-3">
                        <span className="bullet-dot" />
                        <p className="text-[16px] leading-6 text-soft">{highlight}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {session.notes.decisions && session.notes.decisions.length > 0 && (
                <section className="mt-8">
                  <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">
                    {preset.decisionsLabel}
                  </h2>
                  <ul className="mt-3 space-y-2.5">
                    {session.notes.decisions.map((decision) => (
                      <li key={decision} className="flex gap-3">
                        <Check className="mt-1 h-3.5 w-3.5 flex-none text-accent" strokeWidth={2.5} />
                        <p className="text-[16px] leading-6 text-soft">{decision}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {session.notes.actions.length > 0 && (
                <section className="mt-8">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">
                      {preset.actionsLabel}
                    </h2>
                    <span className="text-[12.5px] tabular-nums text-faint">
                      {openCount} of {session.notes.actions.length} open
                    </span>
                  </div>
                  <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
                    {session.notes.actions.map((action) => (
                      <li key={action.id} className="flex items-start gap-3 px-3.5 py-3">
                        <button
                          type="button"
                          className="action-box mt-0.5"
                          data-done={action.done}
                          onClick={() => toggleAction(session.id, action.id)}
                          aria-pressed={action.done}
                          aria-label={`${action.done ? "Reopen" : "Complete"} action: ${action.text}`}
                        >
                          {action.done && <Check className="h-3 w-3" strokeWidth={3} />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p
                            className={clsx(
                              "text-[15.5px] leading-5",
                              action.done ? "text-faint line-through" : "text-soft",
                            )}
                          >
                            {action.text}
                          </p>
                          <p className="mt-1 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-faint">
                            {action.owner}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {session.notes.sections.map((section) => (
                <section key={section.heading} className="mt-8">
                  <h2 className="text-[17.5px] font-semibold tracking-[-0.02em] text-ink">{section.heading}</h2>
                  <ul className="mt-2.5 space-y-2">
                    {section.bullets.map((bullet) => (
                      <li key={bullet} className="flex gap-3">
                        <span className="bullet-dot" />
                        <p className="text-[16px] leading-6 text-soft">{bullet}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

              <p className="mt-10 border-t border-line pt-3 text-[12.5px] leading-5 text-faint">
                Notes are a summary of what was said, not a word-for-word record. Check names, numbers, and owners
                before you send them on.
              </p>
            </article>
          )}

          {!processing && !showNotes && !failed && (
            <div className="mt-5">
              <EmptyState
                icon={<FileText className="h-5 w-5" />}
                title={failed ? "No notes yet" : "Nothing written down yet"}
                body={
                  session.hasAudio
                    ? "The recording is still on this device. Try reading it again, or add the spoken words by hand."
                    : session.transcript.length
                      ? "There are spoken words to work from. Ask JotBox to write the summary, points, and actions."
                      : "Add the spoken words, or jot what you remember, and JotBox can still shape it into notes."
                }
              >
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void retry()}
                  disabled={rebuilding || !canRetry}
                >
                  {rebuilding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  {session.hasAudio && !session.transcript.length ? "Try the recording again" : "Write the notes"}
                </button>
                <button type="button" className="btn btn-line" onClick={openTranscriptEditor}>
                  <FilePlus2 className="h-4 w-4" />
                  Add spoken words
                </button>
              </EmptyState>
            </div>
          )}

          {editing && (
            <div className="card mt-6 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[16px] font-semibold text-ink">Add the spoken words</h2>
                  <p className="mt-1 text-[13.5px] leading-5 text-muted">
                    Paste what was said. One line per turn works best, and the order is kept.
                  </p>
                </div>
                <button type="button" className="icon-btn h-7 w-7" onClick={() => setEditing(false)} aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <textarea
                className="field mt-3 min-h-[190px] resize-y font-sans text-[15px] leading-6"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={"Ada: Friday's volume is still pending.\nChinedu: The bank acknowledged the file late.\nYou: Then we pause the same-day promise."}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12.5px] text-faint">Notes will be rewritten from these words.</p>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void saveTranscript()}
                    disabled={savingTranscript || !draft.trim()}
                  >
                    {savingTranscript ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                    Save & write notes
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="min-w-0 xl:sticky xl:top-6 xl:self-start">
          <div className="mb-2 flex items-center justify-between px-0.5">
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-faint">Source</p>
            <span className="flex items-center gap-1 text-[12px] text-faint">
              <PencilLine className="h-3 w-3" />
              {session.scratch.trim() ? "Jottings saved" : "No jottings"}
            </span>
          </div>
          <Panel
            session={session}
            onEditTranscript={openTranscriptEditor}
          />
          <PeopleCard session={session} />
        </aside>
      </div>

      <ShareDialog session={session} open={shareOpen} onClose={() => setShareOpen(false)} />
      <FollowUpDialog session={session} open={followUpOpen} onClose={() => setFollowUpOpen(false)} />
      <PaywallDialog
        open={pdfPaywall}
        onClose={() => setPdfPaywall(false)}
        title="Branded PDF is part of Pro"
        description="Copy, Markdown and print stay free. Pro adds the branded PDF you can send to a client."
      />
      <NoticeDialog
        open={noticeOpen}
        onClose={() => setNoticeOpen(false)}
        input={{
          title: session.title,
          kind: session.kind,
          createdAt: session.createdAt,
          participants: session.participants,
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this session?"
        description="The notes, spoken words, and audio on this device will be removed. This cannot be undone."
        confirmLabel="Delete session"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

