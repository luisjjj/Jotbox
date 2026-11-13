import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import clsx from "clsx";
import {
  AlertCircle,
  ArrowRight,
  AudioLines,
  Check,
  FileAudio,
  Loader2,
  Megaphone,
  Mic,
  MonitorUp,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  SlidersHorizontal,
  Square,
  Upload,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { APP_CONFIG } from "@jotbox/config";
import { useEngine } from "@/engine/SessionEngine";
import { useStudio } from "@/hooks/useStudio";
import { defaultTitle, formatClock, KIND_META } from "@/lib/format";
import {
  FOCUS_OPTIONS,
  PICKUP_OPTIONS,
  getFocusMode,
  getPickupMode,
  setFocusMode,
  setPickupMode,
  type FocusMode,
  type PickupMode,
} from "@/lib/listening";
import type { Participant, SessionKind } from "@/lib/types";
import { KindBadge, KindIcon } from "@/components/KindBadge";
import { TranscriptView } from "@/components/TranscriptView";
import { Waveform } from "@/components/Waveform";
import { LiveBoard } from "@/components/LiveBoard";
import { NoticeDialog } from "@/components/NoticeDialog";

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
            style={{ animationDelay: `${KINDS.indexOf(item) * 60}ms` }}
            className={clsx(
              "stagger-in flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all",
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
              <span className="flex items-center gap-1 text-[14.5px] font-semibold tracking-[-0.01em] text-ink">
                {KIND_META[item].label}
                {active && <Check className="h-3 w-3 text-accent" />}
              </span>
              <span className="mt-0.5 hidden text-[12.5px] leading-4 text-muted sm:block">
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
        <span className="chip text-[12px]">{note}</span>
      </div>
      <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.02em] text-ink">{title}</h3>
      <p className="mt-1.5 flex-1 text-[14.5px] leading-5 text-muted">{body}</p>
      <button type="button" className="btn btn-line mt-4 w-full justify-between" onClick={onClick} disabled={busy || disabled}>
        <span>{busy ? "Opening…" : action}</span>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
      </button>
    </div>
  );
}


