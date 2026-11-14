import { useState } from "react";
import {
  ArrowRight,
  Check,
  Layers,
  Laptop,
  Mic,
  MonitorUp,
  Pause,
  Pin,
  Play,
  Smartphone,
  Square,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useEngine } from "@/engine/SessionEngine";
import { StaticBars } from "@/components/Waveform";
import { isDesktop } from "@/lib/desktop";
import { formatClock } from "@/lib/format";

function DesktopMock() {
  return (
    <div className="relative h-full min-h-[300px] overflow-hidden bg-[#e9e7df] dark:bg-[#121512]">
      <div
        className="absolute inset-0 opacity-80"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,0,0,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.035) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />
      <div className="absolute left-5 top-6 w-[280px] overflow-hidden rounded-lg border border-black/10 bg-white shadow-md dark:border-white/10 dark:bg-[#1c201d]">
        <div className="flex items-center gap-1 border-b border-black/5 px-2.5 py-2 dark:border-white/5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#e5a09a]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#e7cf9e]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#a9c9ae]" />
          <span className="ml-2 h-1 w-24 rounded-full bg-black/[0.07] dark:bg-white/10" />
        </div>
        <div className="flex gap-2.5 p-2.5">
          <div className="w-12 flex-none space-y-1.5">
            {[0.9, 0.6, 0.75, 0.5, 0.8].map((width, index) => (
              <div key={index} className="h-1 rounded-full bg-black/[0.06] dark:bg-white/[0.08]" style={{ width: `${width * 100}%` }} />
            ))}
          </div>
          <div className="flex-1 space-y-1.5">
            <div className="h-1.5 w-2/3 rounded-full bg-black/10 dark:bg-white/15" />
            {[1, 0.92, 0.85, 0.95, 0.7, 0.88, 0.6].map((width, index) => (
              <div key={index} className="h-1 rounded-full bg-black/[0.05] dark:bg-white/[0.07]" style={{ width: `${width * 100}%` }} />
            ))}
          </div>
        </div>
        <div className="border-t border-black/5 px-3 py-1.5 text-[9px] uppercase tracking-[0.12em] text-black/35 dark:border-white/5 dark:text-white/30">
          Google Meet · Design sync
        </div>
      </div>

      <div className="absolute inset-x-5 top-11 flex items-center gap-2 rounded-full border border-line bg-raised/95 py-2 pl-3 pr-2 shadow-float backdrop-blur">
        <span className="live-dot !h-1.5 !w-1.5" />
        <span className="flex-none text-[10px] font-semibold tabular-nums text-ink">08:41</span>
        <StaticBars className="h-4 w-9 flex-none text-accent" heights={[0.3, 0.7, 1, 0.5, 0.8, 0.4, 0.6]} />
        <p className="min-w-0 flex-1 truncate text-[10px] text-muted">
          <span className="font-semibold text-ink">Ada</span>: make we pause the same-day promise.
        </p>
      </div>

      <span className="absolute bottom-5 left-6 rounded-full border border-black/10 bg-white/80 px-2.5 py-1 text-[10.5px] font-medium text-black/50 shadow-sm backdrop-blur dark:border-white/10 dark:bg-black/30 dark:text-white/50">
        JotBox sits above, not beside
      </span>
    </div>
  );
}

const WAYS = [
  {
    Icon: Mic,
    title: "In the room",
    body: "A lecture hall, a seminar, a sit-down. The microphone does the listening; you take the occasional line.",
  },
  {
    Icon: MonitorUp,
    title: "On a call",
    body: "Share the Meet, Zoom, or Teams tab and include its audio. Your own microphone is mixed in.",
  },
  {
    Icon: Layers,
    title: "While you work",
    body: "Pin the pill above your other apps and keep the timer and the latest words in sight.",
  },
];

