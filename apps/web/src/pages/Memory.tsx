import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  Clock,
  Eye,
  History,
  Loader2,
  Lock,
  Mic,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { useAuth } from "@/auth/AuthProvider";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { PaywallPanel } from "@/components/Paywall";
import { Select } from "@/components/Select";
import {
  ApiError,
  api,
  type CaptureSensitivity,
  type CaptureVisibility,
  type MemoryAnswer,
  type MemoryChatTurn,
  type MemorySource,
  type OrgAuditEvent,
  type OrgDetail,
  type OrgMember,
  type OrgRole,
  type Organisation,
  type SharedCaptureView,
} from "@/lib/api";
import { formatClock } from "@/lib/format";
import { useSessions } from "@/lib/store";
import { usePro } from "@/lib/usageStore";

type Tab = "ask" | "workspace" | "audit";

const ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  member: "Member",
};

const VISIBILITY_LABEL: Record<CaptureVisibility, string> = {
  private: "Only me",
  department: "My department",
  organisation: "Everyone in the organisation",
};

const SENSITIVITY_LABEL: Record<CaptureSensitivity, string> = {
  standard: "Standard",
  confidential: "Confidential",
};

const AUDIT_LABEL: Record<string, string> = {
  "org.create": "Created the organisation",
  "org.update": "Updated organisation settings",
  "department.create": "Added a department",
  "member.add": "Added a member",
  "member.update": "Changed member access",
  "member.remove": "Removed a member",
  "capture.share": "Shared a meeting",
  "capture.unshare": "Stopped sharing a meeting",
  "memory.query": "Asked the memory",
  "memory.query_failed": "A memory question failed",
  "memory.source_view": "Opened a source meeting",
};

const SUGGESTIONS = [
  "What was our original expansion plan, what changed, and why?",
  "What did we decide about pricing, and who owns the follow-up?",
  "Which commitments from last month are still open?",
];

function isAdminRole(role: OrgRole | undefined) {
  return role === "owner" || role === "admin";
}

function messageFor(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong. Try again.";
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : format(date, "d MMM yyyy");
}

function auditDetail(event: { action: string; metadata: Record<string, unknown> }) {
  const meta = event.metadata;
  const pick = (name: string) => (typeof meta[name] === "string" ? (meta[name] as string) : "");
  if (event.action === "member.add" || event.action === "member.remove") return pick("email");
  if (event.action === "member.update") return `${ROLE_LABEL[pick("role") as OrgRole] ?? pick("role")}`;
  if (event.action === "department.create") return pick("name");
  if (event.action === "memory.query" || event.action === "memory.query_failed") return pick("question");
  if (event.action === "capture.share" || event.action === "capture.unshare") return pick("title");
  if (event.action === "memory.source_view") return pick("title");
  if (event.action === "org.update") {
    const days = typeof meta.retentionDays === "number" ? `${meta.retentionDays} days` : "";
    return [pick("name"), days].filter(Boolean).join(" · ");
  }
  return "";
}

