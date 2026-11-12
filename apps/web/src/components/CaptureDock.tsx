import { useState } from "react";
import clsx from "clsx";
import { ArrowUpRight, ChevronDown, Pause, Play, Square } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useEngine } from "@/engine/SessionEngine";
import { formatClock } from "@/lib/format";

export function CaptureDock() {
  const { status, elapsed, title, lines, interim, pause, resume, stop } = useEngine();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const visible =
    (status === "recording" || status === "paused") &&
    location.pathname !== "/listen" &&
    location.pathname !== "/float";
  if (!visible) return null;

  const paused = status === "paused";
  const latest = lines[lines.length - 1];
  const previous = lines[lines.length - 2];
  const words = interim || latest?.text || "";

  const handleStop = () => {
    toast.success("Writing your notes…", { id: "writing-notes" });
    void stop();
  };

  return (
    <div
      className={clsx(
        "fixed bottom-[calc(4.9rem+env(safe-area-inset-bottom))] left-3 right-3 z-40 transition-[max-width] duration-300 lg:bottom-6 lg:left-auto lg:right-7",
        open ? "lg:w-[430px]" : "lg:w-[390px]",
      )}
    >
      <div className="fade-up overflow-hidden rounded-2xl border border-line bg-raised shadow-float backdrop-blur-md">
        <div className="flex items-center gap-2.5 p-2 pl-3">
          <span className={paused ? "h-2 w-2 flex-none rounded-full bg-faint" : "live-dot"} />
          <button
            type="button"
            onClick={() => navigate("/listen")}
            className="min-w-0 flex-1 rounded-lg py-1 text-left"
            aria-label="Open the live recording"
          >
            <span className="flex items-baseline gap-1.5">
              <span className="text-[13px] font-semibold tabular-nums tracking-[-0.01em] text-ink">
                {formatClock(elapsed)}
              </span>
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-faint">
                {paused ? "paused" : "listening"}
              </span>
            </span>
            <span className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] text-muted">
              {title || "Untitled session"}
              <ArrowUpRight className="h-3 w-3 flex-none opacity-50" />
            </span>
          </button>
          <button
            type="button"
            className="icon-btn h-9 w-9 rounded-lg border border-line bg-raised"
            onClick={paused ? resume : pause}
            aria-label={paused ? "Resume recording" : "Pause recording"}
            title={paused ? "Resume" : "Pause"}
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button type="button" className="btn btn-primary btn-sm h-9" onClick={handleStop}>
            <Square className="h-3.5 w-3.5 fill-current" />
            Stop
          </button>
          <button
            type="button"
            className="icon-btn h-9 w-7 flex-none rounded-lg"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="capture-dock-more"
            aria-label={open ? "Collapse the listening pill" : "Expand the listening pill"}
            title={open ? "Collapse" : "Expand"}
          >
            <ChevronDown className={clsx("h-4 w-4 transition-transform duration-300", open && "rotate-180")} />
          </button>
        </div>

        <div
          id="capture-dock-more"
          className={clsx(
            "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <div className="border-t border-line px-3 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-faint">
                {paused ? "Paused" : "Latest words"}
              </p>
              {previous && (
                <p className="mt-1 truncate text-[11px] leading-4 text-faint">
                  {previous.speaker && <span className="font-semibold text-brass">{previous.speaker}: </span>}
                  {previous.text}
                </p>
              )}
              <p className="mt-0.5 text-[12px] leading-5 text-soft">
                {words ? (
                  <>
                    {!interim && latest?.speaker && <span className="font-semibold text-brass">{latest.speaker}: </span>}
                    {words}
                  </>
                ) : (
                  "Words will show here as the room speaks."
                )}
              </p>
              <button
                type="button"
                onClick={() => navigate("/float")}
                className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-medium text-accent hover:text-ink"
              >
                Pin this pill above your other apps
                <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
