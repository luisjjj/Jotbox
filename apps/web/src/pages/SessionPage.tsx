import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ChangeEvent, type ElementType, type FocusEvent, type KeyboardEvent } from "react";
import clsx from "clsx";
import { format } from "date-fns";
import {
  AlertCircle,
  AlignLeft,
  ArrowLeft,
  Check,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  FilePlus2,
  FileText,
  Layers,
  Languages,
  Link2,
  ListChecks,
  Loader2,
  Megaphone,
  Pause,
  PencilLine,
  Play,
  Plus,
  Printer,
  Send,
  Trash2,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useAuth } from "@/auth/AuthProvider";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { FollowUpDialog } from "@/components/FollowUpDialog";
import { JiraHandoffDialog } from "@/components/JiraHandoffDialog";
import { Modal } from "@/components/Modal";
import { NoticeDialog } from "@/components/NoticeDialog";
import { PaywallDialog } from "@/components/Paywall";
import { PeopleCard } from "@/components/PeopleCard";
import { ReportLoading } from "@/components/ReportLoading";
import { SessionAsk, type SessionAskHandle } from "@/components/SessionAsk";
import { SessionRecipes } from "@/components/SessionRecipes";
import { ShareDialog } from "@/components/ShareDialog";
import { StudyShareDialog } from "@/components/StudyShareDialog";
import { KindBadge } from "@/components/KindBadge";
import { SessionStatusChip } from "@/components/SessionRow";
import { TranscriptView } from "@/components/TranscriptView";
import { deleteAudio, loadAudio } from "@/lib/audioStore";
import { api, type JiraHandoffLink, type ReportLanguage, type TranslatedReport } from "@/lib/api";
import { buildNotes, studioAvailable } from "@/lib/buildNotes";
import { actionsChecklist, copyNotes, downloadMarkdown, printSession } from "@/lib/exportNotes";
import type { FollowUpChannel } from "@/lib/followUp";
import { downloadSessionPdf } from "@/lib/pdf";
import { formatClock, isDefaultTitle, notesLookEmpty } from "@/lib/format";
import { OUTPUT_PRESETS } from "@/lib/presets";
import posthog, { posthogEnabled } from "@/lib/posthog";
import {
  mergeTranslatedReport,
  reportLanguageLabel,
  reportTranslationInput,
  REPORT_LANGUAGES,
} from "@/lib/reportTranslation";
import { isSample } from "@/lib/seed";
import { useSessions } from "@/lib/store";
import { linesFromText, spokenLines } from "@/lib/transcript";
import type { FollowUpDraft, Session, SessionNotes, TranscriptLine } from "@/lib/types";
import { ensurePro, refreshUsage, usePlan } from "@/lib/usageStore";
import { useEngine } from "@/engine/SessionEngine";
import { useAudioUrl } from "@/hooks/useAudio";

interface AudioHandle {
  seek: (seconds: number) => void;
}

function dueLabel(due: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  return format(new Date(`${due}T00:00:00`), "d MMM");
}

const EMPTY_PLACEHOLDER = "Write here";

function EditableText({
  value,
  editing,
  onCommit,
  className,
  as = "p",
  multiline = false,
  label,
}: {
  value: string;
  editing: boolean;
  onCommit: (text: string) => void;
  className?: string;
  as?: ElementType;
  multiline?: boolean;
  label?: string;
}) {
  const Tag = as;
  return (
    <Tag
      className={clsx(
        className,
        editing && "rounded-md bg-raised outline-none ring-1 ring-line transition-shadow focus:ring-2 focus:ring-accent",
      )}
      contentEditable={editing}
      suppressContentEditableWarning
      spellCheck={editing}
      role={editing ? "textbox" : undefined}
      aria-label={label}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        if (!editing || multiline || event.key !== "Enter") return;
        event.preventDefault();
        event.currentTarget.blur();
      }}
      onBlur={(event: FocusEvent<HTMLElement>) => {
        if (!editing) return;
        const raw = event.currentTarget.innerText.replace(/\u00a0/g, " ");
        const text = (multiline ? raw : raw.replace(/\s*\n+\s*/g, " ")).trim();
        if (text === value) return;
        onCommit(text);
      }}
      data-placeholder={label === "Summary" ? "Write the summary" : EMPTY_PLACEHOLDER}
    >
      {value}
    </Tag>
  );
}

