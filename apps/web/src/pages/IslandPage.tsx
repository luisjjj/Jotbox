import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowUpRight, ChevronDown, ChevronUp, Loader2, Pause, Play, Square } from "lucide-react";
import { desktopBridge, type IslandState } from "@/lib/desktop";
import { formatClock } from "@/lib/format";

const IDLE: IslandState = {
  status: "idle",
  elapsed: 0,
  title: "",
  interim: "",
  lines: [],
  captions: false,
  kind: "meeting",
  level: 0,
  at: 0,
};

const PREVIEW: IslandState = {
  status: "recording",
  elapsed: 521,
  title: "Friday payout review",
  interim: "",
  lines: [
    { speaker: "Ada", text: "The bank acknowledged the file late." },
    { speaker: "Chinedu", text: "Make we pause the same-day promise until the cutoff holds." },
  ],
  captions: true,
  kind: "meeting",
  level: 0.62,
  at: 0,
};

// The island window has no engine of its own, so the room level arrives over
// IPC a few times a second and these bars smooth it into motion.
function IslandBars({
  active,
  level,
  bars,
}: {
  active: boolean;
  level: number;
  bars: number;
}) {
  const refs = useRef<Array<HTMLSpanElement | null>>([]);
  const smooth = useRef(0);
  const target = useRef(level);
  target.current = level;
  const factors = useMemo(
    () => Array.from({ length: bars }, (_, index) => 0.34 + 0.66 * Math.abs(Math.sin((index + 1) * 1.27))),
    [bars],
  );

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      smooth.current += ((active ? target.current : 0) - smooth.current) * 0.18;
      const now = performance.now();
      refs.current.forEach((element, index) => {
        if (!element) return;
        const wobble = 0.62 + 0.38 * Math.sin(now / 270 + index * 0.55);
        const amount = active
          ? Math.max(0.07, Math.min(1, 0.09 + smooth.current * factors[index] * (0.5 + wobble)))
          : 0.07;
        element.style.transform = `scaleY(${amount.toFixed(3)})`;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, factors]);

  return (
    <div className="flex h-5 flex-none items-center justify-center gap-[2px]" aria-hidden="true">
      {factors.map((_, index) => (
        <span
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          className={clsx(
            "h-4 w-[2px] origin-center rounded-full bg-[#dfe9dc] will-change-transform",
            !active && "opacity-25",
          )}
        />
      ))}
    </div>
  );
}

