import { AbsoluteFill } from "remotion";
import { Eyebrow, SceneShell } from "../components/SceneShell";
import { Shot, Spot } from "../components/Shot";
import { ParticleField } from "../components/ParticleField";
import { pullBack, pushIn, useGsapTimeline, useLayoutInfo } from "../lib/motion";import { fontSans, fontSerif, theme } from "../theme";

const CHIPS = ["Search", "Filter", "Revisit"];

export function Library() {
  const { vertical } = useLayoutInfo();
  const host = useGsapTimeline((timeline, root) => {
    const eyebrow = root.querySelector("[data-eyebrow]");
    const heading = root.querySelector("[data-heading]");
    const body = root.querySelector("[data-body]");
    const chips = root.querySelectorAll("[data-chip]");
    const frame = root.querySelector("[data-frame]");
    const camera = root.querySelector("[data-camera]");

    timeline
      .fromTo(eyebrow, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, 0.3)
      .fromTo(heading, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1.1, ease: "power3.out" }, 0.65)
      .fromTo(body, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.9, ease: "power2.out" }, 1.4)
      .fromTo(
        chips,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.7, stagger: 0.16, ease: "power2.out" },
        2.2,
      )
      .fromTo(
        frame,
        { opacity: 0, y: 70 },
        { opacity: 1, y: 0, duration: 1.4, ease: "power3.out" },
        0.6,
      );

    pushIn(timeline, camera, { x: 0.55, y: 0.5, scale: vertical ? 1.25 : 1.12 }, 7.4);
    pullBack(timeline, camera, 13.1);

    pushIn(timeline, camera, { x: 0.55, y: vertical ? 0.45 : 0.42, scale: vertical ? 1.25 : 1.25 }, 13.8);
    pullBack(timeline, camera, 20.9);

    timeline.to(root, { opacity: 0, duration: 0.9, ease: "power2.in" }, 23);
  });

  return (
    <SceneShell bg={theme.greenDeep} tone="dark">
      <AbsoluteFill style={{ background: "radial-gradient(80% 75% at 70% 30%, #144130 0%, #0A261D 50%, #061611 100%)" }} />
      <ParticleField tone="dark" density={0.85} />
      <div
        ref={host}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: vertical ? "column" : "row",
          alignItems: vertical ? "stretch" : "center",
          justifyContent: vertical ? "center" : "flex-start",
          gap: vertical ? 40 : 68,
          padding: vertical ? "108px 60px 76px" : "94px 100px",
        }}
      >
        <div
          style={{
            flex: vertical ? "0 0 auto" : "0 0 36%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div data-eyebrow>
            <Eyebrow color="rgba(220,234,217,0.5)" size={vertical ? 17 : 19}>
              03 / Find
            </Eyebrow>
          </div>
          <h2
            data-heading
            style={{
              margin: 0,
              marginTop: vertical ? 30 : 36,
              fontFamily: fontSerif,
              fontWeight: 400,
              fontSize: vertical ? 64 : 74,
              lineHeight: 1.04,
              letterSpacing: "-0.035em",
              color: theme.paper,
            }}
          >
            Everything you have heard.
            <br />
            <span style={{ color: theme.mint }}>One clean library.</span>
          </h2>
          <p
            data-body
            style={{
              margin: 0,
              marginTop: vertical ? 24 : 28,
              fontFamily: fontSans,
              fontSize: vertical ? 24 : 26,
              lineHeight: 1.55,
              color: "rgba(244,242,234,0.62)",
            }}
          >
            Search titles, notes, and the spoken words. Filter by meetings, seminars,
            lectures, or voice notes.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: vertical ? 28 : 34, flexWrap: "wrap" }}>
            {CHIPS.map((chip) => (
              <div
                data-chip
                key={chip}
                style={{
                  padding: "10px 18px",
                  borderRadius: 999,
                  border: "1px solid rgba(220,234,217,0.2)",
                  backgroundColor: "rgba(220,234,217,0.06)",
                  fontFamily: fontSans,
                  fontSize: vertical ? 19 : 20,
                  color: "rgba(244,242,234,0.74)",
                }}
              >
                {chip}
              </div>
            ))}
          </div>
        </div>

        <div
          data-frame
          style={{
            position: "relative",
            flex: vertical ? "0 0 auto" : "1 1 auto",
            width: vertical ? "100%" : "auto",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: vertical ? "4 / 3" : "16 / 9",
            }}
          >
            <Shot
              src="screens/library.png"
              alt="JotBox library with search and session filters"
              aspect={16 / 9}
              frameAspect={vertical ? 4 / 3 : 16 / 9}
              matte="#0A2119"
              radius={vertical ? 18 : 22}
              barHeight={vertical ? 36 : 44}
              style={{ width: "100%", height: "100%" }}
            >
              <Spot id="search" x={0.57} y={0.155} w={0.8} h={0.09} dim="rgba(2,12,9,0.44)" showAt={7.7} hideAt={12.8} />
              <Spot id="rows" x={0.57} y={0.34} w={0.81} h={0.27} dim="rgba(2,12,9,0.44)" showAt={14.1} hideAt={20.6} />
            </Shot>
          </div>
        </div>
      </div>
    </SceneShell>
  );
}
