import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { formatClock, formatWhen, KIND_META } from "@/lib/format";
import { isSample } from "@/lib/seed";
import type { Session } from "@/lib/types";
import { KindDot, KindTile } from "./KindBadge";

export function SessionStatusChip({ session }: { session: Session }) {
  if (session.status === "live") {
    return (
      <span className="chip border-transparent bg-rec-soft text-rec">
        <span className="live-dot" />
        Live
      </span>
    );
  }
  if (session.status === "processing") {
    return (
      <span className="chip text-muted">
        <Loader2 className="h-3 w-3 animate-spin" />
        Writing
      </span>
    );
  }
  if (session.status === "failed") {
    return <span className="chip border-transparent bg-rec-soft text-rec">Needs attention</span>;
  }
  return null;
}

function previewFor(session: Session) {
  if (session.notes?.summary) return session.notes.summary;
  if (session.scratch.trim()) return session.scratch.trim();
  if (session.transcript.length) return session.transcript[0].text;
  return KIND_META[session.kind].hint;
}

export function SessionRow({
  session,
  compact = false,
  active = false,
  showPreview = true,
  showStatus = true,
}: {
  session: Session;
  compact?: boolean;
  active?: boolean;
  showPreview?: boolean;
  showStatus?: boolean;
}) {
  return (
    <Link
      to={`/session/${session.id}`}
      className={clsx(
        "group flex items-center gap-3 rounded-xl transition-colors",
        compact ? "px-2.5 py-2" : "px-3 py-3.5",
        active ? "bg-raised-2" : "hover:bg-raised-2",
      )}
    >
      <KindTile kind={session.kind} className={compact ? "h-8 w-8 rounded-[0.55rem]" : undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p
            className={clsx(
              "truncate font-medium tracking-[-0.01em] text-ink",
              compact ? "text-[14.5px]" : "text-[16px]",
              active && "font-semibold",
            )}
          >
            {session.title}
          </p>
          {isSample(session.id) && !compact && (
            <span className="hidden rounded border border-line px-1 py-px text-[11px] font-medium uppercase tracking-[0.08em] text-faint sm:inline">
              Example
            </span>
          )}
        </div>
        {compact ? (
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-faint">
            <KindDot kind={session.kind} />
            {formatWhen(session.createdAt)}
          </p>
        ) : (
          <p className="mt-0.5 truncate text-[14px] text-muted">
            {formatWhen(session.createdAt)}
            {session.durationSec > 0 && <span className="text-faint"> · {formatClock(session.durationSec)}</span>}
            {session.notes && <span className="text-faint"> · {session.notes.actions.filter((a) => !a.done).length} open</span>}
          </p>
        )}
        {!compact && showPreview && (
          <p className="mt-1 line-clamp-1 text-[14.5px] leading-5 text-faint">{previewFor(session)}</p>
        )}
      </div>
      {showStatus && session.status !== "ready" && <SessionStatusChip session={session} />}
      {showStatus && session.status === "ready" && compact && <KindDot kind={session.kind} className="opacity-70" />}
    </Link>
  );
}
