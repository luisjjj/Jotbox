import { useMemo } from "react";
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
  ShieldCheck,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { EmptyState } from "@/components/EmptyState";
import { SessionRow } from "@/components/SessionRow";
import { StaticBars } from "@/components/Waveform";
import { useSessions } from "@/lib/store";
import { loadSampleSessions } from "@/lib/seed";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function NotePreview() {
  return (
    <div className="relative h-full">
      <div className="absolute right-0 top-1/2 w-[300px] -translate-y-1/2">
        <div className="rotate-[1.8deg] rounded-xl bg-[#fbf8f0] p-4 text-[#20231e] shadow-2xl ring-1 ring-black/5">
          <div className="flex items-center justify-between border-b border-[#e9e3d4] pb-2">
            <span className="text-[11.5px] font-semibold tracking-[-0.01em]">Payout review</span>
            <span className="rounded-full bg-[#eaf0e9] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-[#46654f]">
              Meeting
            </span>
          </div>
          <p className="mt-2.5 text-[7.5px] font-semibold uppercase tracking-[0.16em] text-[#a09a8b]">Summary</p>
          <p className="mt-1 text-[9.5px] leading-[1.55] text-[#4c5048]">
            Friday's card volume is partly unsettled and the bank window missed the same-day promise. The group pauses
            that promise until the cutoff holds.
          </p>
          <p className="mt-2.5 text-[7.5px] font-semibold uppercase tracking-[0.16em] text-[#a09a8b]">Actions</p>
          <div className="mt-1 space-y-1">
            {["Send the merchant note before 4pm", "Re-pull the two failed batches"].map((line) => (
              <div key={line} className="flex items-start gap-1.5">
                <span className="mt-[2px] grid h-2.5 w-2.5 flex-none place-items-center rounded-[3px] border border-[#c9c4b4] bg-white" />
                <span className="text-[8.5px] leading-[1.5] text-[#5c5f55]">{line}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-[#ece6d8] pt-2">
            <StaticBars className="h-4 w-14 text-[#3f7a5e]" heights={[0.4, 0.7, 1, 0.5, 0.8, 0.3, 0.65, 0.9, 0.45]} />
            <span className="text-[7.5px] uppercase tracking-[0.12em] text-[#a09a8b]">Written by JotBox</span>
          </div>
        </div>

        <div className="absolute -bottom-8 -left-6 flex items-center gap-2 rounded-full bg-[#0c261f] px-3 py-1.5 text-[9.5px] font-medium text-[#ece8da] shadow-lg ring-1 ring-white/10">
          <span className="live-dot" />
          Recording · 18:42
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const sessions = useSessions((state) => state.sessions);
  const navigate = useNavigate();

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
    <div className="mx-auto max-w-[1060px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">{format(new Date(), "EEEE, d MMMM")}</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.035em] text-ink sm:text-[30px]">
            {greeting()}.
          </h1>
          <p className="mt-1 text-[13.5px] text-muted">Start a capture, or pick up where you left off.</p>
        </div>
        <Link to="/listen" className="btn btn-primary hidden sm:inline-flex">
          <Plus className="h-4 w-4" />
          New capture
        </Link>
      </div>

      <section className="hero-ink relative mt-5 overflow-hidden rounded-[1.4rem] shadow-float">
        <div className="hero-grid pointer-events-none absolute inset-0" />
        <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.05fr_0.95fr] lg:p-9">
          <div className="flex flex-col items-start">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#e7e2d3]">
              <span className="live-dot" />
              Live capture
            </span>
            <h2 className="mt-5 max-w-[18ch] font-serif text-[2.15rem] leading-[1.03] tracking-[-0.005em] text-[#f5f1e4] sm:text-[2.9rem]">
              The notes are written <em className="italic text-[#dcc69b]">while you listen.</em>
            </h2>
            <p className="mt-4 max-w-[37ch] text-[13px] leading-6 text-[#c5d0c7] sm:text-[13.5px]">
              Meetings, seminars, lectures — in the room or from a call tab. JotBox keeps the transcript, then writes
              the summary, decisions, and next steps. You stay present.
            </p>
            <div className="mt-6 flex w-full flex-col items-stretch gap-2.5 sm:w-auto sm:flex-row sm:items-center">
              <Link to="/listen" className="btn btn-lg btn-cream w-full sm:w-auto">
                <Mic className="h-4 w-4" />
                Start a capture
              </Link>
              <Link to="/float" className="btn btn-lg btn-hero-line w-full sm:w-auto">
                <Layers className="h-4 w-4" />
                Float over apps
              </Link>
            </div>
            <p className="mt-5 flex items-center gap-1.5 text-[10.5px] text-[#a6b5a8]">
              <ShieldCheck className="h-3.5 w-3.5" />
              Audio stays on this device. No account needed to try it.
            </p>
          </div>
          <div className="relative hidden min-h-[248px] lg:block">
            <NotePreview />
          </div>
        </div>
      </section>

      <div className="mt-3.5 grid grid-cols-3 gap-2.5 sm:gap-3.5">
        {[
          { label: "Sessions", value: stats.count, Icon: FileText },
          { label: "Minutes", value: stats.minutes, Icon: Clock },
          { label: "Open actions", value: stats.actions, Icon: ListChecks },
        ].map((item) => (
          <div key={item.label} className="card flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
            <span className="hidden h-8 w-8 flex-none place-items-center rounded-lg bg-raised-2 text-muted sm:grid">
              <item.Icon className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <p className="text-[19px] font-semibold leading-none tracking-[-0.03em] text-ink sm:text-[22px]">
                {item.value}
              </p>
              <p className="mt-1.5 truncate text-[10px] font-medium uppercase tracking-[0.08em] text-faint sm:text-[10.5px]">
                {item.label}
              </p>
            </div>
          </div>
        ))}
      </div>

      <section className="mt-8">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-ink">Recent notes</h2>
            <p className="mt-0.5 text-[12px] text-muted">Captured on this device.</p>
          </div>
          <Link
            to="/library"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-muted transition-colors hover:text-ink"
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
            {recent.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </div>
        )}
      </section>

      <Link
        to="/float"
        className="card group mt-4 flex items-center justify-between gap-4 p-4 transition-colors hover:bg-raised-2 sm:p-4"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-accent-soft text-accent">
            <Layers className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink">Keep JotBox on top</p>
            <p className="mt-0.5 truncate text-[12px] text-muted">
              Pin the compact window above Meet, Zoom, or your slides while you work.
            </p>
          </div>
        </div>
        <ArrowUpRight className="h-4 w-4 flex-none text-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
