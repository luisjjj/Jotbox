import { useEffect, useMemo } from "react";
import clsx from "clsx";
import { format } from "date-fns";
import {
  ArrowRight,
  ArrowUpRight,
  Clock,
  FileText,
  Layers,
  ListChecks,
  Mic,
  Plus,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { EmptyState } from "@/components/EmptyState";
import { SessionRow } from "@/components/SessionRow";
import { useSessions } from "@/lib/store";
import { loadSampleSessions } from "@/lib/seed";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

type Stats = { count: number; minutes: number; actions: number };

function StatsGrid({ stats, stacked = false }: { stats: Stats; stacked?: boolean }) {
  const items = [
    { label: "Sessions", value: stats.count, Icon: FileText },
    { label: "Minutes", value: stats.minutes, Icon: Clock },
    { label: "Open actions", value: stats.actions, Icon: ListChecks },
  ];

  return (
    <div className={clsx("grid gap-2.5 sm:gap-3.5", stacked ? "grid-cols-1" : "grid-cols-3")}>
      {items.map((item, index) => (
        <div
          key={item.label}
          style={{ animationDelay: `${index * 70}ms` }}
          className="stagger-in card flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4"
        >
          <span className="hidden h-8 w-8 flex-none place-items-center rounded-lg bg-raised-2 text-muted sm:grid">
            <item.Icon className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <p className="text-[21px] font-semibold leading-none tracking-[-0.03em] text-ink sm:text-[24px]">
              {item.value}
            </p>
            <p className="mt-1.5 text-[12px] font-medium uppercase leading-4 tracking-[0.04em] text-faint sm:text-[12.5px] sm:tracking-[0.08em]">
              {item.label}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function FloatCard() {
  return (
    <Link
      to="/float"
      className="card group flex items-center justify-between gap-4 p-4 transition-colors hover:bg-raised-2"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-accent-soft text-accent">
          <Layers className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-ink">Keep JotBox on top</p>
          <p className="mt-0.5 truncate text-[14px] text-muted">
            Pin the pill above Meet, Zoom, or your slides while you work.
          </p>
        </div>
      </div>
      <ArrowUpRight className="h-4 w-4 flex-none text-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </Link>
  );
}

export default function Home() {
  const sessions = useSessions((state) => state.sessions);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "JotBox — your notes";
  }, []);

  const stats = useMemo(() => {
    const minutes = Math.round(sessions.reduce((total, session) => total + session.durationSec, 0) / 60);
    const actions = sessions.reduce(
      (total, session) => total + (session.notes?.actions.filter((action) => !action.done).length ?? 0),
      0,
    );
    return { count: sessions.length, minutes, actions };
  }, [sessions]);

  const recent = useMemo(
    () => [...sessions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
    [sessions],
  );

  const openExample = () => {
    loadSampleSessions();
    toast.success("Example notes added");
    navigate("/session/sample-meeting");
  };

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">{format(new Date(), "EEEE, d MMMM")}</p>
          <h1 className="mt-1.5 text-[28px] font-semibold tracking-[-0.035em] text-ink sm:text-[32px]">
            {greeting()}.
          </h1>
          <p className="mt-1 text-[15.5px] text-muted">Start a capture, or pick up where you left off.</p>
        </div>
        <Link to="/listen" className="btn btn-primary hidden sm:inline-flex">
          <Plus className="h-4 w-4" />
          New capture
        </Link>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_400px] 2xl:gap-6">
        <div className="min-w-0">
          <section className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-accent text-accent-ink">
                <Mic className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <div>
                <p className="text-[16px] font-medium tracking-[-0.01em] text-ink">Ready when the room is.</p>
                <p className="mt-0.5 max-w-[52ch] text-[14px] leading-5 text-muted">
                  Record a meeting, seminar, or lecture in the room or from a call tab. JotBox keeps the spoken words and
                  writes the notes when you stop.
                </p>
              </div>
            </div>
            <Link to="/listen" className="btn btn-primary btn-sm w-full flex-none sm:w-auto">
              Start a capture
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </section>

          <div className="mt-3.5 xl:hidden">
            <StatsGrid stats={stats} />
          </div>

          <section className="mt-8 xl:mt-7">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">Recent notes</h2>
                <p className="mt-0.5 text-[14px] text-muted">Your latest rooms, lectures, and calls.</p>
              </div>
              <Link
                to="/library"
                className="inline-flex flex-none items-center gap-1 whitespace-nowrap text-[14px] font-medium text-muted transition-colors hover:text-ink"
              >
                View library
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {recent.length === 0 ? (
              <EmptyState
                className="mt-3"
                icon={<Mic className="h-5 w-5" />}
                title="Your first note starts here"
                body="Record a meeting, lecture, or voice note. Or open an example to see how a finished set of JotBox notes reads."
              >
                <button type="button" className="btn btn-line" onClick={openExample}>
                  See an example
                </button>
                <Link to="/listen" className="btn btn-primary">
                  Start a capture
                </Link>
              </EmptyState>
            ) : (
              <div className="card mt-3 divide-y divide-line p-1.5">
                {recent.map((session, index) => (
                  <div key={session.id} className="stagger-in" style={{ animationDelay: `${index * 55}ms` }}>
                    <SessionRow session={session} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="mt-4 xl:hidden">
            <FloatCard />
          </div>
        </div>

        <aside className="hidden space-y-3.5 xl:block">
          <StatsGrid stats={stats} stacked />
          <FloatCard />
        </aside>
      </div>
    </div>
  );
}
