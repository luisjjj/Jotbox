import { useEffect, useRef } from "react";
import clsx from "clsx";
import { formatClock } from "@/lib/format";
import type { TranscriptLine } from "@/lib/types";

interface TranscriptViewProps {
  lines: TranscriptLine[];
  interim?: string;
  live?: boolean;
  className?: string;
  onSeek?: (seconds: number) => void;
  emptyLabel?: string;
}

export function TranscriptView({
  lines,
  interim,
  live = false,
  className,
  onSeek,
  emptyLabel = "No spoken words for this session yet.",
}: TranscriptViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);

  useEffect(() => {
    if (!live || !stuckRef.current) return;
    const box = boxRef.current;
    if (!box) return;
    const frame = requestAnimationFrame(() => {
      box.scrollTop = box.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [lines, interim, live]);

  if (!lines.length && !interim) {
    return (
      <div className={clsx("grid min-h-[9rem] place-items-center px-4 text-center", className)}>
        <p className="max-w-[15rem] text-[15px] leading-6 text-faint">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      onScroll={(event) => {
        const element = event.currentTarget;
        stuckRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 56;
      }}
      className={clsx("scroll-quiet overflow-y-auto", className)}
      aria-live={live ? "polite" : "off"}
      aria-label="Spoken words"
    >
      {lines.map((line, index) => {
        const previous = lines[index - 1];
        const showSpeaker = Boolean(line.speaker) && line.speaker !== previous?.speaker;
        return (
          <div key={line.id} className="transcript-line">
            <div className="transcript-time">
              {onSeek && line.at > 0 ? (
                <button
                  type="button"
                  onClick={() => onSeek(line.at)}
                  className="-ml-1 rounded px-1 py-0.5 text-left text-faint transition-colors hover:bg-raised-2 hover:text-ink"
                  aria-label={`Play from ${formatClock(line.at)}`}
                >
                  {formatClock(line.at)}
                </button>
              ) : line.at > 0 ? (
                formatClock(line.at)
              ) : (
                <span className="opacity-0">—</span>
              )}
            </div>
            <div className="min-w-0">
              {showSpeaker && <div className="transcript-speaker mb-0.5">{line.speaker}</div>}
              <p className="text-[15.5px] leading-[1.6] text-soft">{line.text}</p>
            </div>
          </div>
        );
      })}
      {interim && (
        <div className="transcript-line">
          <div className="transcript-time">
            <span className="live-dot" />
          </div>
          <p className="pt-0.5 text-[15.5px] italic leading-[1.6] text-faint">{interim}</p>
        </div>
      )}
    </div>
  );
}
