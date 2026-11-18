import { AbsoluteFill } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { Brand } from "../components/Brand";
import { ParticleField } from "../components/ParticleField";
import { useGsapTimeline, useLayoutInfo } from "../lib/motion";
import { fontSans, fontSerif, theme } from "../theme";

const FEATURES = ["60 minutes free every month", "English and Nigerian Pidgin", "Web and desktop"];

export function Close() {
  const { vertical } = useLayoutInfo();
  const host = useGsapTimeline((timeline, root) => {
    const logo = root.querySelector("[data-logo]");
    const heading = root.querySelector("[data-heading]");
    const sub = root.querySelector("[data-sub]");
    const cta = root.querySelector("[data-cta]");
    const features = root.querySelectorAll("[data-feature]");
    const fade = root.querySelector("[data-fade]");

    timeline
      .fromTo(logo, { opacity: 0, scale: 0.75 }, { opacity: 1, scale: 1, duration: 1.1, ease: "power3.out" }, 0.25)
      .fromTo(heading, { opacity: 0, y: 46 }, { opacity: 1, y: 0, duration: 1.1, ease: "power3.out" }, 0.7)
      .fromTo(sub, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.9, ease: "power2.out" }, 1.35)
      .fromTo(cta, { opacity: 0, y: 26, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.9, ease: "power3.out" }, 2)
      .fromTo(
        features,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.7, stagger: 0.15, ease: "power2.out" },
        2.7,
      )
      .to(fade, { opacity: 1, duration: 1.2, ease: "power2.in" }, 18.4);
  });

  return (
    <SceneShell bg={theme.greenDeep} tone="dark">
      <AbsoluteFill style={{ background: "radial-gradient(75% 65% at 50% 42%, #174936 0%, #0B2A21 48%, #051710 100%)" }} />
      <ParticleField tone="dark" density={vertical ? 1.2 : 1.1} />
      <div
        ref={host}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: vertical ? "0 72px" : "0 120px",
          textAlign: "center",
        }}
      >
        <div data-logo>
          <Brand size={vertical ? 110 : 132} tone="dark" showWord={false} />
        </div>
        <h2
          data-heading
          style={{
            margin: 0,
            marginTop: vertical ? 48 : 56,
            fontFamily: fontSerif,
            fontWeight: 400,
            fontSize: vertical ? 104 : 138,
            lineHeight: 0.98,
            letterSpacing: "-0.04em",
            color: theme.paper,
          }}
        >
          Start a capture.
        </h2>
        <div
          data-sub
          style={{
            marginTop: vertical ? 18 : 20,
            fontFamily: fontSerif,
            fontStyle: "italic",
            fontSize: vertical ? 46 : 54,
            color: theme.mint,
          }}
        >
          No account needed.
        </div>

        <div
          data-cta
          style={{
            marginTop: vertical ? 54 : 62,
            display: "flex",
            alignItems: "center",
            gap: 22,
            padding: vertical ? "20px 26px 20px 34px" : "22px 28px 22px 38px",
            borderRadius: 999,
            backgroundColor: theme.mint,
            color: theme.green,
            boxShadow: "0 30px 80px rgba(3,16,11,0.42)",
          }}
        >
          <span
            style={{
              fontFamily: fontSans,
              fontSize: vertical ? 34 : 38,
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            jotbox.online
          </span>
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: vertical ? 50 : 54,
              height: vertical ? 50 : 54,
              borderRadius: 99,
              backgroundColor: theme.green,
              color: theme.mint,
              fontSize: vertical ? 26 : 28,
            }}
          >
            →
          </span>
        </div>

        <div
          style={{
            marginTop: vertical ? 78 : 88,
            display: "flex",
            flexDirection: vertical ? "column" : "row",
            gap: vertical ? 14 : 26,
          }}
        >
          {FEATURES.map((feature, index) => (
            <div
              data-feature
              key={feature}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontFamily: fontSans,
                fontSize: vertical ? 21 : 22,
                color: "rgba(244,242,234,0.6)",
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 99,
                  backgroundColor: index === 1 ? theme.accent : theme.mint,
                  opacity: 0.8,
                }}
              />
              {feature}
            </div>
          ))}
        </div>
      </div>
      <AbsoluteFill data-fade style={{ backgroundColor: "#04120D", opacity: 0, pointerEvents: "none" }} />
    </SceneShell>
  );
}
