import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  ArrowRight,
  BookMarked,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  GraduationCap,
  Layers,
  ListChecks,
  Loader2,
  LogOut,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import { api, ApiError, type StudyGroup, type StudyItem, type StudyItemKind, type StudyOverview, type StudyQuestion, type StudyQuota, type StudyCard } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { isSample } from "@/lib/seed";
import { studyItemToSession } from "@/lib/study";
import { useSessions } from "@/lib/store";
import type { Session } from "@/lib/types";

const ITEM_META: Record<StudyItemKind, { label: string; Icon: typeof BookOpen; tile: string }> = {
  note: { label: "Note", Icon: BookOpen, tile: "bg-accent-soft text-accent" },
  quiz: { label: "Quiz", Icon: ListChecks, tile: "bg-raised-2 text-brass" },
  cards: { label: "Flashcards", Icon: Layers, tile: "bg-raised-2 text-muted" },
};

function quotaText(quota: StudyQuota) {
  if (quota.limit === null) return "Study sets are unlimited on your plan.";
  if (quota.remaining === 0) return "Free study sets are used up this month. Pro makes them unlimited.";
  return `${quota.remaining} of ${quota.limit} free study sets left this month. Sharing a note is always free.`;
}

function itemMeta(kind: StudyItemKind) {
  return ITEM_META[kind] ?? ITEM_META.note;
}

