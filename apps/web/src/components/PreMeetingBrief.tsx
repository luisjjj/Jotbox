import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ClipboardCheck, Info, Loader2, Mic } from "lucide-react";
import { Link } from "react-router-dom";
import { Modal } from "@/components/Modal";
import { formatWhen, KIND_META } from "@/lib/format";
import { previousSessionFor, requestPreMeetingBrief, toBriefPrevious } from "@/lib/brief";
import { useSessions } from "@/lib/store";
import type { SessionKind } from "@/lib/types";

interface BriefState {
  status: "idle" | "loading" | "done";
  bullets: string[];
  source: "ai" | "local";
}

export function PreMeetingBrief({
  title,
  kind,
  onStart,
}: {
  title: string;
  kind: SessionKind;
  onStart?: () => void;
}) {
  const sessions = useSessions((state) => state.sessions);
  const previous = useMemo(() => previousSessionFor(sessions, { title, kind }), [sessions, title, kind]);
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<BriefState>({ status: "idle", bullets: [], source: "ai" });
  const requestId = useRef(0);

  useEffect(() => {
    requestId.current += 1;
    setBrief({ status: "idle", bullets: [], source: "ai" });
  }, [previous?.id]);

  if (!previous) return null;

  const openCount = previous.notes?.actions.filter((action) => !action.done).length ?? 0;
  const previousKind = KIND_META[previous.kind].label.toLowerCase();
  const briefLabel = kind === "lecture" ? "Pre-Class Brief" : kind === "voice" ? "From Last Time" : "Pre-Meeting Brief";

  const show = () => {
    setOpen(true);
    if (brief.status !== "idle") return;
    const id = ++requestId.current;
    setBrief({ status: "loading", bullets: [], source: "ai" });
    void requestPreMeetingBrief({ title, kind, previous: toBriefPrevious(previous) }).then((result) => {
      if (requestId.current !== id) return;
      setBrief({ status: "done", bullets: result.bullets, source: result.source });
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="group flex w-full items-start gap-3 rounded-xl border border-line bg-raised px-3.5 py-3 text-left transition-colors hover:border-line-strong hover:bg-raised-2"
      >
        <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-accent-soft text-accent">
          <ClipboardCheck className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[14.5px] font-semibold text-ink">{briefLabel}</span>
            <span className="truncate text-[12.5px] text-faint">
              From {previous.title} · {formatWhen(previous.createdAt)}
            </span>
          </span>
          <span className="mt-0.5 block text-[13.5px] leading-5 text-muted">
            {openCount
              ? `${openCount} follow-up${openCount === 1 ? "" : "s"} still open from last time.`
              : "See what to follow up on today."}
          </span>
        </span>
        <span className="mt-1.5 hidden flex-none items-center gap-1 text-[13px] font-medium text-accent sm:flex">
          What to follow up on
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
        <ArrowRight className="mt-1.5 h-4 w-4 flex-none text-accent sm:hidden" />
      </button>

      <Modal
        open={open}
        title="What to follow up on today"
        description={`From ${previous.title} · ${formatWhen(previous.createdAt)}`}
        onClose={() => setOpen(false)}
      >
        {brief.status === "loading" && (
          <div aria-live="polite">
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Reading your last notes…
            </p>
            <div className="mt-3 space-y-2.5">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-14 animate-pulse rounded-xl bg-raised-2" />
              ))}
            </div>
          </div>
        )}

        {brief.status === "done" && (
          <div aria-live="polite">
            {brief.bullets.length ? (
              <ol className="space-y-2.5">
                {brief.bullets.map((bullet, index) => (
                  <li
                    key={bullet}
                    className="flex items-start gap-3 rounded-xl border border-line bg-raised-2 px-3.5 py-3"
                  >
                    <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-accent text-[12px] font-semibold text-accent-ink">
                      {index + 1}
                    </span>
                    <p className="text-[14.5px] leading-6 text-soft">{bullet}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center">
                <ClipboardCheck className="mx-auto h-6 w-6 text-faint" />
                <p className="mt-2 text-[14px] leading-5 text-muted">
                  The last notes had no open follow-ups. Open the {previousKind} to see what was decided.
                </p>
              </div>
            )}
            {brief.source === "local" && (
              <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-5 text-faint">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-none" />
                The live brief could not load, so these come from the open items in your last notes on this device.
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-col-reverse gap-2 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            to={`/session/${previous.id}`}
            className="btn btn-ghost btn-sm justify-center"
            onClick={() => setOpen(false)}
          >
            Open last {previousKind}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          {onStart && (
            <button
              type="button"
              className="btn btn-primary btn-sm justify-center"
              onClick={() => {
                setOpen(false);
                onStart();
              }}
            >
              <Mic className="h-4 w-4" />
              Start with microphone
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
