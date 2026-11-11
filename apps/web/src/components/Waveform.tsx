import { useEffect, useMemo, useRef } from "react";
import clsx from "clsx";
import { useEngine } from "@/engine/SessionEngine";

interface WaveformProps {
  active: boolean;
  bars?: number;
  className?: string;
  barClassName?: string;
  tone?: "accent" | "light";
}

export function Waveform({ active, bars = 36, className, barClassName, tone = "accent" }: WaveformProps) {
  const { getLevel } = useEngine();
  const levelRef = useRef(getLevel);
  levelRef.current = getLevel;
  const refs = useRef<Array<HTMLSpanElement | null>>([]);
  const factors = useMemo(
    () => Array.from({ length: bars }, (_, index) => 0.34 + 0.66 * Math.abs(Math.sin((index + 1) * 1.27))),
    [bars],
  );

  useEffect(() => {
    let frame = 0;
    let smooth = 0;
    const tick = () => {
      const level = active ? levelRef.current() : 0;
      smooth += (level - smooth) * 0.22;
      const now = performance.now();
      refs.current.forEach((element, index) => {
        if (!element) return;
        const wobble = 0.62 + 0.38 * Math.sin(now / 270 + index * 0.55);
        const amount = active ? Math.max(0.07, Math.min(1, 0.09 + smooth * factors[index] * (0.5 + wobble))) : 0.07;
        element.style.transform = `scaleY(${amount.toFixed(3)})`;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, factors]);

  return (
    <div className={clsx("flex h-12 items-center justify-center gap-[3px]", className)} aria-hidden="true">
      {factors.map((_, index) => (
        <span
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          className={clsx(
            "h-11 w-[2px] origin-center rounded-full will-change-transform",
            barClassName,
            tone === "light" ? "bg-[#dfe9dc]" : "bg-accent",
            !active && "opacity-25",
          )}
        />
      ))}
    </div>
  );
}

export function StaticBars({ className, heights }: { className?: string; heights?: number[] }) {
  const values = heights ?? [0.3, 0.55, 0.85, 0.45, 0.7, 1, 0.6, 0.35, 0.8, 0.5, 0.25, 0.65];
  return (
    <div className={clsx("flex items-center gap-[3px]", className)} aria-hidden="true">
      {values.map((height, index) => (
        <span
          key={index}
          className="w-[3px] rounded-full bg-current opacity-80"
          style={{ height: `${Math.round(height * 100)}%` }}
        />
      ))}
    </div>
  );
}
