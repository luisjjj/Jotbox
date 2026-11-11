import { createPortal } from "react-dom";
import { Pause, Play, Square, X } from "lucide-react";
import { useEngine } from "@/engine/SessionEngine";
import { formatClock } from "@/lib/format";
import { Waveform } from "./Waveform";

export function FloatWindow() {
  const { pip } = useEngine();

  if (!pip) return null;

  return createPortal(<FloatPanel />, pip.document.body);
}

function FloatPanel() {
  const { status, elapsed, title, lines, interim, pause, resume, stop, pip } = useEngine();
  const paused = status === "paused";
  const latest = lines[lines.length - 1];
  const words = interim || latest?.text || "";

  return (
    <div className="flex h-screen items-center justify-center bg-transparent p-1.5">
      <div
        className="float-pill flex w-full items-center gap-2 rounded-full border border-line bg-paper/95 py-1.5 pl-3 pr-1.5 shadow-float backdrop-blur"
        title={title || "Untitled session"}
      >
        <span className={paused ? "h-2 w-2 flex-none rounded-full bg-faint" : "live-dot"} aria-hidden="true" />
        <span className="flex-none text-[11.5px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
          {formatClock(elapsed)}
        </span>
        <Waveform
          active={!paused}
          bars={7}
          className="h-5 w-[38px] flex-none !gap-[2px]"
          barClassName="!h-4"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[8.5px] font-semibold uppercase tracking-[0.1em] text-faint">
            {paused ? "Paused" : "Listening"}
          </p>
          <p className="truncate text-[11px] leading-4 text-soft">
            {words ? (
              <>
                {!interim && latest?.speaker && (
                  <span className="font-semibold text-brass">{latest.speaker}: </span>
                )}
                {words}
              </>
            ) : (
              "Keep this pill close. Words will show here."
            )}
          </p>
        </div>
        <button
          type="button"
          className="grid h-7 w-7 flex-none place-items-center rounded-full border border-line bg-raised-2 text-muted transition hover:text-ink"
          onClick={paused ? resume : pause}
          aria-label={paused ? "Resume listening" : "Pause listening"}
        >
          {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
        </button>
        <button
          type="button"
          className="grid h-7 w-7 flex-none place-items-center rounded-full border border-transparent bg-rec-soft text-rec transition hover:brightness-95"
          onClick={() => void stop()}
          aria-label="Stop and write the notes"
        >
          <Square className="h-2.5 w-2.5 fill-current" />
        </button>
        <button
          type="button"
          className="grid h-7 w-7 flex-none place-items-center rounded-full text-faint transition hover:text-ink"
          onClick={() => pip?.close()}
          aria-label="Close the pill"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
