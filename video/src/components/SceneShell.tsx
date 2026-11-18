import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "../theme";

export function SceneShell({
  bg,
  tone = "light",
  children,
}: {
  bg: string;
  tone?: "light" | "dark";
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ backgroundColor: bg, opacity }}>
      {children}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            tone === "dark"
              ? "radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.42) 100%)"
              : "radial-gradient(130% 100% at 50% 40%, rgba(255,255,255,0) 55%, rgba(89,74,46,0.10) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            tone === "dark"
              ? "linear-gradient(180deg, rgba(4,14,11,0.45) 0%, rgba(4,14,11,0) 18%, rgba(4,14,11,0) 82%, rgba(4,14,11,0.5) 100%)"
              : "linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 16%, rgba(255,255,255,0) 84%, rgba(89,74,46,0.06) 100%)",
        }}
      />
    </AbsoluteFill>
  );
}

export function Eyebrow({
  children,
  color = theme.inkFaint,
  size = 22,
}: {
  children: ReactNode;
  color?: string;
  size?: number;
}) {
  return (
    <div
      style={{
        color,
        fontSize: size,
        fontWeight: 600,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        lineHeight: 1,
      }}
    >
      {children}
    </div>
  );
}