function NoteView({ item }: { item: StudyItem }) {
  if (item.payload.kind !== "note") return null;
  const notes = item.payload.notes;
  return (
    <div>
      <p className="text-[15.5px] leading-6 text-soft">{notes.summary}</p>
      {notes.highlights.length > 0 && (
        <section className="mt-5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-faint">Key points</p>
          <ul className="mt-1.5 space-y-1.5">
            {notes.highlights.map((line, index) => (
              <li key={index} className="flex items-start gap-2 text-[14.5px] leading-6 text-soft">
                <span className="mt-[9px] h-1.5 w-1.5 flex-none rounded-full bg-accent" />
                {line}
              </li>
            ))}
          </ul>
        </section>
      )}
      {notes.sections.map((section, index) => (
        <section key={index} className="mt-5">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{section.heading}</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14.5px] leading-6 text-soft">
            {section.bullets.map((line, lineIndex) => (
              <li key={lineIndex}>{line}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function QuizPlayer({ questions }: { questions: StudyQuestion[] }) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  if (!questions.length) return <p className="text-[15px] text-muted">This quiz has no questions yet.</p>;

  if (done) {
    return (
      <div className="py-6 text-center">
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-faint">Your score</p>
        <p className="mt-2 text-[40px] font-semibold tracking-[-0.04em] text-ink">
          {score}/{questions.length}
        </p>
        <p className="mt-1 text-[15px] text-muted">
          {score === questions.length ? "Everything correct. You know this one." : "Read the explanations, then try again."}
        </p>
        <button
          type="button"
          className="btn btn-line mx-auto mt-5"
          onClick={() => {
            setIndex(0);
            setPicked(null);
            setRevealed(false);
            setScore(0);
            setDone(false);
          }}
        >
          <RotateCcw className="h-4 w-4" />
          Try again
        </button>
      </div>
    );
  }

  const question = questions[index];

  return (
    <div>
      <div className="flex items-center justify-between text-[12.5px] text-faint">
        <span>Question {index + 1} of {questions.length}</span>
        <span>{score} right</span>
      </div>
      <h3 className="mt-2 text-[17px] font-semibold leading-6 tracking-[-0.01em] text-ink">{question.question}</h3>
      <div className="mt-3 space-y-2">
        {question.options.map((option, optionIndex) => {
          const right = revealed && optionIndex === question.answer;
          const wrong = revealed && optionIndex === picked && optionIndex !== question.answer;
          return (
            <button
              key={optionIndex}
              type="button"
              disabled={revealed}
              onClick={() => setPicked(optionIndex)}
              className={clsx(
                "flex w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left text-[14.5px] leading-5 transition-colors",
                right && "border-accent bg-accent-soft text-ink",
                wrong && "border-rec-line bg-rec-soft text-ink",
                !revealed && picked === optionIndex && "border-accent bg-accent-soft text-ink",
                !right && !wrong && picked !== optionIndex && "border-line bg-raised text-soft hover:border-line-strong",
              )}
            >
              <span className="grid h-5 w-5 flex-none place-items-center rounded-full border border-line-strong text-[11px] font-semibold text-muted">
                {right ? <Check className="h-3 w-3" /> : "ABCD"[optionIndex]}
              </span>
              {option}
            </button>
          );
        })}
      </div>
      {revealed && question.explanation && (
        <p className="mt-3 rounded-xl bg-raised-2 px-3.5 py-2.5 text-[13.5px] leading-5 text-muted">{question.explanation}</p>
      )}
      <div className="mt-4 flex justify-end">
        {!revealed ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={picked === null}
            onClick={() => {
              if (picked === null) return;
              if (picked === question.answer) setScore((value) => value + 1);
              setRevealed(true);
            }}
          >
            Check answer
          </button>
        ) : index + 1 < questions.length ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setIndex((value) => value + 1);
              setPicked(null);
              setRevealed(false);
            }}
          >
            Next question
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setDone(true)}>
            See score
          </button>
        )}
      </div>
    </div>
  );
}

function CardsPlayer({ cards }: { cards: StudyCard[] }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (!cards.length) return <p className="text-[15px] text-muted">This deck has no cards yet.</p>;
  const card = cards[index];

  return (
    <div>
      <button
        type="button"
        onClick={() => setFlipped((value) => !value)}
        className="flex min-h-[220px] w-full flex-col items-center justify-center rounded-2xl border border-line bg-raised-2 px-6 py-8 text-center transition-colors hover:border-line-strong"
      >
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-faint">
          {flipped ? "Answer" : "Prompt"}
        </span>
        <span className="mt-3 max-w-[38ch] text-[19px] font-medium leading-7 tracking-[-0.01em] text-ink">
          {flipped ? card.back : card.front}
        </span>
        <span className="mt-4 text-[12.5px] text-faint">Tap the card to flip</span>
      </button>
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          className="btn btn-line btn-sm"
          disabled={index === 0}
          onClick={() => {
            setIndex((value) => Math.max(0, value - 1));
            setFlipped(false);
          }}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <span className="text-[13px] text-muted">{index + 1} / {cards.length}</span>
        <button
          type="button"
          className="btn btn-line btn-sm"
          disabled={index === cards.length - 1}
          onClick={() => {
            setIndex((value) => Math.min(cards.length - 1, value + 1));
            setFlipped(false);
          }}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function GroupEditor({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (group: StudyGroup) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  const create = async () => {
    if (name.trim().length < 2) return;
    setBusy("create");
    try {
      const group = await api.createStudyGroup(name.trim());
      setName("");
      onCreated(group);
      toast.success("Group created. Share the code with your class.");
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Could not create the group.");
    } finally {
      setBusy(null);
    }
  };

  const join = async () => {
    if (code.length !== 6) return;
    setBusy("join");
    try {
      const group = await api.joinStudyGroup(code);
      setCode("");
      onCreated(group);
      toast.success(`Joined ${group.name}`);
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Could not join that group.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      title="Start a study group"
      description="Make a group for your class and share the code, or join one a classmate sent you."
      onClose={onClose}
    >
      <label className="label" htmlFor="study-group-name">Group name</label>
      <input
        id="study-group-name"
        className="field mt-1.5"
        value={name}
        maxLength={80}
        placeholder="e.g. Property law, Thursday"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void create();
        }}
      />
      <button
        type="button"
        className="btn btn-primary mt-3 w-full"
        disabled={busy !== null || name.trim().length < 2}
        onClick={() => void create()}
      >
        {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Create group
      </button>

      <div className="my-5 flex items-center gap-3 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-faint">
        <span className="h-px flex-1 bg-line" />
        or join
        <span className="h-px flex-1 bg-line" />
      </div>

      <label className="label" htmlFor="study-group-code">Six-character code</label>
      <input
        id="study-group-code"
        className="field mt-1.5 text-center text-[20px] font-semibold uppercase tracking-[0.3em]"
        value={code}
        maxLength={6}
        placeholder="ABC123"
        autoComplete="off"
        onChange={(event) => setCode(event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6))}
        onKeyDown={(event) => {
          if (event.key === "Enter") void join();
        }}
      />
      <button
        type="button"
        className="btn btn-line mt-3 w-full"
        disabled={busy !== null || code.length !== 6}
        onClick={() => void join()}
      >
        {busy === "join" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
        Join group
      </button>
    </Modal>
  );
}

function ShareNoteDialog({
  open,
  onClose,
  group,
  sessions,
  onShared,
}: {
  open: boolean;
  onClose: () => void;
  group: StudyGroup | null;
  sessions: Session[];
  onShared: () => void;
}) {
  const [captureId, setCaptureId] = useState("");
  const [format, setFormat] = useState<"note" | "quiz" | "cards">("note");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ready = useMemo(
    () =>
      sessions
        .filter((session) => session.notes && session.status === "ready" && !isSample(session.id))
        .sort((a, b) => b.createdAt - a.createdAt),
    [sessions],
  );

  useEffect(() => {
    if (!open) return;
    setError("");
    setCaptureId((current) => (ready.some((session) => session.id === current) ? current : ready[0]?.id ?? ""));
    setFormat("note");
  }, [open, ready]);

  const share = async () => {
    if (!group || !captureId) return;
    setBusy(true);
    setError("");
    try {
      if (format === "note") {
        await api.shareStudyNote(group.id, captureId);
        toast.success("Note shared with the group");
      } else {
        await api.generateStudySet(group.id, captureId, format);
        toast.success(format === "quiz" ? "Quiz shared with the group" : "Flashcards shared with the group");
      }
      onShared();
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "That could not be shared.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={group ? `Share into ${group.name}` : "Share a note"}
      description="Pick one of your finished notes. A note is shared as it is now, so later edits stay on your copy."
      onClose={onClose}
      wide
    >
      {ready.length === 0 ? (
        <p className="text-[15px] leading-6 text-muted">
          No finished notes yet. Record a lecture, then come back to share it.
        </p>
      ) : (
        <>
          <p className="label">Your notes</p>
          <div className="scroll-quiet mt-1.5 max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {ready.slice(0, 40).map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => setCaptureId(session.id)}
                className={clsx(
                  "flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors",
                  captureId === session.id ? "border-accent bg-accent-soft" : "border-line bg-raised hover:border-line-strong",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-medium text-ink">{session.title}</span>
                  <span className="mt-0.5 block text-[12.5px] text-faint">{formatWhen(session.createdAt)}</span>
                </span>
                {captureId === session.id && <Check className="h-4 w-4 flex-none text-accent" />}
              </button>
            ))}
          </div>

          <p className="label mt-4">What to share</p>
          <div className="seg mt-1.5 w-full">
            {(
              [
                { value: "note", label: "The note" },
                { value: "quiz", label: "A quiz" },
                { value: "cards", label: "Flashcards" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                className="seg-item flex-1 whitespace-nowrap text-[12.5px]"
                data-active={format === option.value}
                onClick={() => setFormat(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12.5px] leading-4 text-muted">
            {format === "note"
              ? "Sharing a note is free."
              : "Free accounts can make three quizzes or card sets a month. Notes are always free."}
          </p>
          {error && <p className="mt-3 text-[13.5px] leading-5 text-rec">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn btn-line" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || !captureId} onClick={() => void share()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy ? "Working…" : format === "note" ? "Share note" : format === "quiz" ? "Make the quiz" : "Make the cards"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default function Study() {
  const navigate = useNavigate();
  const sessions = useSessions((state) => state.sessions);
  const upsert = useSessions((state) => state.upsert);

  const [overview, setOverview] = useState<StudyOverview | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.getStudyGroup>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [startOpen, setStartOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const [openItem, setOpenItem] = useState<StudyItem | null>(null);
  const [itemLoading, setItemLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const reload = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    document.title = "Study groups: JotBox";
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api
      .studyOverview()
      .then((data) => {
        if (!alive) return;
        setOverview(data);
        setSelectedId((current) =>
          current && data.groups.some((group) => group.id === current) ? current : data.groups[0]?.id ?? null,
        );
      })
      .catch((caught) => {
        if (alive) setError(caught instanceof ApiError ? caught.message : "Could not load your study groups.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    api
      .getStudyGroup(selectedId)
      .then((data) => {
        if (alive) setDetail(data);
      })
      .catch((caught) => {
        if (!alive) return;
        toast.error(caught instanceof ApiError ? caught.message : "Could not load that group.");
        setSelectedId(null);
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedId, refreshKey]);

  const groups = overview?.groups ?? [];
  const group = detail?.group ?? groups.find((item) => item.id === selectedId) ?? null;
  const shareable = sessions.some(
    (session) => session.notes && session.status === "ready" && !isSample(session.id),
  );

  const open = async (id: string) => {
    setItemLoading(true);
    try {
      setOpenItem(await api.getStudyItem(id));
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Could not open that item.");
    } finally {
      setItemLoading(false);
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Code copied");
    } catch {
      toast.error("Could not copy the code.");
    }
  };

  const leave = async () => {
    if (!group) return;
    setLeaving(true);
    try {
      await api.leaveStudyGroup(group.id);
      setSelectedId(null);
      setDetail(null);
      toast.success("Left the group");
      reload();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Could not leave the group.");
    } finally {
      setLeaving(false);
    }
  };

  const saveToNotes = () => {
    if (!openItem) return;
    const session = studyItemToSession(openItem);
    upsert(session);
    setOpenItem(null);
    toast.success("Saved to your notes");
    navigate(`/session/${session.id}`);
  };

  const removeItem = async () => {
    if (!openItem) return;
    try {
      await api.deleteStudyItem(openItem.id);
      setDeleteOpen(false);
      setOpenItem(null);
      toast.success("Removed from the group");
      reload();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Could not remove that item.");
    }
  };

  const itemKind = openItem ? itemMeta(openItem.kind) : ITEM_META.note;

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Study groups</p>
          <h1 className="mt-1.5 text-[28px] font-semibold tracking-[-0.035em] text-ink sm:text-[32px]">
            Learn it together.
          </h1>
          <p className="mt-1 max-w-[58ch] text-[15.5px] leading-6 text-muted">
            Swap notes, quizzes, and flashcards with your classmates. Every share is a snapshot, so your own copy stays
            yours.
          </p>
          {overview && (
            <p className="mt-2 flex items-center gap-1.5 text-[13px] leading-5 text-muted">
              <Sparkles className="h-3.5 w-3.5 flex-none text-brass" />
              {quotaText(overview.quota)}
            </p>
          )}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setStartOpen(true)}>
          <Plus className="h-4 w-4" />
          New or join
        </button>
      </div>

      {loading && (
        <div className="mt-6 flex items-center gap-2 text-[14px] text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your groups…
        </div>
      )}

      {error && !loading && (
        <div className="mt-6 rounded-xl border border-rec-line bg-rec-soft p-4">
          <p className="text-[14.5px] leading-5 text-soft">{error}</p>
          <button type="button" className="btn btn-line btn-sm mt-3" onClick={reload}>
            Try again
          </button>
        </div>
      )}

      {!loading && !error && groups.length === 0 && (
        <div className="mt-6">
          <EmptyState
            icon={<GraduationCap className="h-6 w-6" />}
            title="No study group yet"
            body="Make a group for your class and share the code, or join a group a classmate already made. Notes, quizzes, and flashcards all live in one feed."
          >
            <button type="button" className="btn btn-primary" onClick={() => setStartOpen(true)}>
              <Plus className="h-4 w-4" />
              Start a group
            </button>
            <button type="button" className="btn btn-line" onClick={() => setStartOpen(true)}>
              I have a code
            </button>
          </EmptyState>
        </div>
      )}

      {!loading && !error && groups.length > 0 && (
        <div className="mt-5 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)] xl:items-start">
          <aside className="min-w-0">
            <p className="label">Your groups</p>
            <div className="scroll-quiet mt-2 flex gap-2 overflow-x-auto pb-1 xl:block xl:space-y-1.5 xl:overflow-visible xl:pb-0">
              {groups.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelectedId(entry.id)}
                  className={clsx(
                    "flex min-w-[220px] items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors xl:w-full xl:min-w-0",
                    entry.id === selectedId
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-raised hover:border-line-strong",
                  )}
                >
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-raised-2 text-muted">
                    <Users className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14.5px] font-medium text-ink">{entry.name}</span>
                    <span className="mt-0.5 block text-[12px] text-faint">
                      {entry.memberCount} member{entry.memberCount === 1 ? "" : "s"} · {entry.itemCount} shared
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section className="min-w-0">
            {group && (
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-raised p-4">
                <div className="min-w-0">
                  <h2 className="truncate text-[19px] font-semibold tracking-[-0.02em] text-ink">{group.name}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                    <span>{group.memberCount} member{group.memberCount === 1 ? "" : "s"}</span>
                    <span aria-hidden="true">·</span>
                    <span>{group.itemCount} shared</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-line btn-sm font-mono tracking-[0.18em]"
                    onClick={() => void copyCode(group.code)}
                    title="Copy the invite code"
                  >
                    {group.code}
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setShareOpen(true)}
                    disabled={!shareable}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Share a note
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setLeaving(true)}
                    title="Leave group"
                    aria-label="Leave group"
                    disabled={leaving}
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            <div className="mt-3 space-y-2">
              {detailLoading && (
                <div className="flex items-center gap-2 py-6 text-[14px] text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading the group…
                </div>
              )}
              {!detailLoading && detail?.items.length === 0 && (
                <EmptyState
                  icon={<BookOpen className="h-6 w-6" />}
                  title="Nothing shared yet"
                  body="Be the first. Share one of your finished notes, or let JotBox turn it into a quiz or a deck of flashcards."
                  className="mt-1"
                >
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setShareOpen(true)}
                    disabled={!shareable}
                  >
                    <Sparkles className="h-4 w-4" />
                    Share a note
                  </button>
                </EmptyState>
              )}
              {detail?.items.map((entry) => {
                const meta = itemMeta(entry.kind);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => void open(entry.id)}
                    className="card flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:border-line-strong"
                  >
                    <span className={clsx("grid h-10 w-10 flex-none place-items-center rounded-xl", meta.tile)}>
                      <meta.Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">{entry.title}</span>
                        <span className="chip flex-none text-[11px]">{meta.label}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-faint">
                        {entry.authorName || "A classmate"} · {formatWhen(entry.createdAt)}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 flex-none text-faint" />
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      <GroupEditor
        open={startOpen}
        onClose={() => setStartOpen(false)}
        onCreated={(created) => {
          setStartOpen(false);
          setSelectedId(created.id);
          reload();
        }}
      />

      <ShareNoteDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        group={group}
        sessions={sessions}
        onShared={reload}
      />

      <Modal
        open={Boolean(openItem) || itemLoading}
        title={openItem?.title ?? "Opening…"}
        description={
          openItem
            ? `${itemKind.label} · shared by ${openItem.authorName || "a classmate"} · ${formatWhen(openItem.createdAt)}`
            : undefined
        }
        onClose={() => {
          setOpenItem(null);
          setDeleteOpen(false);
        }}
        wide
      >
        {itemLoading && !openItem && (
          <div className="flex items-center gap-2 py-8 text-[14px] text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Opening the item…
          </div>
        )}
        {openItem && (
          <div>
            {openItem.payload.kind === "note" && <NoteView item={openItem} />}
            {openItem.payload.kind === "quiz" && <QuizPlayer key={openItem.id} questions={openItem.payload.questions} />}
            {openItem.payload.kind === "cards" && <CardsPlayer key={openItem.id} cards={openItem.payload.cards} />}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
              <button type="button" className="btn btn-line" onClick={saveToNotes}>
                <BookMarked className="h-4 w-4" />
                Save to my notes
              </button>
              {openItem.canDelete && (
                <button type="button" className="btn btn-line btn-sm text-rec" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title="Remove this item?"
        description="It disappears from the group for everyone. Notes a classmate already saved stay in their library."
        confirmLabel="Remove"
        onConfirm={() => void removeItem()}
        onCancel={() => setDeleteOpen(false)}
      />

      <ConfirmDialog
        open={leaving}
        title="Leave this group?"
        description="You will stop seeing the notes, quizzes, and cards shared here. The group and its items stay for everyone else."
        confirmLabel="Leave"
        onConfirm={() => void leave()}
        onCancel={() => setLeaving(false)}
      />
    </div>
  );
}
