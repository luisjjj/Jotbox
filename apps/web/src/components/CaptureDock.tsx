import { Pause, Play, Square, ArrowUpRight } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useEngine } from "@/engine/SessionEngine";
import { formatClock } from "@/lib/format";

export function CaptureDock() {
  const { status, elapsed, title, pause, resume, stop } = useEngine();
  const location = useLocation();
  const navigate = useNavigate();

  const visible =
    (status === "recording" || status === "paused") &&
    location.pathname !== "/listen" &&
    location.pathname !== "/float";
  if (!visible) return null;

  const paused = status === "paused";

  const handleStop = () => {
    toast.success("Writing your notes…", { id: "writing-notes" });
    void stop();
  };

  return (
    <div className="fixed bottom-[calc(4.9rem+env(safe-area-inset-bottom))] left-3 right-3 z-40 lg:bottom-6 lg:left-auto lg:right-7 lg:w-[390px]">
      <div className="fade-up flex items-center gap-2.5 rounded-2xl border border-line bg-raised/95 p-2 pl-3 shadow-float backdrop-blur-md">
        <span className={paused ? "h-2 w-2 flex-none rounded-full bg-faint" : "live-dot"} />
        <button
          type="button"
          onClick={() => navigate("/listen")}
          className="min-w-0 flex-1 rounded-lg py-1 text-left"
          aria-label="Open the live studio"
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
      </div>
    </div>
  );
}
