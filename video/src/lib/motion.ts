import { useLayoutEffect, useRef } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import gsap from "gsap";

// Build a paused GSAP timeline on mount, then seek it to the Remotion frame.
// This keeps every render deterministic while still using real GSAP easing.
export function useGsapTimeline(build: (timeline: gsap.core.Timeline, host: HTMLDivElement) => void) {
  const host = useRef<HTMLDivElement>(null);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const buildRef = useRef(build);
  buildRef.current = build;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  useLayoutEffect(() => {
    if (!host.current) return;
    const instance = gsap.timeline({ paused: true });
    buildRef.current(instance, host.current);
    instance.time(0, false);
    timeline.current = instance;
    return () => {
      instance.kill();
      timeline.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const instance = timeline.current;
    if (!instance) return;
    instance.time(Math.min(frame / fps, instance.duration()), false);
  }, [frame, fps]);

  return host;
}

// Push the camera toward a point in the image (fractions of width/height) so
// that point ends up centred in the card at the requested scale.
export function pushIn(
  timeline: gsap.core.Timeline,
  camera: Element | null,
  target: { x: number; y: number; scale: number },
  at: number,
  duration = 1.6,
) {
  if (!camera) return timeline;
  const { x, y, scale } = target;
  const originX = (0.5 - scale * x) / (1 - scale);
  const originY = (0.5 - scale * y) / (1 - scale);
  return timeline.to(
    camera,
    {
      scale,
      transformOrigin: `${originX * 100}% ${originY * 100}%`,
      duration,
      ease: "power2.inOut",
    },
    at,
  );
}

export function pullBack(timeline: gsap.core.Timeline, camera: Element | null, at: number, duration = 1.4) {
  if (!camera) return timeline;
  return timeline.to(
    camera,
    { scale: 1, transformOrigin: "50% 50%", duration, ease: "power2.inOut" },
    at,
  );
}

export function useLayoutInfo() {
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  return {
    width,
    height,
    vertical,
    margin: vertical ? 72 : 110,
  };
}
