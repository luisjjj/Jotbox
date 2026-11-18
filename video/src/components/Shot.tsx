import type { CSSProperties, ReactNode } from "react";
import { Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { fontSans, theme } from "../theme";

// The screenshot is laid out at its native aspect ratio inside the card, so
// nothing is cropped or stretched. The camera box can be transformed by GSAP
// for deliberate push-ins, and spotlight overlays are positioned in image
// coordinates (percentages of the image, not the card).
export function Shot({
  src,
  alt,
  aspect = 16 / 9,
  frameAspect = 16 / 9,
  matte = "#F4F2EA",
  chrome = true,
  radius = 22,
  barHeight = 44,
  style,
  children,
}: {
  src: string;
  alt: string;
  aspect?: number;
  frameAspect?: number;
  matte?: string;
  chrome?: boolean;
  radius?: number;
  barHeight?: number;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const imageWider = aspect >= frameAspect;
  const pct = (value: number) => `${value * 100}%`;

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: radius,
        backgroundColor: "#101612",
        border: "1px solid rgba(220,234,217,0.16)",
        boxShadow: "0 44px 120px rgba(3,16,11,0.35), 0 8px 24px rgba(3,16,11,0.18)",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {chrome ? (
        <div
          style={{
            height: barHeight,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: `0 ${barHeight * 0.4}px`,
            backgroundColor: "#151C17",
            borderBottom: "1px solid rgba(220,234,217,0.10)",
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            {["#55705F", "#55705F", "#55705F"].map((color, index) => (
              <span
                key={index}
                style={{
                  width: barHeight * 0.19,
                  height: barHeight * 0.19,
                  borderRadius: 99,
                  backgroundColor: color,
                  opacity: 0.75,
                }}
              />
            ))}
          </div>
          <div
            style={{
              flex: 1,
              height: barHeight * 0.6,
              marginLeft: 8,
              marginRight: 8,
              borderRadius: 99,
              backgroundColor: "rgba(244,242,234,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: fontSans,
              fontSize: barHeight * 0.27,
              color: "rgba(244,242,234,0.48)",
              letterSpacing: "0.02em",
            }}
          >
            jotbox.online
          </div>
          <div style={{ width: barHeight * 0.9 }} />
        </div>
      ) : null}
      <div
        style={{
          position: "relative",
          flex: 1,
          overflow: "hidden",
          backgroundColor: matte,
        }}
      >
        <div
          data-camera
          style={{
            position: "absolute",
            inset: 0,
            margin: "auto",
            width: imageWider ? "100%" : pct(aspect / frameAspect),
            height: imageWider ? pct(frameAspect / aspect) : "100%",
            transformOrigin: "50% 50%",
          }}
        >
          <Img
            src={staticFile(src)}
            alt={alt}
            style={{
              display: "block",
              width: "100%",
              height: "100%",
            }}
          />
          {children}
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "linear-gradient(to right, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0) 5%, rgba(0,0,0,0) 95%, rgba(0,0,0,0.34) 100%), linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0) 4.5%, rgba(0,0,0,0) 96%, rgba(0,0,0,0.3) 100%)",
          }}
        />
      </div>
    </div>
  );
}

// A dimming spotlight over one region of the screenshot. Coordinates are the
// centre and size in percent of the image. The huge box shadow darkens the
// rest of the frame; it lives inside the camera box so it tracks push-ins.
// Visibility is derived from the current frame so it stays deterministic
// during scrubbing and parallel renders.
export function Spot({
  id,
  x,
  y,
  w,
  h,
  radius = 16,
  dim = "rgba(5,20,14,0.5)",
  showAt = 0,
  hideAt,
  style,
}: {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  radius?: number;
  dim?: string;
  showAt?: number;
  hideAt?: number;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = Math.min(1, Math.max(0, (frame - showAt * fps) / (0.55 * fps)));
  const fadeOut =
    hideAt === undefined ? 1 : Math.min(1, Math.max(0, (hideAt * fps - frame) / (0.45 * fps)));

  return (
    <div
      data-spot={id}
      style={{
        position: "absolute",
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: `${w * 100}%`,
        height: `${h * 100}%`,
        transform: "translate(-50%, -50%)",
        borderRadius: radius,
        border: "2px solid rgba(199,167,107,0.95)",
        boxShadow: `0 0 0 200vmax ${dim}, 0 0 46px rgba(199,167,107,0.4)`,
        opacity: Math.min(fadeIn, fadeOut),
        pointerEvents: "none",
        ...style,
      }}
    />
  );
}