function Section({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
          <p className="mt-1 max-w-[52ch] text-[14px] leading-5 text-muted">{description}</p>
        </div>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Chip({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" | "warn" }) {
  return (
    <span
      className={clsx(
        "chip",
        tone === "accent" && "border-transparent bg-accent-soft text-accent",
        tone === "warn" && "border-transparent bg-highlight text-brass",
      )}
    >
      {children}
    </span>
  );
}

function SourceButton({ source, onOpen }: { source: MemorySource; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-raised-2 px-2 py-0.5 text-[12.5px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
      onClick={() => onOpen(source.id)}
      title={`Open ${source.title}`}
    >
      <BookOpen className="h-3 w-3 flex-none" />
      <span className="truncate">{source.title}</span>
    </button>
  );
}

function SourceDialog({ orgId, sourceId, onClose }: { orgId: string; sourceId: string; onClose: () => void }) {
  const [view, setView] = useState<SharedCaptureView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void api
      .getSharedCapture(orgId, sourceId)
      .then((result) => {
        if (alive) setView(result.capture);
      })
      .catch((err) => {
        if (alive) setError(messageFor(err));
      });
    return () => {
      alive = false;
    };
  }, [orgId, sourceId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={view?.title ?? "Source meeting"}
        className="fade-up flex max-h-[86dvh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-float"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="kicker">Source meeting</p>
            <h2 className="mt-1 truncate text-[18px] font-semibold tracking-[-0.02em] text-ink">
              {view?.title ?? "Loading…"}
            </h2>
            {view && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Chip>{format(view.createdAt, "d MMM yyyy")}</Chip>
                <Chip>{formatClock(view.durationSec)}</Chip>
                <Chip>{view.ownerName ? `From ${view.ownerName}` : "Recorded meeting"}</Chip>
                {view.departmentName && <Chip>{view.departmentName}</Chip>}
                {view.sensitivity === "confidential" && (
                  <Chip tone="warn">
                    <Lock className="h-3 w-3" />
                    Confidential
                  </Chip>
                )}
              </div>
            )}
          </div>
          <button type="button" className="btn btn-line btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-rec-line bg-rec-soft px-3 py-2.5">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-rec" />
              <p className="text-[14px] leading-5 text-soft">{error}</p>
            </div>
          ) : !view ? (
            <div className="flex items-center gap-2 py-8 text-[14.5px] text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Opening the meeting…
            </div>
          ) : (
            <div className="space-y-5">
              {view.notes ? (
                <>
                  <div>
                    <h3 className="kicker">Summary</h3>
                    <p className="mt-1.5 text-[15.5px] leading-6 text-soft">{view.notes.summary}</p>
                  </div>
                  {view.notes.highlights.length > 0 && (
                    <div>
                      <h3 className="kicker">Highlights</h3>
                      <ul className="mt-1.5 space-y-1.5">
                        {view.notes.highlights.map((item, index) => (
                          <li key={index} className="flex gap-2 text-[15px] leading-5 text-soft">
                            <span className="bullet-dot" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {view.notes.actions.length > 0 && (
                    <div>
                      <h3 className="kicker">Actions</h3>
                      <ul className="mt-1.5 space-y-1.5">
                        {view.notes.actions.map((item) => (
                          <li key={item.id} className="flex gap-2 text-[15px] leading-5 text-soft">
                            <span className="bullet-dot" />
                            <span>
                              <span className="font-medium text-ink">{item.owner || "Unassigned"}:</span> {item.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {view.notes.sections.map((section, index) => (
                    <div key={index}>
                      <h3 className="kicker">{section.heading}</h3>
                      <ul className="mt-1.5 space-y-1.5">
                        {section.bullets.map((item, bulletIndex) => (
                          <li key={bulletIndex} className="flex gap-2 text-[15px] leading-5 text-soft">
                            <span className="bullet-dot" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </>
              ) : (
                <p className="text-[14.5px] text-muted">This meeting has no written notes yet.</p>
              )}

              {view.transcript.length > 0 && (
                <div>
                  <h3 className="kicker">Spoken words</h3>
                  <div className="mt-1.5 max-h-64 overflow-y-auto rounded-xl border border-line bg-raised-2 p-3 scroll-quiet">
                    {view.transcript.map((line) => (
                      <p key={line.id} className="py-1 text-[14.5px] leading-5 text-soft">
                        <span className="mr-2 text-[12.5px] tabular-nums text-faint">{formatClock(line.at)}</span>
                        {line.speaker && <span className="mr-1 font-medium text-brass">{line.speaker}:</span>}
                        {line.text}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

type ChatEntry = {
  id: string;
  question: string;
  answer: MemoryAnswer | null;
  error: string;
};

function AskPanel({
  org,
  onSource,
}: {
  org: OrgDetail;
  onSource: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<ChatEntry[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const pro = usePro();
  const [voice, setVoice] = useState<"idle" | "listening" | "writing">("idle");
  const [canRecord] = useState(
    () =>
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined",
  );
  const endRef = useRef<HTMLDivElement | null>(null);
  const nextId = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const voiceRun = useRef(0);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const transcribeVoice = async (blob: Blob, run: number) => {
    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm" },
        body: blob,
      });
      if (!response.ok) throw new Error("transcribe");
      const data = (await response.json()) as { text?: string };
      if (run !== voiceRun.current) return;
      const text = (data.text || "").trim();
      if (!text) {
        setError("No words were picked up. Try again, or type the question.");
        return;
      }
      setDraft((current) => [current.trim(), text].filter(Boolean).join(" "));
      requestAnimationFrame(() => document.getElementById("memory-question")?.focus());
    } catch {
      if (run !== voiceRun.current) return;
      setError("That recording could not be read. Try again, or type the question.");
    } finally {
      if (run === voiceRun.current) setVoice("idle");
    }
  };

  const startVoice = async () => {
    if (asking || voice !== "idle") return;
    setError("");
    cancelledRef.current = false;
    const run = ++voiceRun.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (run !== voiceRun.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mime =
        ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type)) ??
        "";
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = null;
        const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
        chunksRef.current = [];
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        if (!blob.size) {
          setVoice("idle");
          setError("No words were picked up. Try again, or type the question.");
          return;
        }
        setVoice("writing");
        void transcribeVoice(blob, run);
      };
      recorder.start();
      setVoice("listening");
      timerRef.current = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 60_000);
    } catch {
      if (run === voiceRun.current) setVoice("idle");
      setError("Allow the microphone from the address bar, then try again, or type the question.");
    }
  };

  const stopVoice = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
  };

  useEffect(() => {
    if (!turns.length && !asking) return;
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [turns, asking]);

  const ask = async (text: string) => {
    const clean = text.trim();
    if (clean.length < 4) {
      setError("Write a full question so the answer can be specific.");
      return;
    }
    if (asking) return;

    const history = turns
      .flatMap<MemoryChatTurn>((turn) => {
        const items: MemoryChatTurn[] = [{ role: "user", content: turn.question }];
        if (turn.answer) items.push({ role: "assistant", content: turn.answer.answer });
        return items;
      })
      .slice(-8);

    nextId.current += 1;
    const id = `turn-${nextId.current}`;
    setTurns((current) => [...current, { id, question: clean, answer: null, error: "" }]);
    setDraft("");
    setError("");
    setAsking(true);
    try {
      const result = await api.queryMemory(org.org.id, clean, history);
      setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, answer: result } : turn)));
    } catch (err) {
      setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, error: messageFor(err) } : turn)));
    } finally {
      setAsking(false);
    }
  };

  const reset = () => {
    voiceRun.current += 1;
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
    setVoice("idle");
    setTurns([]);
    setDraft("");
    setError("");
  };

  const lastTurnId = turns[turns.length - 1]?.id;

  if (!pro) {
    return (
      <PaywallPanel
        className="min-h-[26rem]"
        title="Ask across organisation memory is part of Pro"
        description="Search months of meetings, trace what changed, and see where every answer came from. The workspace, sessions and audit trail stay free."
      />
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="card flex h-[calc(100dvh-13rem)] min-h-[30rem] max-h-[46rem] flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-2 border-b border-line bg-raised-2 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-accent-soft text-accent">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-ink">Memory chat</h2>
              <p className="truncate text-[12.5px] text-faint">Ask across months of meetings you can open.</p>
            </div>
          </div>
          {turns.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm flex-none" onClick={reset}>
              <Plus className="h-3.5 w-3.5" />
              New chat
            </button>
          )}
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5" aria-live="polite">
          {turns.length === 0 ? (
            <div className="flex h-full min-h-[22rem] flex-col items-center justify-center px-2 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-full border border-line bg-raised-2 text-accent">
                <BookOpen className="h-5 w-5" />
              </span>
              <p className="mt-3 text-[16px] font-semibold tracking-[-0.02em] text-ink">Ask the record a question</p>
              <p className="mt-1 max-w-[34ch] text-[14px] leading-5 text-muted">
                What was planned, what changed, and why. Every answer points back to the meeting it came from, and
                says when no reason was recorded.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="rounded-full border border-line bg-raised-2 px-3 py-1.5 text-left text-[13.5px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
                    disabled={asking}
                    onClick={() => void ask(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((turn) => (
              <div key={turn.id} className="space-y-3">
                <div className="flex justify-end">
                  <p className="max-w-[88%] rounded-2xl rounded-br-sm bg-accent-soft px-3.5 py-2.5 text-[14.5px] leading-5 text-ink">
                    {turn.question}
                  </p>
                </div>
                {turn.answer ? (
                  <AnswerCard answer={turn.answer} onSource={onSource} defaultOpen={turn.id === lastTurnId} />
                ) : turn.error ? (
                  <div className="flex max-w-[92%] items-start gap-2 rounded-2xl rounded-bl-sm border border-rec-line bg-rec-soft px-3.5 py-2.5">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-rec" />
                    <p className="text-[14px] leading-5 text-soft">{turn.error}</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 pl-1 text-[13.5px] text-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                    Reading the record…
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        <form
          className="border-t border-line p-3 sm:p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(draft);
          }}
        >
          {error && (
            <div className="mb-2 flex items-start gap-2 rounded-lg border border-rec-line bg-rec-soft px-3 py-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-rec" />
              <p className="text-[13.5px] leading-4 text-soft">{error}</p>
            </div>
          )}
          <div className="flex items-end gap-2">
            <label className="sr-only" htmlFor="memory-question">
              Ask a question about the meetings
            </label>
            <textarea
              id="memory-question"
              rows={1}
              className="field min-h-[2.75rem] max-h-32 flex-1 resize-none py-2.5"
              placeholder={turns.length ? "Ask a follow-up, or open another thread…" : "What was the original plan, what changed, and why?"}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask(draft);
                }
              }}
            />
            {canRecord && (
              <button
                type="button"
                className={clsx(
                  "btn btn-line h-11 w-11 flex-none !px-0",
                  voice === "listening" && "border-rec-line bg-rec-soft text-rec",
                )}
                onClick={voice === "listening" ? stopVoice : () => void startVoice()}
                disabled={asking || voice === "writing"}
                aria-label={voice === "listening" ? "Stop and use the words" : "Ask by voice"}
                aria-pressed={voice === "listening"}
                title={voice === "listening" ? "Stop and use the words" : "Ask by voice"}
              >
                {voice === "writing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : voice === "listening" ? (
                  <Square className="h-3.5 w-3.5 fill-current" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </button>
            )}
            <button
              type="submit"
              className="btn btn-primary h-11 w-11 flex-none !px-0"
              disabled={asking || voice !== "idle" || !draft.trim()}
              aria-label="Send question"
            >
              {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-2 text-[12px] leading-4 text-faint">
            {voice === "listening" ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="live-dot !h-1.5 !w-1.5" />
                Listening. Press the mic again to use the words. The audio is not kept.
              </span>
            ) : (
              <>Uses only meetings you can open · kept for {org.org.retentionDays} days · recorded facts are cited</>
            )}
          </p>
        </form>
      </section>

      <aside className="card h-fit p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-accent" />
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-ink">Private by design</h2>
        </div>
        <p className="mt-2 text-[13.5px] leading-5 text-muted">
          JotBox filters every meeting through your access before the answer is written. Private, confidential, and
          other departments' meetings never reach the model.
        </p>
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <div className="flex items-center justify-between text-[13.5px]">
            <span className="text-muted">Your role</span>
            <Chip tone="accent">{ROLE_LABEL[org.org.role]}</Chip>
          </div>
          <div className="flex items-center justify-between text-[13.5px]">
            <span className="text-muted">Kept for</span>
            <span className="font-medium text-ink">{org.org.retentionDays} days</span>
          </div>
          <div className="flex items-center justify-between text-[13.5px]">
            <span className="text-muted">Meetings you shared</span>
            <span className="font-medium text-ink">{org.shares.length}</span>
          </div>
        </div>
        <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-4 text-faint">
          <Lock className="mt-px h-3 w-3 flex-none" />
          Recorded facts are cited. Anything JotBox works out is marked as an inference.
        </p>
      </aside>
    </div>
  );
}

function AnswerCard({
  answer,
  onSource,
  defaultOpen,
}: {
  answer: MemoryAnswer;
  onSource: (id: string) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const sourceMap = useMemo(() => new Map(answer.sources.map((item) => [item.id, item])), [answer]);

  return (
    <article className="max-w-[95%] overflow-hidden rounded-2xl rounded-bl-sm border border-line bg-raised">
      <div className="px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-accent">JotBox</span>
          <Chip>
            <Eye className="h-3 w-3" />
            {answer.scope.considered} you can open
          </Chip>
          <Chip>
            <BookOpen className="h-3 w-3" />
            {answer.scope.used} used
          </Chip>
          {answer.scope.provider === "demo" && <Chip tone="warn">Demo answer</Chip>}
        </div>

        <p className="mt-2 text-[15px] leading-6 text-soft">{answer.answer}</p>

        {answer.reasonMissing && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-highlight px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-brass" />
            <div>
              <p className="text-[13.5px] font-semibold text-ink">No recorded reason</p>
              <p className="mt-0.5 text-[13px] leading-5 text-soft">
                {answer.reasonNote ||
                  "The meetings show what changed, but nobody put the reason in the record. JotBox will not invent one."}
              </p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-medium text-accent transition-colors hover:text-ink"
        >
          {open ? "Hide the record" : "See the record behind this answer"}
          <ChevronDown className={clsx("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div className="border-t border-line bg-raised-2/60 px-3.5 py-3.5">
          {answer.timeline.length > 0 && (
            <div>
              <h3 className="kicker">How it unfolded</h3>
              <ol className="mt-2.5 space-y-3.5 border-l border-line pl-3.5">
                {answer.timeline.map((item, index) => (
                  <li key={index} className="relative">
                    <span className="absolute -left-[1.07rem] top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
                    <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint">
                      {formatDateLabel(item.date)}
                    </p>
                    <p className="mt-0.5 text-[14px] font-semibold text-ink">{item.title}</p>
                    <p className="mt-0.5 text-[13.5px] leading-5 text-soft">{item.text}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.sourceIds.map((id) => {
                        const source = sourceMap.get(id);
                        return source ? <SourceButton key={id} source={source} onOpen={onSource} /> : null;
                      })}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div>
              <h3 className="kicker">Recorded</h3>
              {answer.recorded.length === 0 ? (
                <p className="mt-1.5 text-[13.5px] text-muted">Nothing in the record answers that directly.</p>
              ) : (
                <ul className="mt-1.5 space-y-2">
                  {answer.recorded.map((item, index) => (
                    <li key={index} className="rounded-lg border border-line bg-raised p-2.5">
                      <p className="text-[13.5px] leading-5 text-soft">{item.text}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {item.sourceIds.map((id) => {
                          const source = sourceMap.get(id);
                          return source ? <SourceButton key={id} source={source} onOpen={onSource} /> : null;
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="kicker">Read between the lines</h3>
              <p className="mt-0.5 text-[11.5px] leading-4 text-faint">Inferences, not recorded facts.</p>
              {answer.inferences.length === 0 ? (
                <p className="mt-1.5 text-[13.5px] text-muted">Nothing needed to be inferred.</p>
              ) : (
                <ul className="mt-1.5 space-y-2">
                  {answer.inferences.map((item, index) => (
                    <li key={index} className="rounded-lg border border-dashed border-line-strong bg-raised p-2.5">
                      <p className="text-[13.5px] leading-5 text-soft">{item.text}</p>
                      {item.basis && <p className="mt-1 text-[11.5px] leading-4 text-faint">Based on: {item.basis}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {answer.sources.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <h3 className="kicker">Meetings used</h3>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {answer.sources.map((source) => (
                  <SourceButton key={source.id} source={source} onOpen={onSource} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function SharePanel({ org, onChanged }: { org: OrgDetail; onChanged: () => Promise<void> }) {
  const sessions = useSessions((state) => state.sessions);
  const candidates = useMemo(
    () => [...sessions].filter((session) => !session.id.startsWith("sample-")).sort((a, b) => b.createdAt - a.createdAt),
    [sessions],
  );
  const admin = isAdminRole(org.org.role);
  const sharesById = useMemo(() => new Map(org.shares.map((share) => [share.id, share])), [org.shares]);
  const departmentOptions = admin
    ? org.departments
    : org.departments.filter((department) => department.id === org.org.departmentId);

  const [captureId, setCaptureId] = useState("");
  const [visibility, setVisibility] = useState<CaptureVisibility>("private");
  const [sensitivity, setSensitivity] = useState<CaptureSensitivity>("standard");
  const [departmentId, setDepartmentId] = useState(org.org.departmentId ?? "");
  const [grants, setGrants] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectCapture = (id: string) => {
    setCaptureId(id);
    const existing = sharesById.get(id);
    if (existing) {
      setVisibility(existing.visibility);
      setSensitivity(existing.sensitivity);
      setDepartmentId(existing.departmentId ?? "");
      setGrants(existing.grantUserIds);
      return;
    }
    setVisibility(admin ? "organisation" : org.org.departmentId ? "department" : "private");
    setSensitivity("standard");
    setDepartmentId(org.org.departmentId ?? "");
    setGrants([]);
  };

  const toggleGrant = (userId: string) => {
    setGrants((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));
  };

  const share = async () => {
    const session = candidates.find((item) => item.id === captureId);
    if (!session) {
      setError("Choose a meeting to share first.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.saveCapture(session);
      await api.shareCapture(org.org.id, {
        captureId: session.id,
        visibility: sensitivity === "confidential" ? "private" : visibility,
        sensitivity,
        departmentId: visibility === "department" && sensitivity === "standard" ? departmentId || null : null,
        grantUserIds: grants,
      });
      await onChanged();
      toast.success(sharesById.has(session.id) ? "Sharing updated" : "Meeting shared");
      setCaptureId("");
      setGrants([]);
      setSensitivity("standard");
      setVisibility(admin ? "organisation" : org.org.departmentId ? "department" : "private");
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSaving(false);
    }
  };

  const unshare = async (id: string) => {
    try {
      await api.unshareCapture(org.org.id, id);
      await onChanged();
      toast.success("Stopped sharing");
    } catch (err) {
      toast.error(messageFor(err));
    }
  };

  return (
    <div className="space-y-4">
      <Section
        title="Share a meeting"
        description="Choose who can reach this meeting when they ask the memory. You can change it at any time."
      >
        {candidates.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong bg-raised-2 px-3.5 py-3 text-[14px] text-muted">
            Record a meeting first. It will appear here once it is on this device.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="share-capture">
                  Meeting
                </label>
                <Select
                  id="share-capture"
                  value={captureId}
                  onChange={selectCapture}
                  options={[
                    { value: "", label: "Choose a meeting" },
                    ...candidates.map((session) => ({
                      value: session.id,
                      label: `${session.title}${sharesById.has(session.id) ? " · shared" : ""}`,
                    })),
                  ]}
                />
              </div>
              <div>
                <label className="label" htmlFor="share-sensitivity">
                  Sensitivity
                </label>
                <Select
                  id="share-sensitivity"
                  value={sensitivity}
                  onChange={(next) => setSensitivity(next as CaptureSensitivity)}
                  options={[
                    { value: "standard", label: "Standard" },
                    { value: "confidential", label: "Confidential" },
                  ]}
                />
              </div>
            </div>

            {sensitivity === "confidential" ? (
              <p className="flex items-start gap-2 rounded-lg border border-line bg-highlight px-3 py-2.5 text-[13.5px] leading-5 text-soft">
                <Lock className="mt-0.5 h-3.5 w-3.5 flex-none text-brass" />
                Confidential meetings are only reachable by you and the people you grant below. Department and
                organisation access are ignored.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="share-visibility">
                    Who can open it
                  </label>
                  <Select
                    id="share-visibility"
                    value={visibility}
                    onChange={(next) => setVisibility(next as CaptureVisibility)}
                    options={[
                      { value: "private", label: VISIBILITY_LABEL.private },
                      ...((admin || org.org.departmentId)
                        ? [{ value: "department", label: VISIBILITY_LABEL.department }]
                        : []),
                      ...(admin ? [{ value: "organisation", label: VISIBILITY_LABEL.organisation }] : []),
                    ]}
                  />
                </div>
                {visibility === "department" && (
                  <div>
                    <label className="label" htmlFor="share-department">
                      Department
                    </label>
                    <Select
                      id="share-department"
                      value={departmentId}
                      onChange={setDepartmentId}
                      options={[
                        { value: "", label: "Choose a department" },
                        ...departmentOptions.map((department) => ({
                          value: department.id,
                          label: department.name,
                        })),
                      ]}
                    />
                  </div>
                )}
              </div>
            )}

            <div>
              <p className="label">Give specific people access</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {org.members.map((member) => (
                  <label
                    key={member.userId}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-raised-2 px-2.5 py-2 text-[14px] text-soft transition-colors hover:border-line-strong"
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                      checked={grants.includes(member.userId)}
                      onChange={() => toggleGrant(member.userId)}
                    />
                    <span className="min-w-0 flex-1 truncate">{member.name || member.email}</span>
                    <span className="flex-none text-[12px] text-faint">
                      {member.departmentName ?? ROLE_LABEL[member.role]}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rec-line bg-rec-soft px-3 py-2.5">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-rec" />
                <p className="text-[14px] leading-5 text-soft">{error}</p>
              </div>
            )}

            <div className="flex justify-end">
              <button type="button" className="btn btn-primary" onClick={() => void share()} disabled={saving || !captureId}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShareIcon />}
                {sharesById.has(captureId) ? "Update sharing" : "Share meeting"}
              </button>
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Your shared meetings"
        description="Meetings you have shared into this organisation, and who they reach."
        aside={<Chip>{org.shares.length}</Chip>}
      >
        {org.shares.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong bg-raised-2 px-3.5 py-3 text-[14px] text-muted">
            Nothing is shared yet. The memory gets sharper as meetings are added.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {org.shares.map((share) => (
              <li key={share.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">{share.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Chip>{VISIBILITY_LABEL[share.visibility]}</Chip>
                    {share.visibility === "department" && share.departmentName && <Chip>{share.departmentName}</Chip>}
                    {share.sensitivity === "confidential" ? (
                      <Chip tone="warn">
                        <Lock className="h-3 w-3" />
                        Confidential
                      </Chip>
                    ) : (
                      <Chip>{SENSITIVITY_LABEL[share.sensitivity]}</Chip>
                    )}
                    {share.grantUserIds.length > 0 && <Chip>{share.grantUserIds.length} with direct access</Chip>}
                    <span className="text-[12.5px] text-faint">{format(share.createdAt, "d MMM yyyy")}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-muted hover:text-rec"
                  onClick={() => void unshare(share.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Stop sharing
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function ShareIcon() {
  return <Users className="h-4 w-4" />;
}

function PeoplePanel({ org, onChanged }: { org: OrgDetail; onChanged: () => Promise<void> }) {
  const { user } = useAuth();
  const admin = isAdminRole(org.org.role);
  const owner = org.org.role === "owner";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [departmentId, setDepartmentId] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<OrgMember | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const add = async () => {
    if (!email.trim()) {
      setError("Add the email they use on JotBox.");
      return;
    }
    setAdding(true);
    setError("");
    try {
      await api.addMember(org.org.id, { email: email.trim(), role, departmentId: departmentId || null });
      await onChanged();
      setEmail("");
      setRole("member");
      setDepartmentId("");
      toast.success("Member added");
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setAdding(false);
    }
  };

  const patch = async (member: OrgMember, input: { role?: OrgRole; departmentId?: string | null }) => {
    setSavingId(member.userId);
    try {
      await api.updateMember(org.org.id, member.userId, input);
      await onChanged();
      toast.success("Access updated");
    } catch (err) {
      toast.error(messageFor(err));
    } finally {
      setSavingId(null);
    }
  };

  const remove = async () => {
    if (!removing) return;
    const target = removing;
    setRemoving(null);
    try {
      await api.removeMember(org.org.id, target.userId);
      await onChanged();
      toast.success("Member removed");
    } catch (err) {
      toast.error(messageFor(err));
    }
  };

  return (
    <Section
      title="People"
      description="Roles decide who can share organisation-wide meetings, manage people, and read the audit trail."
      aside={<Chip>{org.members.length}</Chip>}
    >
      <ul className="divide-y divide-line">
        {org.members.map((member) => {
          const isSelf = user?.id === member.userId;
          const locked = member.role === "owner" || (org.org.role === "admin" && member.role === "admin") || isSelf;
          return (
            <li key={member.userId} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">
                {(member.name.trim()[0] ?? member.email[0]).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-ink">
                  {member.name || member.email}
                  {isSelf && <span className="ml-1.5 text-[12.5px] font-normal text-faint">you</span>}
                </p>
                <p className="truncate text-[13px] text-faint">{member.email}</p>
              </div>

              {admin && !locked ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Select
                    className="h-8 min-h-0 w-[8rem] py-0 pl-2.5 text-[13.5px]"
                    value={member.role}
                    onChange={(next) => void patch(member, { role: next as OrgRole })}
                    disabled={savingId === member.userId}
                    aria-label={`Role for ${member.name || member.email}`}
                    options={[
                      { value: "member", label: "Member" },
                      { value: "manager", label: "Manager" },
                      ...(owner ? [{ value: "admin", label: "Admin" }] : []),
                    ]}
                  />
                  <Select
                    className="h-8 min-h-0 w-[9rem] py-0 pl-2.5 text-[13.5px]"
                    value={member.departmentId ?? ""}
                    onChange={(next) => void patch(member, { departmentId: next ? next : null })}
                    disabled={savingId === member.userId}
                    aria-label={`Department for ${member.name || member.email}`}
                    options={[
                      { value: "", label: "No department" },
                      ...org.departments.map((department) => ({
                        value: department.id,
                        label: department.name,
                      })),
                    ]}
                  />
                  <button
                    type="button"
                    className="icon-btn h-8 w-8 text-muted hover:text-rec"
                    onClick={() => setRemoving(member)}
                    aria-label={`Remove ${member.name || member.email}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {member.departmentName && <Chip>{member.departmentName}</Chip>}
                  <Chip tone={member.role === "owner" ? "accent" : "default"}>{ROLE_LABEL[member.role]}</Chip>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {admin && (
        <div className="mt-4 rounded-xl border border-line bg-raised-2 p-3.5">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-accent" />
            <p className="text-[14.5px] font-medium text-ink">Add someone</p>
          </div>
          <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
            <input
              className="field flex-1"
              type="email"
              placeholder="Their JotBox email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Select
              className="w-full sm:w-[8.5rem]"
              value={role}
              onChange={(next) => setRole(next as OrgRole)}
              aria-label="New member role"
              options={[
                { value: "member", label: "Member" },
                { value: "manager", label: "Manager" },
                ...(owner ? [{ value: "admin", label: "Admin" }] : []),
              ]}
            />
            <Select
              className="w-full sm:w-[10rem]"
              value={departmentId}
              onChange={setDepartmentId}
              aria-label="New member department"
              options={[
                { value: "", label: "No department" },
                ...org.departments.map((department) => ({
                  value: department.id,
                  label: department.name,
                })),
              ]}
            />
            <button type="button" className="btn btn-line" onClick={() => void add()} disabled={adding}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </button>
          </div>
          <p className="mt-1.5 text-[12.5px] text-faint">They need a JotBox account first.</p>
          {error && <p className="mt-2 text-[13.5px] text-rec">{error}</p>}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove this person?"
        description={
          removing
            ? `${removing.name || removing.email} will lose access to this organisation's shared meetings. Their own recordings stay with them.`
            : ""
        }
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </Section>
  );
}

function WorkspacePanel({ org, onChanged }: { org: OrgDetail; onChanged: () => Promise<void> }) {
  const admin = isAdminRole(org.org.role);
  const [departmentName, setDepartmentName] = useState("");
  const [addingDept, setAddingDept] = useState(false);
  const [name, setName] = useState(org.org.name);
  const [retention, setRetention] = useState(String(org.org.retentionDays));
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgError, setOrgError] = useState("");

  useEffect(() => {
    setName(org.org.name);
    setRetention(String(org.org.retentionDays));
  }, [org.org.name, org.org.retentionDays]);

  const addDepartment = async () => {
    if (!departmentName.trim()) return;
    setAddingDept(true);
    try {
      await api.createDepartment(org.org.id, departmentName.trim());
      await onChanged();
      setDepartmentName("");
      toast.success("Department added");
    } catch (err) {
      toast.error(messageFor(err));
    } finally {
      setAddingDept(false);
    }
  };

  const saveOrg = async () => {
    const days = Number(retention);
    if (!Number.isFinite(days) || days < 30 || days > 3650) {
      setOrgError("Keep between 30 and 3650 days.");
      return;
    }
    setSavingOrg(true);
    setOrgError("");
    try {
      await api.updateOrg(org.org.id, { name: name.trim(), retentionDays: Math.round(days) });
      await onChanged();
      toast.success("Organisation updated");
    } catch (err) {
      setOrgError(messageFor(err));
    } finally {
      setSavingOrg(false);
    }
  };

  return (
    <div className="space-y-4">
      <SharePanel org={org} onChanged={onChanged} />
      <PeoplePanel org={org} onChanged={onChanged} />

      <Section
        title="Departments"
        description="Departments decide which meetings a person can see when sharing stays inside a team."
        aside={<Chip>{org.departments.length}</Chip>}
      >
        {org.departments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong bg-raised-2 px-3.5 py-3 text-[14px] text-muted">
            No departments yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {org.departments.map((department) => (
              <span key={department.id} className="chip">
                <Building2 className="h-3 w-3" />
                {department.name}
                <span className="text-faint">{department.memberCount}</span>
              </span>
            ))}
          </div>
        )}
        {admin && (
          <div className="mt-3 flex gap-2">
            <input
              className="field flex-1"
              placeholder="New department, e.g. Finance"
              value={departmentName}
              onChange={(event) => setDepartmentName(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-line"
              onClick={() => void addDepartment()}
              disabled={addingDept || !departmentName.trim()}
            >
              {addingDept ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </button>
          </div>
        )}
      </Section>

      <Section
        title="Organisation settings"
        description="The name people see, and how long the memory may consider old meetings."
        aside={admin ? undefined : <Chip>Admins only</Chip>}
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <div>
            <label className="label" htmlFor="org-name">
              Name
            </label>
            <input
              id="org-name"
              className="field"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!admin}
            />
          </div>
          <div>
            <label className="label" htmlFor="org-retention">
              Keep meetings for
            </label>
            <div className="flex items-center gap-2">
              <input
                id="org-retention"
                className="field"
                type="number"
                min={30}
                max={3650}
                value={retention}
                onChange={(event) => setRetention(event.target.value)}
                disabled={!admin}
              />
              <span className="text-[13.5px] text-muted">days</span>
            </div>
          </div>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-4 text-faint">
          <Clock className="mt-px h-3 w-3 flex-none" />
          Older meetings drop out of memory answers. The recordings themselves stay on each person's device.
        </p>
        {admin && (
          <div className="mt-3 flex items-center justify-end gap-2">
            {orgError && <span className="text-[13.5px] text-rec">{orgError}</span>}
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveOrg()} disabled={savingOrg}>
              {savingOrg ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save changes
            </button>
          </div>
        )}
      </Section>
    </div>
  );
}

function AuditPanel({ org }: { org: OrgDetail }) {
  const admin = isAdminRole(org.org.role);
  const [events, setEvents] = useState<OrgAuditEvent[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    void api
      .getAudit(org.org.id)
      .then((rows) => {
        if (alive) setEvents(rows);
      })
      .catch((err) => {
        if (alive) setError(messageFor(err));
      });
    return () => {
      alive = false;
    };
  }, [admin, org.org.id]);

  if (!admin) {
    return (
      <EmptyState
        icon={<History className="h-5 w-5" />}
        title="The audit trail is for admins"
        body="Owners and admins can see who shared a meeting, changed access, or asked the memory. Ask an admin if you need a record."
      />
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-rec-line bg-rec-soft px-3 py-2.5">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-rec" />
        <p className="text-[14px] leading-5 text-soft">{error}</p>
      </div>
    );
  }

  if (!events) {
    return (
      <div className="flex items-center gap-2 py-10 text-[14.5px] text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading the audit trail…
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<History className="h-5 w-5" />}
        title="No activity yet"
        body="Sharing a meeting, changing someone's access, or asking the memory will show up here."
      />
    );
  }

  return (
    <Section
      title="Audit trail"
      description="A plain record of access changes and memory questions across this organisation."
      aside={<Chip>{events.length} recent</Chip>}
    >
      <ul className="divide-y divide-line">
        {events.map((event) => (
          <li key={event.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
            <span
              className={clsx(
                "mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-lg",
                event.action === "memory.query_failed"
                  ? "bg-rec-soft text-rec"
                  : event.action.startsWith("memory.")
                    ? "bg-accent-soft text-accent"
                    : "bg-raised-2 text-muted",
              )}
            >
              {event.action.startsWith("memory.") ? (
                <Search className="h-3.5 w-3.5" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p className="text-[14.5px] font-medium text-ink">{AUDIT_LABEL[event.action] ?? event.action}</p>
                <p className="text-[12.5px] text-faint">
                  {event.actorName || event.actorEmail || "Someone"} ·{" "}
                  {formatDistanceToNowStrict(event.createdAt, { addSuffix: true })}
                </p>
              </div>
              {auditDetail(event) && (
                <p className="mt-0.5 truncate text-[13.5px] text-muted">{auditDetail(event)}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function CreateOrg({ onCreated }: { onCreated: (org: Organisation) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    if (name.trim().length < 2) {
      setError("Give the organisation a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const org = await api.createOrg(name.trim());
      toast.success("Organisation created");
      onCreated(org);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="card p-6 sm:p-8">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Building2 className="h-5 w-5" />
        </span>
        <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.03em] text-ink">Start your organisation</h2>
        <p className="mt-1.5 max-w-[46ch] text-[15px] leading-6 text-muted">
          Bring meetings together so decisions, changes, and the reasons behind them survive past the room.
        </p>
        <div className="mt-5">
          <label className="label" htmlFor="new-org-name">
            Organisation name
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="new-org-name"
              className="field flex-1"
              placeholder="e.g. Northline Logistics"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create();
              }}
            />
            <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Create
            </button>
          </div>
          {error && <p className="mt-2 text-[13.5px] text-rec">{error}</p>}
          <p className="mt-2 text-[12.5px] leading-4 text-faint">
            You become the owner. You can add departments and people next.
          </p>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-ink">What the memory does</h2>
        <ul className="mt-3 space-y-3">
          {[
            {
              icon: <Sparkles className="h-4 w-4" />,
              title: "Connects decisions over time",
              body: "Ask what changed and why across months of meetings, not just today's.",
            },
            {
              icon: <BookOpen className="h-4 w-4" />,
              title: "Cites what was said",
              body: "Every recorded fact points to the meeting it came from.",
            },
            {
              icon: <Lock className="h-4 w-4" />,
              title: "Respects access",
              body: "Private, confidential, and other teams' meetings never reach the answer.",
            },
          ].map((item) => (
            <li key={item.title} className="flex gap-2.5">
              <span className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-lg bg-raised-2 text-accent">
                {item.icon}
              </span>
              <div>
                <p className="text-[14.5px] font-medium text-ink">{item.title}</p>
                <p className="mt-0.5 text-[13.5px] leading-5 text-muted">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function MemoryPage() {
  const [orgs, setOrgs] = useState<Organisation[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [tab, setTab] = useState<Tab>("ask");
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await api.listOrgs();
        if (!alive) return;
        setOrgs(list);
        const first = list[0]?.id ?? null;
        setActiveId(first);
        if (first) {
          const result = await api.getOrg(first);
          if (alive) setDetail(result);
        }
      } catch (err) {
        if (alive) setError(messageFor(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const id = activeId;
    const list = await api.listOrgs();
    setOrgs(list);
    if (id) setDetail(await api.getOrg(id));
  }, [activeId]);

  const switchOrg = async (id: string) => {
    setActiveId(id);
    setSwitching(true);
    setError("");
    try {
      setDetail(await api.getOrg(id));
      setTab("ask");
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSwitching(false);
    }
  };

  const created = async (org: Organisation) => {
    const list = await api.listOrgs();
    setOrgs(list);
    setActiveId(org.id);
    setDetail(await api.getOrg(org.id));
    setTab("workspace");
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-[15px] text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Opening the memory…
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Memory</p>
          <h1 className="mt-1.5 text-[28px] font-semibold tracking-[-0.04em] text-ink sm:text-[32px]">
            What the organisation knows.
          </h1>
          <p className="mt-1 text-[15px] text-muted">
            Meetings, decisions, and the reasons behind them, kept in one place.
          </p>
        </div>
        {orgs && orgs.length > 0 && (
          <div className="flex items-center gap-2">
            <Select
              className="h-10 min-h-0 w-[12rem] py-0 pl-3 text-[14.5px]"
              value={activeId ?? ""}
              onChange={(next) => void switchOrg(next)}
              aria-label="Organisation"
              disabled={switching}
              options={orgs.map((org) => ({ value: org.id, label: org.name }))}
            />
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rec-line bg-rec-soft px-3 py-2.5">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-rec" />
          <p className="text-[14px] leading-5 text-soft">{error}</p>
        </div>
      )}

      {orgs && orgs.length === 0 ? (
        <CreateOrg onCreated={(org) => void created(org)} />
      ) : !detail ? (
        <div className="flex items-center gap-2 py-16 text-[15px] text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Opening the organisation…
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="seg" role="tablist" aria-label="Memory sections">
              {(
                [
                  { value: "ask", label: "Ask", Icon: Sparkles },
                  { value: "workspace", label: "Workspace", Icon: Users },
                  { value: "audit", label: "Audit", Icon: History },
                ] as const
              ).map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.value}
                  data-active={tab === item.value}
                  className="seg-item"
                  onClick={() => setTab(item.value)}
                >
                  <item.Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip>
                <Users className="h-3 w-3" />
                {detail.org.memberCount} people
              </Chip>
              <Chip>
                <Building2 className="h-3 w-3" />
                {detail.org.departmentCount} departments
              </Chip>
              <Chip tone="accent">{ROLE_LABEL[detail.org.role]}</Chip>
            </div>
          </div>

          <div className="mt-4">
            {tab === "ask" && <AskPanel key={detail.org.id} org={detail} onSource={setSourceId} />}
            {tab === "workspace" && <WorkspacePanel org={detail} onChanged={refresh} />}
            {tab === "audit" && <AuditPanel org={detail} />}
          </div>
        </>
      )}

      {sourceId && detail && <SourceDialog orgId={detail.org.id} sourceId={sourceId} onClose={() => setSourceId(null)} />}
    </div>
  );
}