function RemoveItem({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className="icon-btn h-6 w-6 flex-none text-faint hover:text-rec"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
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
  const [searchParams] = useSearchParams();
  const startAt = Number(searchParams.get("t"));

  // A memory citation links to the exact second it quoted.
  useEffect(() => {
    if (!audioUrl || !Number.isFinite(startAt) || startAt <= 0) return;
    const timer = window.setTimeout(() => audioRef.current?.seek(startAt), 350);
    return () => window.clearTimeout(timer);
  }, [audioUrl, startAt]);

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

export default function SessionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const session = useSessions((state) => state.sessions.find((item) => item.id === id));
  const patch = useSessions((state) => state.patch);
  const toggleAction = useSessions((state) => state.toggleAction);
  const remove = useSessions((state) => state.remove);
  const engine = useEngine();
  const { pro, loaded: planLoaded } = usePlan();
  const { user } = useAuth();

  const [title, setTitle] = useState(session?.title ?? "");
  const [copying, setCopying] = useState(false);
  const [preparingPdf, setPreparingPdf] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [studyOpen, setStudyOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpChannel, setFollowUpChannel] = useState<FollowUpChannel>("whatsapp");
  const askRef = useRef<SessionAskHandle>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [pdfPaywall, setPdfPaywall] = useState(false);
  const [jiraOpen, setJiraOpen] = useState(false);
  const [handoffs, setHandoffs] = useState<JiraHandoffLink[]>([]);
  const [editReport, setEditReport] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translation, setTranslation] = useState<{ language: ReportLanguage; report: TranslatedReport } | null>(null);
  const [studyFormat, setStudyFormat] = useState<"note" | "quiz" | "cards">("note");

  useEffect(() => {
    setHandoffs([]);
    if (!session?.notes?.actions.length) return;
    let alive = true;
    api
      .sessionHandoffs(session.id)
      .then((links) => {
        if (alive) setHandoffs(links);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session?.id, session?.notes?.actions.length]);

  useEffect(() => {
    setTitle(session?.title ?? "");
  }, [session?.id, session?.title]);

  useEffect(() => {
    setEditReport(false);
    setTranslation(null);
    setTranslateOpen(false);
  }, [session?.id]);

  useEffect(() => {
    if (session) document.title = `${session.title} · JotBox`;
    return () => {
      document.title = "JotBox: the notes are written while you listen";
    };
  }, [session?.title, session]);

  const viewNotes = useMemo(
    () => (session?.notes ? mergeTranslatedReport(session.notes, translation?.report ?? null) : null),
    [session?.notes, translation],
  );

  const openCount = viewNotes?.actions.filter((action) => !action.done).length ?? 0;
  const doneCount = (viewNotes?.actions.length ?? 0) - openCount;
  const decisionCount = viewNotes?.decisions?.length ?? 0;
  const blockerCount = viewNotes?.blockers?.length ?? 0;
  const handoffById = useMemo(() => new Map(handoffs.map((link) => [link.actionId, link])), [handoffs]);
  const preset = session ? OUTPUT_PRESETS[session.kind] : OUTPUT_PRESETS.meeting;

  const updateNotes = (mutate: (notes: SessionNotes) => SessionNotes) => {
    if (!session?.notes) return;
    patch(session.id, { notes: mutate(session.notes) });
  };

  const setSummary = (text: string) => {
    if (!text) return;
    updateNotes((notes) => ({ ...notes, summary: text }));
  };

  const setListText = (key: "highlights" | "decisions" | "blockers", index: number, text: string) => {
    updateNotes((notes) => {
      const list = [...(notes[key] ?? [])];
      if (!text) list.splice(index, 1);
      else list[index] = text;
      return { ...notes, [key]: list };
    });
  };

  const addListText = (key: "highlights" | "decisions" | "blockers") => {
    updateNotes((notes) => ({ ...notes, [key]: [...(notes[key] ?? []), ""] }));
  };

  const setActionText = (actionId: string, text: string) => {
    updateNotes((notes) => {
      if (!text) return { ...notes, actions: notes.actions.filter((action) => action.id !== actionId) };
      return {
        ...notes,
        actions: notes.actions.map((action) => (action.id === actionId ? { ...action, text } : action)),
      };
    });
  };

  const addActionRow = () => {
    updateNotes((notes) => ({
      ...notes,
      actions: [
        ...notes.actions,
        { id: crypto.randomUUID(), text: "", owner: "Unassigned", done: false },
      ],
    }));
  };

  const removeActionRow = (actionId: string) => {
    updateNotes((notes) => ({ ...notes, actions: notes.actions.filter((action) => action.id !== actionId) }));
  };

  const setSectionHeading = (index: number, text: string) => {
    if (!text) return;
    updateNotes((notes) => ({
      ...notes,
      sections: notes.sections.map((section, at) => (at === index ? { ...section, heading: text } : section)),
    }));
  };

  const setSectionBullet = (index: number, bulletIndex: number, text: string) => {
    updateNotes((notes) => ({
      ...notes,
      sections: notes.sections.map((section, at) => {
        if (at !== index) return section;
        const bullets = [...section.bullets];
        if (!text) bullets.splice(bulletIndex, 1);
        else bullets[bulletIndex] = text;
        return { ...section, bullets };
      }),
    }));
  };

  const addSection = () => {
    updateNotes((notes) => ({
      ...notes,
      sections: [...notes.sections, { heading: "New section", bullets: [""] }],
    }));
  };

  const removeSection = (index: number) => {
    updateNotes((notes) => ({ ...notes, sections: notes.sections.filter((_, at) => at !== index) }));
  };

  const addSectionBullet = (index: number) => {
    updateNotes((notes) => ({
      ...notes,
      sections: notes.sections.map((section, at) =>
        at === index ? { ...section, bullets: [...section.bullets, ""] } : section,
      ),
    }));
  };

  const jumpTo = (section: string) => {
    document.getElementById(`report-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openStudy = (format: "note" | "quiz" | "cards") => {
    setStudyFormat(format);
    setStudyOpen(true);
  };

  const trackRecipe = (recipe: string) => {
    if (!session) return;
    if (posthogEnabled) posthog.capture("session_recipe_used", { recipe, session_kind: session.kind });
  };

  const openFollowUp = (channel: FollowUpChannel) => {
    trackRecipe(channel === "email" ? "follow_up_email" : "follow_up");
    setFollowUpChannel(channel);
    setFollowUpOpen(true);
  };

  const copyActions = async () => {
    if (!session) return;
    const text = actionsChecklist(session);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      trackRecipe("actions");
      toast.success("Action list copied");
    } catch {
      toast.error("Copy failed. Select the list and copy it.");
    }
  };

  const explainSession = () => {
    if (!session) return;
    trackRecipe("explain");
    askRef.current?.ask(OUTPUT_PRESETS[session.kind].explainQuestion);
  };

  const resumeJobId = session?.status === "processing" ? session.jobId : undefined;
  const engineOwnsJob = engine.status === "processing" && engine.sessionId === session?.id;

  // A long recording can outlive the capture screen. Pick the job back up here
  // so the session finishes even after a reload.
  useEffect(() => {
    if (!resumeJobId || !id || engineOwnsJob) return;
    let alive = true;
    let timer = 0;
    let delay = 900;
    const poll = async () => {
      try {
        const job = await api.getTranscribeJob(resumeJobId);
        if (!alive) return;
        if (job.result?.lines.length) {
          patch(id, {
            transcript: job.result.lines,
            ...(job.result.title ? { title: job.result.title } : {}),
          });
        }
        if (job.status === "done" && job.result?.notes) {
          patch(id, {
            status: "ready",
            title: job.result.title,
            transcript: job.result.lines,
            notes: job.result.notes,
            error: undefined,
            jobId: undefined,
          });
          void refreshUsage();
          return;
        }
        if (job.status === "done") {
          patch(id, {
            status: "failed",
            error: "The notes came back empty. Try again.",
            jobId: undefined,
          });
          return;
        }
        if (job.status === "failed") {
          patch(id, {
            status: "failed",
            error: job.error || "The notes could not be written.",
            jobId: undefined,
          });
          return;
        }
      } catch {
        // A dropped poll is fine. Try again with a longer gap.
      }
      delay = Math.min(5000, Math.round(delay * 1.4));
      if (alive) timer = window.setTimeout(() => void poll(), delay);
    };
    timer = window.setTimeout(() => void poll(), delay);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [resumeJobId, id, engineOwnsJob, patch]);

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
      setTranslation(null);
      if (posthogEnabled) {
        posthog.capture("session_notes_regenerated", {
          session_kind: session.kind,
          notes_source: result.notes.source,
        });
      }
      toast.success(audio ? "Words and notes are ready" : ai ? "Notes rewritten" : "Notes written on this device");
      return true;
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The notes could not be written.");
      return false;
    } finally {
      setRebuilding(false);
    }
  };

  const translateReport = async (language: ReportLanguage) => {
    if (!session?.notes) return;
    setTranslating(true);
    try {
      const report = await api.translateReport(language, reportTranslationInput(session.notes));
      setTranslation({ language, report });
      setTranslateOpen(false);
      setEditReport(false);
      toast.success(`Report translated to ${reportLanguageLabel(language)}`);
      if (posthogEnabled) {
        posthog.capture("session_report_translated", {
          session_kind: session.kind,
          language,
        });
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The report could not be translated.");
    } finally {
      setTranslating(false);
    }
  };

  const openTranscriptEditor = () => {
    setDraft(spokenLines(session.transcript).map((line) => line.text).join("\n"));
    setEditing(true);
  };

  const retry = async () => {
    // Words already in hand only need the notes rewritten; only a session with
    // no words at all pays for another read of the saved file.
    if (!session.hasAudio || session.transcript.length > 0) {
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
      setTranslation(null);
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

  const copyDraft = async (draft: FollowUpDraft) => {
    try {
      const header = [draft.to ? `To: ${draft.to}` : "", `Subject: ${draft.subject}`].filter(Boolean).join("\n");
      await navigator.clipboard.writeText(`${header}\n\n${draft.body}`);
      toast.success("Draft copied");
    } catch {
      toast.error("Copy failed.");
    }
  };

  const savePdf = async () => {
    const isPro = await ensurePro();
    if (isPro === false) {
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
    if (liveHere) {
      toast.error("Stop the capture before deleting it.");
      return;
    }
    remove(session.id);
    if (posthogEnabled) posthog.capture("session_deleted", { session_kind: session.kind });
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
  const liveHere =
    engine.sessionId === session.id && (engine.status === "recording" || engine.status === "paused");
  const pdfPro = pro || !planLoaded;
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
            title={pdfPro ? "Download a branded PDF" : "Branded PDF is part of Pro"}
            aria-label={pdfPro ? "Download a branded PDF" : "Branded PDF is part of Pro"}
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
          {user?.role === "student" && !isSample(session.id) && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => openStudy("note")}
              disabled={!session.notes}
              title="Share with a study group"
              aria-label="Share with a study group"
            >
              <Users className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={() => openFollowUp("whatsapp")}
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
            disabled={liveHere}
            title={liveHere ? "Stop the capture before deleting it" : "Delete session"}
            aria-label={liveHere ? "Stop the capture before deleting it" : "Delete session"}
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
          className="mt-2.5 min-h-11 w-full min-w-0 rounded-md border-b border-transparent bg-transparent pb-1 text-[28px] font-semibold leading-tight tracking-[-0.04em] text-ink outline-none transition-colors hover:border-line focus:border-accent sm:text-[34px]"
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
            <FileText className="h-3 w-3" />
            {session.notes?.source === "studio"
              ? "From the recording"
              : session.notes
                ? "On this device"
                : "No notes yet"}
          </span>
          {session.notes && <span className="hidden sm:inline">·</span>}
          {session.notes && <span>{openCount} open action{openCount === 1 ? "" : "s"}</span>}
        </div>
      </header>

      <div className="mt-6 grid gap-7 xl:grid-cols-[minmax(0,1fr)_330px] 2xl:grid-cols-[minmax(0,1fr)_370px] xl:gap-8">
        <div className="min-w-0">
          {!processing && showNotes && (
            <SessionRecipes
              session={session}
              isStudent={user?.role === "student" && !isSample(session.id)}
              onFollowUp={() => openFollowUp("email")}
              onCopyActions={() => void copyActions()}
              onExplain={explainSession}
              onStudy={openStudy}
            />
          )}

          {!processing && <SessionAsk ref={askRef} session={session} />}

          {processing && (
            <div className="space-y-4">
              <ReportLoading hasWords={session.transcript.length > 0} />
              {session.transcript.length > 0 && (
                <div className="card p-4">
                  <p className="label">Words so far</p>
                  <TranscriptView
                    lines={session.transcript}
                    live
                    className="mt-2.5 max-h-[min(52vh,30rem)] rounded-lg border border-line px-3.5 py-2"
                  />
                </div>
              )}
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

          {!processing && showNotes && viewNotes && (
            <article className="mt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">Report</h2>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className={clsx("btn btn-sm text-[13px]", translation ? "btn-line" : "btn-ghost")}
                    onClick={() => setTranslateOpen(true)}
                    disabled={translating}
                    title="Read this report in another Nigerian language"
                  >
                    {translating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
                    {translation ? reportLanguageLabel(translation.language) : "Translate"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-[13px]"
                    onClick={() => void regenerate()}
                    disabled={rebuilding}
                    title="Rewrite the notes from the spoken words and jottings"
                  >
                    {rebuilding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                    Rewrite
                  </button>
                  {!translation && (
                    <button
                      type="button"
                      className={clsx("btn btn-sm", editReport ? "btn-primary" : "btn-line")}
                      onClick={() => setEditReport((current) => !current)}
                    >
                      {editReport ? <Check className="h-3.5 w-3.5" /> : <PencilLine className="h-3.5 w-3.5" />}
                      {editReport ? "Done" : "Edit"}
                    </button>
                  )}
                </div>
              </div>

              {translation && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-accent-soft px-3.5 py-2.5">
                  <p className="text-[13px] leading-5 text-soft">
                    Showing the {reportLanguageLabel(translation.language)} translation. Your report is unchanged.
                  </p>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-[12.5px]"
                    onClick={() => setTranslation(null)}
                  >
                    Show original
                  </button>
                </div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <button
                  type="button"
                  className="card p-3.5 text-left transition-colors hover:border-line-strong"
                  onClick={() => jumpTo("actions")}
                >
                  <span className="flex items-center justify-between">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent">
                      <ListChecks className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-[20px] font-semibold tabular-nums text-ink">{openCount}</span>
                  </span>
                  <span className="mt-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                    Next steps
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-muted">
                    {doneCount} done
                  </span>
                </button>
                <button
                  type="button"
                  className="card p-3.5 text-left transition-colors hover:border-line-strong"
                  onClick={() => jumpTo("decisions")}
                >
                  <span className="flex items-center justify-between">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent">
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </span>
                    <span className="text-[20px] font-semibold tabular-nums text-ink">{decisionCount}</span>
                  </span>
                  <span className="mt-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                    Decisions
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-muted">
                    {decisionCount ? "Agreed" : "None yet"}
                  </span>
                </button>
                <button
                  type="button"
                  className="card p-3.5 text-left transition-colors hover:border-line-strong"
                  onClick={() => jumpTo("blockers")}
                >
                  <span className="flex items-center justify-between">
                    <span
                      className={clsx(
                        "grid h-7 w-7 place-items-center rounded-lg",
                        blockerCount ? "bg-rec-soft text-rec" : "bg-accent-soft text-accent",
                      )}
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-[20px] font-semibold tabular-nums text-ink">{blockerCount}</span>
                  </span>
                  <span className="mt-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                    Blockers
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-muted">
                    {blockerCount ? "Needs attention" : "None"}
                  </span>
                </button>
                <button
                  type="button"
                  className="card p-3.5 text-left transition-colors hover:border-line-strong"
                  onClick={() => jumpTo("points")}
                >
                  <span className="flex items-center justify-between">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent">
                      <AlignLeft className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-[20px] font-semibold tabular-nums text-ink">
                      {viewNotes.highlights.length}
                    </span>
                  </span>
                  <span className="mt-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                    Key points
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-muted">
                    {viewNotes.highlights.length === 1 ? "1 point" : `${viewNotes.highlights.length} points`}
                  </span>
                </button>
              </div>

              <section className="mt-7">
                <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">
                  {preset.summaryLabel}
                </h2>
                <EditableText
                  as="p"
                  multiline
                  value={viewNotes.summary}
                  editing={editReport}
                  onCommit={setSummary}
                  label="Summary"
                  className="mt-2.5 max-w-[70ch] whitespace-pre-line text-[21.5px] font-normal leading-[1.55] tracking-[0.002em] text-soft sm:text-[23px]"
                />
              </section>

              {(viewNotes.highlights.length > 0 || editReport) && (
                <section className="mt-8" id="report-points">
                  <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">
                    {preset.highlightsLabel}
                  </h2>
                  <ul className="mt-3 space-y-2.5">
                    {viewNotes.highlights.map((highlight, index) => (
                      <li key={`${index}-${highlight.slice(0, 16)}`} className="flex gap-3">
                        <span className="bullet-dot" />
                        <EditableText
                          value={highlight}
                          editing={editReport}
                          onCommit={(text) => setListText("highlights", index, text)}
                          label="Key point"
                          className="max-w-[68ch] flex-1 text-[16px] leading-6 text-soft"
                        />
                        {editReport && (
                          <RemoveItem onClick={() => setListText("highlights", index, "")} label="Remove point" />
                        )}
                      </li>
                    ))}
                  </ul>
                  {editReport && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm mt-2 -ml-2 text-[13px]"
                      onClick={() => addListText("highlights")}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add point
                    </button>
                  )}
                </section>
              )}

              {(decisionCount > 0 || editReport) && (
                <section className="mt-8" id="report-decisions">
                  <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">
                    {preset.decisionsLabel}
                  </h2>
                  <ul className="mt-3 space-y-2.5">
                    {(viewNotes.decisions ?? []).map((decision, index) => (
                      <li key={`${index}-${decision.slice(0, 16)}`} className="flex gap-3">
                        <Check className="mt-1 h-3.5 w-3.5 flex-none text-accent" strokeWidth={2.5} />
                        <EditableText
                          value={decision}
                          editing={editReport}
                          onCommit={(text) => setListText("decisions", index, text)}
                          label="Decision"
                          className="max-w-[68ch] flex-1 text-[16px] leading-6 text-soft"
                        />
                        {editReport && (
                          <RemoveItem onClick={() => setListText("decisions", index, "")} label="Remove decision" />
                        )}
                      </li>
                    ))}
                  </ul>
                  {editReport && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm mt-2 -ml-2 text-[13px]"
                      onClick={() => addListText("decisions")}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add decision
                    </button>
                  )}
                </section>
              )}

              {(blockerCount > 0 || editReport) && (
                <section className="mt-8" id="report-blockers">
                  <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">
                    {preset.blockersLabel}
                  </h2>
                  <ul className="mt-3 space-y-2">
                    {(viewNotes.blockers ?? []).map((blocker, index) => (
                      <li
                        key={`${index}-${blocker.slice(0, 16)}`}
                        className="flex gap-2.5 rounded-xl border border-rec-line bg-rec-soft px-3.5 py-3"
                      >
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-rec" />
                        <EditableText
                          value={blocker}
                          editing={editReport}
                          onCommit={(text) => setListText("blockers", index, text)}
                          label="Blocker"
                          className="flex-1 text-[15.5px] leading-6 text-soft"
                        />
                        {editReport && (
                          <RemoveItem onClick={() => setListText("blockers", index, "")} label="Remove blocker" />
                        )}
                      </li>
                    ))}
                  </ul>
                  {editReport && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm mt-2 -ml-2 text-[13px]"
                      onClick={() => addListText("blockers")}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add blocker
                    </button>
                  )}
                </section>
              )}

              {(viewNotes.actions.length > 0 || editReport) && (
                <section className="mt-8" id="report-actions">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">
                      {preset.actionsLabel}
                    </h2>
                    <div className="flex items-center gap-3">
                      <span className="text-[12.5px] tabular-nums text-faint">
                        {openCount} of {viewNotes.actions.length} open
                      </span>
                      <button
                        type="button"
                        className="btn btn-line btn-sm"
                        onClick={() => setJiraOpen(true)}
                        disabled={!viewNotes.actions.length}
                      >
                        <Send className="h-3.5 w-3.5" />
                        Send to Jira
                      </button>
                    </div>
                  </div>
                  <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
                    {viewNotes.actions.map((action) => {
                      const jiraLink = handoffById.get(action.id);
                      return (
                        <li key={action.id} className="flex items-start gap-3 px-3.5 py-3">
                          <button
                            type="button"
                            className="action-box mt-0.5"
                            data-done={action.done}
                            onClick={() => {
                              toggleAction(session.id, action.id);
                              if (posthogEnabled) {
                                posthog.capture("session_action_toggled", {
                                  session_kind: session.kind,
                                  completed: !action.done,
                                });
                              }
                            }}
                            aria-pressed={action.done}
                            aria-label={`${action.done ? "Reopen" : "Complete"} action: ${action.text}`}
                          >
                            {action.done && <Check className="h-3 w-3" strokeWidth={3} />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <EditableText
                              value={action.text}
                              editing={editReport}
                              onCommit={(text) => setActionText(action.id, text)}
                              label="Next step"
                              className={clsx(
                                "text-[15.5px] leading-5",
                                action.done ? "text-faint line-through" : "text-soft",
                              )}
                            />
                            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-faint">
                              <span>{action.owner}</span>
                              {action.due && <span className="text-rec">Due {dueLabel(action.due)}</span>}
                            </p>
                            {jiraLink ? (
                              <a
                                href={jiraLink.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" />
                                {jiraLink.key}
                              </a>
                            ) : null}
                          </div>
                          {editReport && (
                            <RemoveItem onClick={() => removeActionRow(action.id)} label="Remove next step" />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {editReport && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm mt-2 -ml-2 text-[13px]"
                      onClick={addActionRow}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add next step
                    </button>
                  )}
                </section>
              )}

              {user?.role === "student" && !isSample(session.id) && (
                <section className="mt-8 rounded-xl border border-line bg-accent-soft p-4">
                  <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">
                    Study tools
                  </h2>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      className="btn btn-line justify-center"
                      onClick={() => openStudy("cards")}
                    >
                      <Layers className="h-4 w-4" />
                      Flashcards
                    </button>
                    <button
                      type="button"
                      className="btn btn-line justify-center"
                      onClick={() => openStudy("quiz")}
                    >
                      <CircleHelp className="h-4 w-4" />
                      Quiz
                    </button>
                    <button
                      type="button"
                      className="btn btn-line justify-center"
                      onClick={() => openStudy("note")}
                    >
                      <Users className="h-4 w-4" />
                      Share with group
                    </button>
                  </div>
                </section>
              )}

              {viewNotes.followUps && viewNotes.followUps.length > 0 && (
                <section className="mt-8">
                  <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-faint">
                    {preset.followUpsLabel}
                  </h2>
                  <ul className="mt-3 space-y-2.5">
                    {viewNotes.followUps.map((draft, index) => (
                      <li
                        key={`${draft.subject}-${index}`}
                        className="rounded-xl border border-line bg-raised px-3.5 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[14.5px] font-medium text-ink">{draft.subject}</p>
                            <p className="mt-0.5 text-[12px] text-faint">
                              {draft.to ? `To ${draft.to}` : "No one named yet"}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="icon-btn h-7 w-7 flex-none"
                            aria-label={`Copy ${draft.subject}`}
                            title="Copy draft"
                            onClick={() => void copyDraft(draft)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="mt-2 max-w-[68ch] whitespace-pre-line text-[14.5px] leading-6 text-soft">{draft.body}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(viewNotes.sections.length > 0 || editReport) && (
                <div id="report-sections">
                  {viewNotes.sections.map((section, index) => (
                    <section key={index} className="mt-8">
                      <div className="flex items-start justify-between gap-2">
                        <EditableText
                          as="h2"
                          value={section.heading}
                          editing={editReport}
                          onCommit={(text) => setSectionHeading(index, text)}
                          label="Section heading"
                          className="text-[17.5px] font-semibold tracking-[-0.02em] text-ink"
                        />
                        {editReport && (
                          <RemoveItem onClick={() => removeSection(index)} label="Remove section" />
                        )}
                      </div>
                      <ul className="mt-2.5 space-y-2">
                        {section.bullets.map((bullet, bulletIndex) => (
                          <li key={bulletIndex} className="flex gap-3">
                            <span className="bullet-dot" />
                            <EditableText
                              value={bullet}
                              editing={editReport}
                              onCommit={(text) => setSectionBullet(index, bulletIndex, text)}
                              label="Section detail"
                              className="max-w-[68ch] flex-1 text-[16px] leading-6 text-soft"
                            />
                            {editReport && (
                              <RemoveItem
                                onClick={() => setSectionBullet(index, bulletIndex, "")}
                                label="Remove detail"
                              />
                            )}
                          </li>
                        ))}
                      </ul>
                      {editReport && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm mt-2 -ml-2 text-[13px]"
                          onClick={() => addSectionBullet(index)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add detail
                        </button>
                      )}
                    </section>
                  ))}
                  {editReport && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm mt-4 -ml-2 text-[13px]"
                      onClick={addSection}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add section
                    </button>
                  )}
                </div>
              )}

              <p className="mt-10 border-t border-line pt-3 text-[12.5px] leading-5 text-faint">
                Check names, numbers and owners before you send this on.
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
      {user?.role === "student" && !isSample(session.id) && (
        <StudyShareDialog
          session={session}
          open={studyOpen}
          onClose={() => setStudyOpen(false)}
          initialFormat={studyFormat}
        />
      )}
      <FollowUpDialog
        session={session}
        open={followUpOpen}
        onClose={() => setFollowUpOpen(false)}
        initialChannel={followUpChannel}
      />
      <JiraHandoffDialog
        session={session}
        open={jiraOpen}
        existing={handoffs}
        onClose={() => setJiraOpen(false)}
        onHandedOff={(links) =>
          setHandoffs((current) => {
            const byId = new Map(current.map((link) => [link.actionId, link]));
            links.forEach((link) => byId.set(link.actionId, link));
            return [...byId.values()];
          })
        }
      />
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

      <Modal
        open={translateOpen}
        title="Translate this report"
        description="Read the same report in another Nigerian language. Your saved report stays as it is."
        onClose={() => {
          if (!translating) setTranslateOpen(false);
        }}
      >
        <div className="space-y-2">
          {translation && (
            <button
              type="button"
              className="flex w-full items-start justify-between gap-3 rounded-xl border border-line bg-raised px-3.5 py-3 text-left transition-colors hover:border-line-strong"
              onClick={() => {
                setTranslation(null);
                setTranslateOpen(false);
              }}
            >
              <span>
                <span className="block text-[14.5px] font-semibold text-ink">Original</span>
                <span className="mt-0.5 block text-[12.5px] text-muted">Back to the report as JotBox wrote it</span>
              </span>
              <Languages className="mt-0.5 h-4 w-4 flex-none text-faint" />
            </button>
          )}
          {REPORT_LANGUAGES.map((option) => {
            const active = translation?.language === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={translating}
                onClick={() => void translateReport(option.value)}
                className={clsx(
                  "flex w-full items-start justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                  active ? "border-accent bg-accent-soft" : "border-line bg-raised hover:border-line-strong",
                  translating && "opacity-60",
                )}
              >
                <span>
                  <span className="block text-[14.5px] font-semibold text-ink">{option.label}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-5 text-muted">{option.hint}</span>
                </span>
                {active ? (
                  <Check className="mt-0.5 h-4 w-4 flex-none text-accent" strokeWidth={2.5} />
                ) : (
                  <Languages className="mt-0.5 h-4 w-4 flex-none text-faint" />
                )}
              </button>
            );
          })}
          {translating && (
            <p className="flex items-center gap-2 pt-1 text-[12.5px] text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Translating the report...
            </p>
          )}
        </div>
      </Modal>

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