export default function FloatPage() {
  const { status, elapsed, title, pip, pin, pause, resume, stop, error, clearError } = useEngine();
  const recording = status === "recording" || status === "paused";
  const paused = status === "paused";
  const [onDesktop] = useState(() => isDesktop());
  const [canPin] = useState(
    () => isDesktop() || (typeof window !== "undefined" && "documentPictureInPicture" in window),
  );

  const handlePin = async () => {
    if (onDesktop) {
      toast.success("The island is already on. Hover it to expand.", { id: "island-on" });
      return;
    }
    try {
      if (pip) {
        pip.focus();
        return;
      }
      await pin();
      toast.success("The JotBox pill is on top");
    } catch {
      toast.error("The floating pill was blocked. Allow pop-ups and try again.");
    }
  };

  const handleStop = () => {
    toast.success("Writing your notes…", { id: "writing-notes" });
    void stop();
  };

  return (
    <div className="mx-auto w-full max-w-[1320px]">
      <p className="kicker">Companion</p>
      <h1 className="mt-1.5 text-[28px] font-semibold tracking-[-0.04em] text-ink sm:text-[32px]">
        Work with JotBox on top.
      </h1>
      <p className="mt-1 max-w-[52ch] text-[15px] leading-6 text-muted">
        Notes should not cost you your attention. Keep the listening pill small, above your work, and let the written
        notes arrive at the end.
      </p>

      {recording && (
        <div className="card mt-5 flex flex-wrap items-center gap-3 p-3.5 sm:p-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className={paused ? "h-2 w-2 flex-none rounded-full bg-faint" : "live-dot"} />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-[19px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
                  {formatClock(elapsed)}
                </span>
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-faint">
                  {paused ? "Paused" : "Listening"}
                </span>
              </div>
              <p className="truncate text-[13.5px] text-muted">{title || "Untitled session"}</p>
            </div>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <button type="button" className="btn btn-line flex-1 sm:flex-none" onClick={paused ? resume : pause}>
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {paused ? "Resume" : "Pause"}
            </button>
            <Link to="/listen" className="btn btn-line flex-1 sm:flex-none">
              Recording
            </Link>
            <button type="button" className="btn btn-danger flex-1 sm:flex-none" onClick={handleStop}>
              <Square className="h-3.5 w-3.5 fill-current" />
              Stop
            </button>
          </div>
          {(pip || onDesktop) && (
            <span className="chip w-full justify-center border-transparent bg-accent-soft text-accent sm:w-auto">
              <Check className="h-3 w-3" />
              Island on
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-line bg-raised-2 px-3.5 py-2.5">
          <p className="text-[13.5px] text-muted">{error}</p>
          <button type="button" className="icon-btn h-6 w-6" onClick={clearError} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <section className="card mt-5 overflow-hidden">
        <div className="grid lg:grid-cols-[1.02fr_0.98fr]">
          <div className="flex flex-col items-start p-6 sm:p-8">
            <span className="chip">
              <Layers className="h-3 w-3" />
              Floating pill
            </span>
            <h2 className="mt-4 max-w-[18ch] text-[30px] font-semibold leading-[1.08] tracking-[-0.045em] text-ink sm:text-[36px]">
              A small pill, above everything else.
            </h2>
            <p className="mt-3.5 max-w-[40ch] text-[15px] leading-6 text-muted">
              {onDesktop
                ? "When a session runs, JotBox shows a small island above your other windows. Hover it for the timer, the latest words, and the pause and stop controls."
                : "Press Float while a session runs. JotBox opens a small pill with the timer and the latest words, and it stays above your other windows and websites while you work."}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {recording ? (
                onDesktop ? (
                  <span className="chip border-transparent bg-accent-soft text-accent">
                    <Check className="h-3 w-3" />
                    Island is on
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handlePin()}
                    disabled={!canPin}
                  >
                    <Pin className="h-4 w-4" />
                    {pip ? "Focus the pill" : "Pin the pill"}
                  </button>
                )
              ) : (
                <Link to="/listen" className="btn btn-primary">
                  <Mic className="h-4 w-4" />
                  Start a capture
                </Link>
              )}
              <Link to="/library" className="btn btn-line">
                Read past notes
              </Link>
            </div>
            <p className="mt-4 flex items-start gap-1.5 text-[12.5px] leading-4 text-faint">
              <Laptop className="mt-px h-3.5 w-3.5 flex-none" />
              {onDesktop
                ? "The JotBox desktop app keeps the island above every window, with no pinning or pop-ups."
                : canPin
                  ? "Float works on a computer, in the browser you already use. Nothing to install."
                  : "Floating needs a computer browser. On this device, keep JotBox open while it listens."}
            </p>
          </div>
          <div className="hidden lg:block">
            <DesktopMock />
          </div>
        </div>
      </section>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {WAYS.map((way) => (
          <div key={way.title} className="card p-4">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-raised-2 text-accent">
              <way.Icon className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <h3 className="mt-3 text-[15.5px] font-semibold tracking-[-0.01em] text-ink">{way.title}</h3>
            <p className="mt-1.5 text-[13.5px] leading-5 text-muted">{way.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="card p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">Float it in four steps</h2>
            <span className="chip">Computer</span>
          </div>
          <ol className="mt-4 space-y-3.5">
            {(onDesktop
              ? [
                  "Start a capture from the microphone, or share a call tab.",
                  "The island appears at the top of your screen while the session runs.",
                  "Hover the island for the timer, the latest words, and the controls.",
                  "Press Stop when the room is done; the notes are written for you.",
                ]
              : [
                  "Start a capture from the microphone, or share a call tab.",
                  "Press Float while a session runs. The pill opens above your work.",
                  "Keep working. The timer and the latest words stay visible.",
                  "Press Stop when the room is done; the notes are written for you.",
                ]
            ).map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="grid h-6 w-6 flex-none place-items-center rounded-full border border-line bg-raised-2 text-[12px] font-semibold text-muted">
                  {index + 1}
                </span>
                <p className="pt-0.5 text-[14.5px] leading-5 text-soft">{step}</p>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Link to="/listen" className="btn btn-line btn-sm">
              Open the recording
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <span className="text-[12.5px] text-faint">Keep the tab open for live words.</span>
          </div>
        </section>

        <section className="card p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.02em] text-ink">
              <Smartphone className="h-4 w-4 text-muted" />
              On your phone
            </h2>
            <span className="chip">Mobile</span>
          </div>
          <p className="mt-3 text-[14.5px] leading-6 text-muted">
            iOS and Android do not allow a browser to float above other apps. Install JotBox to your home screen and it
            keeps recording while you switch apps.
          </p>
          <ul className="mt-3 space-y-2">
            {[
              "Add JotBox to the home screen.",
              "Start a capture, then switch apps freely. Audio continues.",
              "Keep JotBox in view, or use split screen, for live words.",
            ].map((item) => (
              <li key={item} className="flex gap-2 text-[13.5px] leading-5 text-soft">
                <span className="mt-[7px] h-1 w-1 flex-none rounded-full bg-brass" />
                {item}
              </li>
            ))}
          </ul>
          <Link to="/listen" className="btn btn-line btn-sm mt-4 w-full">
            <Mic className="h-3.5 w-3.5" />
            Capture on this device
          </Link>
        </section>
      </div>

      <p className="mt-8 text-center text-[13px] leading-5 text-faint">
        Works wherever sound plays in a tab: Google Meet, Zoom, Microsoft Teams, and recorded lectures.
      </p>
    </div>
  );
}
