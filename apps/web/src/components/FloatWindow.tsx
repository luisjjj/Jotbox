import { createPortal } from "react-dom";
import clsx from "clsx";
import { Pause, Play, Square, X } from "lucide-react";
import { useEngine } from "@/engine/SessionEngine";
import { formatClock } from "@/lib/format";
import { BrandMark } from "./Brand";
import { Waveform } from "./Waveform";

export function FloatWindow() {
  const { pip } = useEngine();

  if (!pip) return null;

  return createPortal(<FloatPanel />, pip.document.body);
}

function FloatPanel() {
  const { status, elapsed, title, scratch, setScratch, lines, interim, pause, resume, stop, pip } = useEngine();
  const paused = status === "paused";
  const recent = lines.slice(-3);

  return (
    <div className="flex h-screen flex-col gap-2 bg-paper p-3 text-ink">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BrandMark className="h-6 w-6 rounded-lg" />
          <span className="text-[11.5px] font-semibold tracking-[-0.03em]">JotBox</span>
          <span className={clsx("h-1.5 w-1.5 rounded-full", paused ? "bg-faint" : "live-dot")} />
          <span className="text-[11px] font-semibold tabular-nums text-muted">{formatClock(elapsed)}</span>
        </div>
        <button
          type="button"
          className="icon-btn h-6 w-6"
          onClick={() => pip?.close()}
          aria-label="Close floating window"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="rounded-xl border border-line bg-raised px-3 py-2">
        <Waveform active={!paused} bars={30} className="h-7" />
        <p className="mt-0.5 truncate text-center text-[10.5px] text-muted">{title || "Untitled session"}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-raised-2 px-3 py-2 scroll-quiet">
        {recent.length === 0 && !interim ? (
          <p className="grid h-full place-items-center px-3 text-center text-[11px] leading-4 text-faint">
            Words will appear here as the room speaks.
          </p>
        ) : (
          <div className="space-y-1.5">
            {recent.map((line) => (
              <p key={line.id} className="text-[11px] leading-[1.5] text-soft">
                {line.speaker && <span className="font-semibold text-brass">{line.speaker}: </span>}
                {line.text}
              </p>
            ))}
            {interim && <p className="text-[11px] italic leading-[1.5] text-faint">{interim}</p>}
          </div>
        )}
      </div>

      <textarea
        className="h-[5.5rem] w-full resize-none rounded-xl border border-line bg-raised p-2.5 text-[12px] leading-5 text-ink outline-none placeholder:text-faint focus:border-accent"
        placeholder="Jot a line while you work…"
        value={scratch}
        onChange={(event) => setScratch(event.target.value)}
        spellCheck
      />

      <div className="flex gap-2">
        <button type="button" className="btn btn-line btn-sm flex-1" onClick={paused ? resume : pause}>
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button type="button" className="btn btn-danger btn-sm flex-1" onClick={() => void stop()}>
          <Square className="h-3 w-3 fill-current" />
          Stop
        </button>
      </div>
    </div>
  );
}