export default function IslandPage() {
  const params = new URLSearchParams(window.location.search);
  const preview = params.has("preview");
  const bridge = desktopBridge();
  const [state, setState] = useState<IslandState>(preview ? PREVIEW : IDLE);
  const [expanded, setExpanded] = useState(preview && params.get("open") === "1");

  useEffect(() => {
    document.documentElement.classList.add("island-surface");
    return () => document.documentElement.classList.remove("island-surface");
  }, []);

  useEffect(() => {
    if (!bridge) return;
    bridge.setInteractive(false);
    return bridge.onState(setState);
  }, [bridge]);

  useEffect(() => {
    if (state.status === "idle") setExpanded(false);
  }, [state.status]);

  const paused = state.status === "paused";
  const processing = state.status === "processing";
  const active = state.status !== "idle";
  const latest = state.lines[state.lines.length - 1];
  const previous = state.lines[state.lines.length - 2];
  const words = state.interim || latest?.text || "";
  const statusLabel = processing ? "Writing notes" : paused ? "Paused" : "Listening";

  const setHover = (next: boolean) => {
    setExpanded(next);
    bridge?.setInteractive(next);
  };

  if (!active && !preview) {
    return <div className="h-screen w-screen bg-transparent" />;
  }

  return (
    <div
      className="flex h-screen w-screen items-start justify-center overflow-hidden bg-transparent px-3 pt-2"
      data-island-root
      data-island-status={state.status}
    >
      {preview && (
        <div
          className="pointer-events-none fixed inset-0 -z-10"
          style={{
            background:
              "radial-gradient(120% 120% at 20% 0%, #24322b 0%, #111815 55%, #0a0f0c 100%)",
          }}
        />
      )}

      <div
        role="region"
        aria-label="JotBox island"
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        className={clsx(
          "island flex flex-col overflow-hidden border border-white/10 shadow-float",
          "transition-[width,border-radius,padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          expanded ? "is-open w-[424px] rounded-[1.4rem] px-3.5 py-3" : "w-[338px] rounded-full px-3 py-1.5",
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={clsx("flex-none rounded-full", paused ? "h-2 w-2 bg-[#75847a]" : "live-dot !h-2 !w-2")}
            aria-hidden="true"
          />
          <span className="flex-none text-[14px] font-semibold tabular-nums tracking-[-0.02em] text-[#f5f1e4]">
            {formatClock(state.elapsed)}
          </span>
          <IslandBars active={!paused && !processing} level={state.level} bars={expanded ? 9 : 7} />
          <div className="min-w-0 flex-1">
            {expanded ? (
              <>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#a6b5a8]">
                  {statusLabel}
                </p>
                <p className="truncate text-[13px] leading-4 text-[#e3ebe1]">{state.title || "Untitled session"}</p>
              </>
            ) : (
              <p className="truncate text-[13px] leading-4 text-[#d8e2d8]">
                {processing ? statusLabel : state.title || "Untitled session"}
              </p>
            )}
          </div>
          <button
            type="button"
            className="island-control grid h-7 w-7 flex-none place-items-center rounded-full bg-white/[0.08] text-[#d8e2d8] hover:bg-white/[0.14] hover:text-[#f5f1e4]"
            onClick={(event) => {
              event.stopPropagation();
              const next = !expanded;
              setExpanded(next);
              bridge?.setInteractive(true);
            }}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse the island" : "Expand the island"}
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        <div className="island-body">
          <div>
            <div className="mt-2.5 space-y-1 border-t border-white/10 pt-2.5">
              {previous && (
                <p className="truncate text-[12.5px] leading-4 text-[#96a89b]">
                  {previous.speaker && <span className="font-semibold text-[#c9b48a]">{previous.speaker}: </span>}
                  {previous.text}
                </p>
              )}
              <p className="line-clamp-3 text-[13.5px] leading-5 text-[#eef2e7]">
                {words ? (
                  <>
                    {!state.interim && latest?.speaker && (
                      <span className="font-semibold text-[#dcc69b]">{latest.speaker}: </span>
                    )}
                    {words}
                  </>
                ) : processing ? (
                  "The words are in. JotBox is shaping the summary, points and actions."
                ) : (
                  "Words will show here as the room speaks."
                )}
              </p>
            </div>

            <div className="mt-2.5 flex items-center gap-1.5 border-t border-white/10 pt-2.5">
              {processing ? (
                <>
                  <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#c9d5c9]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Writing the notes
                  </span>
                  <span className="flex-1" />
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="island-control flex items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 py-1.5 text-[12px] font-medium text-[#e3ebe1] hover:bg-white/[0.14]"
                    onClick={() => bridge?.command(paused ? "resume" : "pause")}
                  >
                    {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                    {paused ? "Resume" : "Pause"}
                  </button>
                  <button
                    type="button"
                    className="island-control flex items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 py-1.5 text-[12px] font-medium text-[#f0c9c3] hover:bg-white/[0.14]"
                    onClick={() => bridge?.command("stop")}
                  >
                    <Square className="h-3 w-3 fill-current" />
                    Stop
                  </button>
                  <span className="flex-1" />
                </>
              )}
              <button
                type="button"
                className="island-control flex items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 py-1.5 text-[12px] font-medium text-[#d8e2d8] hover:bg-white/[0.14]"
                onClick={() => bridge?.openMain()}
                title="Open JotBox"
              >
                Open JotBox
                <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
