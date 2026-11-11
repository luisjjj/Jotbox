import { useMemo, useState } from "react";
import clsx from "clsx";
import { differenceInCalendarDays, format, isToday, isYesterday } from "date-fns";
import { Inbox, Mic, Plus, Search, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { EmptyState } from "@/components/EmptyState";
import { SessionRow } from "@/components/SessionRow";
import { KIND_META } from "@/lib/format";
import { loadSampleSessions } from "@/lib/seed";
import { useSessions } from "@/lib/store";
import type { SessionKind } from "@/lib/types";

const FILTERS: Array<{ value: "all" | SessionKind; label: string }> = [
  { value: "all", label: "All" },
  { value: "meeting", label: "Meetings" },
  { value: "seminar", label: "Seminars" },
  { value: "lecture", label: "Lectures" },
  { value: "voice", label: "Voice" },
];

function bucketFor(timestamp: number) {
  const now = Date.now();
  if (isToday(timestamp)) return "Today";
  if (isYesterday(timestamp)) return "Yesterday";
  const days = differenceInCalendarDays(now, timestamp);
  if (days <= 7) return "Previous 7 days";
  return format(timestamp, "MMMM yyyy");
}

export default function Library() {
  const sessions = useSessions((state) => state.sessions);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | SessionKind>("all");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...sessions]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((session) => filter === "all" || session.kind === filter)
      .filter((session) => {
        if (!term) return true;
        const haystack = [
          session.title,
          KIND_META[session.kind].label,
          session.notes?.summary ?? "",
          session.scratch,
          session.notes?.highlights.join(" ") ?? "",
          session.transcript.map((line) => line.text).join(" "),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(term);
      });
  }, [sessions, filter, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const session of filtered) {
      const bucket = bucketFor(session.createdAt);
      const list = map.get(bucket) ?? [];
      list.push(session);
      map.set(bucket, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const addExamples = () => {
    loadSampleSessions();
    toast.success("Example notes added");
    navigate("/session/sample-meeting");
  };

  return (
    <div className="mx-auto max-w-[900px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Library</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.04em] text-ink sm:text-[30px]">
            Everything you have heard.
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {sessions.length === 0
              ? "What you capture shows up here, with the spoken words and the written notes."
              : `${sessions.length} session${sessions.length === 1 ? "" : "s"} in your library.`}
          </p>
        </div>
        <Link to="/listen" className="btn btn-primary hidden sm:inline-flex">
          <Plus className="h-4 w-4" />
          New capture
        </Link>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            className="field pl-9 pr-9"
            placeholder="Search titles, notes, and spoken words"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search sessions"
            type="search"
          />
          {query && (
            <button
              type="button"
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-faint hover:bg-raised-2 hover:text-ink"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((item) => {
            const active = filter === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                aria-pressed={active}
                className={clsx(
                  "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                  active
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-raised text-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={sessions.length === 0 ? <Mic className="h-5 w-5" /> : <Search className="h-5 w-5" />}
            title={sessions.length === 0 ? "The library is empty" : "Nothing matches that"}
            body={
              sessions.length === 0
                ? "Start a capture from the room or a call tab, or open an example to see finished notes."
                : "Try a different word, or clear the filter to see everything."
            }
          >
            {sessions.length === 0 ? (
              <>
                <button type="button" className="btn btn-line" onClick={addExamples}>
                  Open an example
                </button>
                <Link to="/listen" className="btn btn-primary">
                  Start a capture
                </Link>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-line"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  Clear filters
                </button>
              </>
            )}
          </EmptyState>
        </div>
      ) : (
        <div className="mt-7 space-y-6">
          {grouped.map(([label, items]) => (
            <section key={label}>
              <div className="mb-2 flex items-center justify-between px-1">
                <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">{label}</h2>
                <span className="text-[10.5px] tabular-nums text-faint">{items.length}</span>
              </div>
              <div className="card divide-y divide-line p-1.5">
                {items.map((session, index) => (
                  <div key={session.id} className="stagger-in" style={{ animationDelay: `${index * 45}ms` }}>
                    <SessionRow session={session} />
                  </div>
                ))}
              </div>
            </section>
          ))}
          {query && (
            <p className="flex items-center gap-1.5 px-1 text-[11px] text-faint">
              <Inbox className="h-3.5 w-3.5" />
              Searching titles, summaries, jottings, and spoken words.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
