import { useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { ChevronDown, ChevronUp, Pause, Play, Square, X } from "lucide-react";
import { useEngine } from "@/engine/SessionEngine";
import { formatClock } from "@/lib/format";
import { Waveform } from "./Waveform";

const COMPACT = { width: 324, height: 64 };
const EXPANDED = { width: 408, height: 204 };

export function FloatWindow() {
  const { pip } = useEngine();

  if (!pip) return null;

  return createPortal(<FloatPanel />, pip.document.body);
}

function FloatPanel() {
  const { status, elapsed, title, lines, interim, pause, resume, stop, pip } = useEngine();
  const [open, setOpen] = useState(false);
  const paused = status === "paused";
  const latest = lines[lines.length - 1];
  const previous = lines[lines.length - 2];
  const words = interim || latest?.text || "";

  const resize = (next: boolean) => {
    setOpen(next);
    const target = next ? EXPANDED : COMPACT;
    window.requestAnimationFrame(() => {
      try {
        pip?.resizeTo(target.width, target.height);
      } catch {
        // Some browsers do not let a page resize a picture-in-picture window.
      }
    });
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-transparent p-1">
      <div
        className={clsx(
          "island flex w-full flex-col overflow-hidden border border-white/10 shadow-float transition-[border-radius,padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          open ? "is-open rounded-[1.4rem] px-3 py-2.5" : "rounded-full px-3 py-1.5",
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              "flex-none rounded-full",
              paused ? "h-2 w-2 bg-[#75847a]" : "live-dot !h-2 !w-2",
            )}
            aria-hidden="true"
          />
          <span className="flex-none text-[12px] font-semibold tabular-nums tracking-[-0.02em] text-[#f5f1e4]">
            {formatClock(elapsed)}
          </span>
          <Waveform
            active={!paused}
            bars={open ? 9 : 7}
            tone="light"
            className="h-5 flex-none !gap-[2px]"
            barClassName="!h-4"
          />
          <div className="min-w-0 flex-1">
            {open ? (
              <>
                <p className="text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[#a6b5a8]">
                  {paused ? "Paused" : "Listening"}
                </p>
                <p className="truncate text-[11px] leading-4 text-[#e3ebe1]">{title || "Untitled session"}</p>
              </>
            ) : (
              <p className="truncate text-[11px] leading-4 text-[#d8e2d8]">{title || "Untitled session"}</p>
            )}
          </div>
          <button
            type="button"
            className="island-control grid h-7 w-7 flex-none place-items-center rounded-full bg-white/[0.08] text-[#d8e2d8] hover:bg-white/[0.14] hover:text-[#f5f1e4]"
            onClick={() => resize(!open)}
            aria-expanded={open}
            aria-label={open ? "Collapse the pill" : "Expand the pill"}
            title={open ? "Collapse" : "Expand"}
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        <div className="island-body">
          <div>
            <div className="mt-2.5 space-y-1 border-t border-white/10 pt-2.5">
              {previous && (
                <p className="truncate text-[10.5px] leading-4 text-[#96a89b]">
                  {previous.speaker && <span className="font-semibold text-[#c9b48a]">{previous.speaker}: </span>}
                  {previous.text}
                </p>
              )}
              <p className="text-[11.5px] leading-5 text-[#eef2e7]">
                {words ? (
                  <>
                    {!interim && latest?.speaker && (
                      <span className="font-semibold text-[#dcc69b]">{latest.speaker}: </span>
                    )}
                    {words}
                  </>
                ) : (
                  "Words will show here as the room speaks."
                )}
              </p>
            </div>

            <div className="mt-2.5 flex items-center gap-1.5">
              <button
                type="button"
                className="island-control flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full bg-white/[0.1] text-[11px] font-semibold text-[#f5f1e4] hover:bg-white/[0.16]"
                onClick={paused ? resume : pause}
              >
                {paused ? <Play className="h-3 w-3 fill-current" /> : <Pause className="h-3 w-3" />}
                {paused ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                className="island-control flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full bg-[#e0b3ad] text-[11px] font-semibold text-[#3b1715] hover:brightness-105"
                onClick={() => void stop()}
              >
                <Square className="h-2.5 w-2.5 fill-current" />
                Stop
              </button>
              <button
                type="button"
                className="island-control grid h-8 w-8 flex-none place-items-center rounded-full bg-white/[0.06] text-[#a6b5a8] hover:bg-white/[0.12] hover:text-[#f5f1e4]"
                onClick={() => pip?.close()}
                aria-label="Close the pill"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