function Roster({
  people,
  onChange,
  compact = false,
}: {
  people: Participant[];
  onChange: (people: Participant[]) => void;
  compact?: boolean;
}) {
  const [name, setName] = useState("");

  const add = (event: FormEvent) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    if (people.some((person) => person.name.toLowerCase() === clean.toLowerCase())) {
      toast.error("That person is already on the list.");
      return;
    }
    onChange([...people, { id: crypto.randomUUID(), name: clean }]);
    setName("");
  };

  return (
    <div>
      {!compact && <p className="label">Who is in the room? <span className="font-normal text-faint">(optional)</span></p>}
      {people.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-1 rounded-full border border-line bg-raised py-0.5 pl-2.5 pr-1">
              <UserRound className="h-3 w-3 text-faint" />
              <span className="text-[12.5px] text-soft">{person.name}</span>
              <button
                type="button"
                onClick={() =>
                  onChange(people.map((item) => (item.id === person.id ? { ...item, external: !item.external } : item)))
                }
                className={clsx(
                  "rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]",
                  person.external ? "bg-highlight text-brass" : "text-faint hover:text-ink",
                )}
                title="Mark this person as a guest"
              >
                {person.external ? "Guest" : "Room"}
              </button>
              <button
                type="button"
                className="icon-btn h-5 w-5"
                onClick={() => onChange(people.filter((item) => item.id !== person.id))}
                aria-label={`Remove ${person.name}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex items-center gap-1.5" onSubmit={add}>
        <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-raised text-muted">
          <Users className="h-4 w-4" />
        </span>
        <input
          className="field h-9 min-w-0 flex-1"
          placeholder={compact ? "Add a person" : "Add names, so JotBox spells them right"}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          aria-label="Add a person"
        />
        <button
          type="submit"
          className="icon-btn h-9 w-9 flex-none border border-line"
          disabled={!name.trim()}
          aria-label="Add person"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}

function Setup() {
  const { kind, setKind, start, error, clearError, importFile, status } = useEngine();
  const studio = useStudio();
  const [title, setTitle] = useState("");
  const [people, setPeople] = useState<Participant[]>([]);
  const [focus, setFocus] = useState<FocusMode>(() => getFocusMode());
  const [pickup, setPickup] = useState<PickupMode>(() => getPickupMode());
  const [noticeOpen, setNoticeOpen] = useState(false);
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
      await start({ kind, source, title: title.trim() || undefined, participants: people });
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
      await importFile(file, kind, people);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="w-full">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] xl:items-start xl:gap-10">
        <div className="xl:sticky xl:top-9">
          <p className="kicker">New capture</p>
          <h1 className="mt-1.5 text-[28px] font-semibold tracking-[-0.04em] text-ink sm:text-[34px]">
            What are you listening to?
          </h1>
          <p className="mt-1.5 max-w-[46ch] text-[15.5px] leading-6 text-muted">
            Pick the shape of the session. JotBox listens, keeps the spoken words, and writes the notes in that shape.
          </p>
        </div>

        <div className="min-w-0">
          {error && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rec-line bg-rec-soft p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-rec" />
              <p className="flex-1 text-[14.5px] leading-5 text-soft">{error}</p>
              <button type="button" className="icon-btn h-6 w-6" onClick={clearError} aria-label="Dismiss">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="space-y-5">
        <div>
          <p className="label">Session type</p>
          <KindSelector kind={kind} onChange={setKind} />
        </div>

        <div>
          <label className="label" htmlFor="capture-title">
            Name it <span className="font-normal text-faint">(optional)</span>
          </label>
          <input
            id="capture-title"
            className="field"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={`e.g. ${kind === "lecture" ? "Constitutional law, Thursday" : kind === "seminar" ? "Climate policy panel" : kind === "voice" ? "Idea for the onboarding flow" : "Weekly product sync"}`}
            autoComplete="off"
            maxLength={120}
          />
        </div>

        <Roster people={people} onChange={setPeople} />

        <div className="rounded-xl border border-line bg-raised p-3.5">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-accent" />
            <p className="text-[14.5px] font-medium text-ink">Listening</p>
          </div>
          <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
            <div>
              <p className="label">Session focus</p>
              <div className="seg mt-1.5 w-full">
                {FOCUS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="seg-item flex-1 whitespace-nowrap text-[12.5px]"
                    data-active={focus === option.value}
                    onClick={() => {
                      setFocus(option.value);
                      setFocusMode(option.value);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[12.5px] leading-4 text-muted">
                {FOCUS_OPTIONS.find((option) => option.value === focus)?.hint}
              </p>
            </div>
            <div>
              <p className="label">Pickup</p>
              <div className="seg mt-1.5 w-full">
                {PICKUP_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="seg-item flex-1 whitespace-nowrap text-[12.5px]"
                    data-active={pickup === option.value}
                    onClick={() => {
                      setPickup(option.value);
                      setPickupMode(option.value);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[12.5px] leading-4 text-muted">
                {PICKUP_OPTIONS.find((option) => option.value === pickup)?.hint}
              </p>
            </div>
          </div>
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
              action={canShare ? "Share a tab" : "Use a computer"}
              note="Call audio"
              onClick={() => void launch("tab")}
              busy={busy === "tab"}
              disabled={!canShare || Boolean(busy) || uploading}
            />
          </div>
          {!canShare && (
            <p className="mt-2 text-[13px] leading-5 text-faint">
              Sharing a call tab needs a computer. On a phone, use the microphone.
            </p>
          )}
          {studio === false && (
            <p className="mt-2 text-[13px] leading-5 text-faint">
              Automatic words are not turned on for this workspace, so call and uploaded audio is saved but not written
              out. The microphone still shows live words, and you can paste the words after the session.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-raised px-3.5 py-2.5">
          <p className="flex items-center gap-2 text-[13px] leading-5 text-muted">
            <Megaphone className="h-3.5 w-3.5 flex-none text-brass" />
            Recording other people? Read them a short notice first.
          </p>
          <button type="button" className="btn btn-line btn-sm" onClick={() => setNoticeOpen(true)}>
            Open notice
          </button>
        </div>

        <div className="card-quiet flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-raised text-muted">
              <FileAudio className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[15px] font-medium text-ink">Already have a recording?</p>
              <p className="mt-0.5 text-[13.5px] leading-5 text-muted">
                {APP_CONFIG.supportedAudioExtensions.join(" ").toUpperCase()} · up to 80 MB.{" "}
                {studio === false ? "Automatic words are off. You can paste them afterwards." : ""}
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
          <p className="text-[13.5px] leading-5 text-muted">
            Need to keep working? Start here, then{" "}
            <Link to="/float" className="font-medium text-ink underline decoration-line-strong underline-offset-2">
              pin the pill
            </Link>{" "}
            above your other apps. Audio is stored on this device. When JotBox writes the words for you, the recording
            is sent only for that session.
          </p>
        </div>
          </div>
        </div>
      </div>

      <NoticeDialog
        open={noticeOpen}
        onClose={() => setNoticeOpen(false)}
        input={{
          title: title.trim() || defaultTitle(kind),
          kind,
          createdAt: Date.now(),
          participants: people,
        }}
      />
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
    live,
    participants,
    interim,
    elapsed,
    captions,
    setScratch,
    setParticipants,
    setTitle,
    pause,
    resume,
    stop,
    pin,
    error,
    clearError,
  } = useEngine();
  const studio = useStudio();
  const [pane, setPane] = useState<"notes" | "transcript">("notes");
  const paused = status === "paused";
  const words = useMemo(() => (scratch.trim() ? scratch.trim().split(/\s+/).length : 0), [scratch]);
  const [canPin] = useState(
    () => typeof window !== "undefined" && "documentPictureInPicture" in window,
  );
  const [busy, setBusy] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);

  const sourceLabel = source === "tab" ? "Tab + mic" : source === "upload" ? "Upload" : "Microphone";

  const keepInsight = (text: string, owner?: string) => {
    const line = owner && owner !== "Unassigned" ? `- ${owner}: ${text}` : `- ${text}`;
    const next = scratch.trim() ? `${scratch.trimEnd()}
${line}` : line;
    setScratch(next);
    toast.success("Added to your jottings", { id: "keep-insight" });
  };

  const handleStop = () => {
    toast.success("Writing your notes…", { id: "writing-notes" });
    void stop();
  };

  const handlePin = async () => {
    setBusy(true);
    try {
      await pin();
    } catch {
      toast.error("The floating pill was blocked. Allow pop-ups for JotBox and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rec-soft px-2.5 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-rec">
              <span className="live-dot" />
              {paused ? "Paused" : "Listening"}
            </span>
            <span className="text-[26px] font-semibold tabular-nums tracking-[-0.03em] text-ink sm:text-[30px]">
              {formatClock(elapsed)}
            </span>
            <span className="hidden items-center gap-1 text-[13px] text-faint sm:flex">
              <AudioLines className="h-3.5 w-3.5" />
              {sourceLabel}
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <KindBadge kind={kind} />
            <input
              className="w-full min-w-0 bg-transparent text-[20px] font-semibold tracking-[-0.03em] text-ink outline-none placeholder:text-faint sm:text-[24px]"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Name this session"
              aria-label="Session title"
            />
          </div>
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Waveform active={!paused} bars={26} className="mr-auto hidden h-9 w-24 lg:flex" />
          <button
            type="button"
            className="btn btn-line flex-none px-3"
            onClick={() => setNoticeOpen(true)}
            title="Show the room a recording notice"
            aria-label="Listening notice"
          >
            <Megaphone className="h-4 w-4" />
            <span className="hidden sm:inline">Notice</span>
          </button>
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
              title="Floating needs a computer browser"
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
          <p className="flex-1 text-[14.5px] leading-5 text-soft">{error}</p>
          <button type="button" className="icon-btn h-6 w-6" onClick={clearError} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <LiveBoard insights={live} onKeep={keepInsight} />

      <div className="card-quiet mt-3 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-muted" />
            <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted">People</h2>
          </div>
          <span className="text-[12px] text-faint">{participants.length || "No names yet"}</span>
        </div>
        <div className="mt-2">
          <Roster people={participants} onChange={setParticipants} compact />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 lg:hidden">
        <div className="seg w-full">
          <button
            type="button"
            className="seg-item flex-1"
            data-active={pane === "notes"}
            onClick={() => setPane("notes")}
          >
            Your notes
            <span className="text-[12px] text-faint">{words}</span>
          </button>
          <button
            type="button"
            className="seg-item flex-1"
            data-active={pane === "transcript"}
            onClick={() => setPane("transcript")}
          >
            Spoken words
            <span className="text-[12px] text-faint">{lines.length}</span>
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
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted">Your notes</h2>
              </div>
              <span className="text-[12.5px] tabular-nums text-faint">{words} words · saved</span>
            </div>
            <textarea
              className="min-h-[42vh] w-full flex-1 resize-none border-0 bg-transparent p-4 text-[17.5px] leading-7 text-ink outline-none placeholder:text-faint sm:p-5 lg:min-h-0"
              placeholder={
                "Write what you want to keep.\n\n• Decisions\n• Names, numbers, dates\n• What you owe someone"
              }
              value={scratch}
              onChange={(event) => setScratch(event.target.value)}
              spellCheck
            />
            <p className="border-t border-line px-4 py-2.5 text-[12.5px] leading-4 text-faint sm:px-5">
              Short lines work best. These become the spine of the written notes.
            </p>
          </section>

          <section
            className={clsx(
              "min-h-[54vh] flex-col lg:flex lg:min-h-[calc(100dvh-19rem)]",
              pane === "transcript" ? "flex" : "hidden",
            )}
            aria-label="Live words"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2">
                <AudioLines className="h-3.5 w-3.5 text-muted" />
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Spoken words
                </h2>
              </div>
              <span className="flex items-center gap-1.5 text-[12.5px] text-faint">
                {captions ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-[#3e7a5b]" />
                    Live words on
                  </>
                ) : (
                  "Live words unavailable"
                )}
              </span>
            </div>
            {!captions && (
              <div className="flex items-start gap-2 border-b border-line bg-raised-2 px-4 py-2.5 text-[13px] leading-5 text-muted sm:px-5">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-brass" />
                {studio === false
                  ? "This browser can't show live words. Audio is still recording, and you can paste the words after the session."
                  : "This browser can't show live words. Audio is still recording, and JotBox will write the words when you stop."}
              </div>
            )}
            <TranscriptView
              lines={lines}
              interim={interim}
              live
              className="flex-1 px-4 py-2 sm:px-5"
              emptyLabel="Speak, or play the meeting. Words will appear here as you listen."
            />
            <p className="border-t border-line px-4 py-2.5 text-[12.5px] leading-4 text-faint sm:px-5">
              Live words are a first pass. They are tidied up when the session ends.
            </p>
          </section>
        </div>
      </div>

      <p className="mt-3 text-center text-[12.5px] text-faint">
        Keep this tab open for live words. You can switch apps. The audio keeps recording.
      </p>

      <NoticeDialog
        open={noticeOpen}
        onClose={() => setNoticeOpen(false)}
        input={{
          title: title || defaultTitle(kind),
          kind,
          createdAt: Date.now(),
          participants,
        }}
      />
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
      <h1 className="mt-5 text-[24px] font-semibold tracking-[-0.03em] text-ink">Writing the notes</h1>
      <p className="mt-2 max-w-[34ch] text-[15px] leading-6 text-muted">
        Reading the recording, tidying the spoken words, and writing the summary and actions. This page will move on its
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

