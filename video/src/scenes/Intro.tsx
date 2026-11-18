import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Eyebrow, SceneShell } from "../components/SceneShell";
import { Brand } from "../components/Brand";
import { ParticleField } from "../components/ParticleField";
import { useGsapTimeline, useLayoutInfo } from "../lib/motion";
import { fontSans, fontSerif, theme } from "../theme";

export function Intro() {
  const host = useGsapTimeline((timeline, root) => {
    const logo = root.querySelector("[data-logo]");
    const word = root.querySelector("[data-word]");
    const line1 = root.querySelector("[data-line1]");
    const line2 = root.querySelector("[data-line2]");
    const tag = root.querySelector("[data-tag]");
    const foot = root.querySelector("[data-foot]");
    const content = root.querySelector("[data-content]");

    timeline
      .fromTo(
        logo,
        { opacity: 0, scale: 0.7, filter: "blur(16px)" },
        { opacity: 1, scale: 1, filter: "blur(0px)", duration: 1.5, ease: "power3.out" },
        0.15,
      )
      .fromTo(
        word,
        { opacity: 0, y: 26 },
        { opacity: 1, y: 0, duration: 0.9, ease: "power3.out" },
        0.6,
      )
      .fromTo(
        line1,
        { opacity: 0, y: 70, filter: "blur(10px)" },
        { opacity: 1, y: 0, filter: "blur(0px)", duration: 1.25, ease: "power3.out" },
        1.05,
      )
      .fromTo(
        line2,
        { opacity: 0, y: 70, filter: "blur(10px)" },
        { opacity: 1, y: 0, filter: "blur(0px)", duration: 1.25, ease: "power3.out" },
        1.5,
      )
      .fromTo(tag, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 1, ease: "power2.out" }, 2.35)
      .fromTo(foot, { opacity: 0 }, { opacity: 1, duration: 1.2, ease: "power2.out" }, 3.1)
      .to(content, { opacity: 0, y: -34, duration: 0.9, ease: "power2.in" }, 6.8);
  });

  const { vertical } = useLayoutInfo();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drift = Math.sin(frame / fps / 2.2) * (vertical ? 8 : 12);

  return (
    <SceneShell bg={theme.greenDeep} tone="dark">
      <AbsoluteFill style={{ background: "radial-gradient(70% 60% at 50% 40%, #164434 0%, #0B2A21 45%, #061913 100%)" }} />
      <ParticleField tone="dark" density={vertical ? 1.15 : 1} />
      <div
        ref={host}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: vertical ? "0 72px" : "0 140px",
          textAlign: "center",
        }}
      >
        <div
          data-content
          style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
        >
          <div data-logo style={{ transform: `translateY(${drift}px)` }}>
            <Brand size={vertical ? 104 : 128} tone="dark" showWord={false} />
          </div>
          <div data-word style={{ marginTop: vertical ? 26 : 34 }}>
            <div
              style={{
                fontFamily: fontSerif,
                fontSize: vertical ? 44 : 52,
                color: theme.mint,
                letterSpacing: "0.02em",
              }}
            >
              JotBox
            </div>
          </div>

          <h1
            style={{
              margin: 0,
              marginTop: vertical ? 64 : 78,
              fontFamily: fontSerif,
              fontWeight: 400,
              fontSize: vertical ? 92 : 128,
              lineHeight: 0.99,
              letterSpacing: "-0.035em",
              color: theme.paper,
            }}
          >
            <span data-line1 style={{ display: "block" }}>
              The notes are written
            </span>
            <span
              data-line2
              style={{ display: "block", fontStyle: "italic", color: theme.mint }}
            >
              while you listen.
            </span>
          </h1>

          <p
            data-tag
            style={{
              margin: 0,
              marginTop: vertical ? 42 : 48,
              maxWidth: vertical ? 820 : 900,
              fontFamily: fontSans,
              fontSize: vertical ? 28 : 30,
              lineHeight: 1.55,
              color: "rgba(244,242,234,0.68)",
            }}
          >
            Meetings, seminars, lectures, and calls. JotBox keeps the spoken words and
            writes the notes while you stay present.
          </p>

          <div
            data-foot
            style={{
              marginTop: vertical ? 84 : 96,
              display: "flex",
              alignItems: "center",
              gap: 22,
            }}
          >
            <span style={{ width: 44, height: 1, backgroundColor: "rgba(220,234,217,0.35)" }} />
            <Eyebrow color="rgba(220,234,217,0.5)" size={vertical ? 17 : 18}>
              Built for the room you are in
            </Eyebrow>
            <span style={{ width: 44, height: 1, backgroundColor: "rgba(220,234,217,0.35)" }} />
          </div>
        </div>
      </div>
    </SceneShell>
  );
}
