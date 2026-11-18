import { AbsoluteFill } from "remotion";
import { Eyebrow, SceneShell } from "../components/SceneShell";
import { Shot, Spot } from "../components/Shot";
import { pullBack, pushIn, useGsapTimeline, useLayoutInfo } from "../lib/motion";
import { fontSans, fontSerif, theme } from "../theme";

const POINTS = [
  "In the room or on a call",
  "Live captions while people speak",
  "Audio stays on this device",
];

export function Capture() {
  const { vertical } = useLayoutInfo();
  const host = useGsapTimeline((timeline, root) => {
    const eyebrow = root.querySelector("[data-eyebrow]");
    const heading = root.querySelector("[data-heading]");
    const body = root.querySelector("[data-body]");
    const points = root.querySelectorAll("[data-point]");
    const frame = root.querySelector("[data-frame]");
    const setup = root.querySelector("[data-shot-setup]");
    const live = root.querySelector("[data-shot-live]");
    const setupCamera = root.querySelector("[data-shot-setup] [data-camera]");
    const liveCamera = root.querySelector("[data-shot-live] [data-camera]");

    timeline
      .fromTo(eyebrow, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, 0.3)
      .fromTo(heading, { opacity: 0, y: 42 }, { opacity: 1, y: 0, duration: 1.1, ease: "power3.out" }, 0.65)
      .fromTo(body, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1, ease: "power2.out" }, 1.35)
      .fromTo(
        points,
        { opacity: 0, x: -18 },
        { opacity: 1, x: 0, duration: 0.8, stagger: 0.18, ease: "power2.out" },
        2.1,
      )
      .fromTo(
        frame,
        { opacity: 0, y: 54 },
        { opacity: 1, y: 0, duration: 1.2, ease: "power3.out" },
        0.55,
      );

    pushIn(timeline, setupCamera, { x: 0.56, y: 0.42, scale: vertical ? 1.25 : 1.25 }, 3.4);
    pullBack(timeline, setupCamera, 7.9);

    timeline
      .to(setup, { opacity: 0, duration: 1.1, ease: "power1.inOut" }, 8.6)
      .fromTo(live, { opacity: 0 }, { opacity: 1, duration: 1.1, ease: "power1.inOut" }, 8.8);

    pushIn(timeline, liveCamera, { x: vertical ? 0.55 : 0.5, y: vertical ? 0.5 : 0.45, scale: vertical ? 1.25 : 1.38 }, 11.8);
    pullBack(timeline, liveCamera, 15.7);

    pushIn(timeline, liveCamera, { x: vertical ? 0.55 : 0.62, y: vertical ? 0.5 : 0.4, scale: vertical ? 1.25 : 1.38 }, 16.4);
    pullBack(timeline, liveCamera, 21.7);

    timeline.to(root, { opacity: 0, duration: 0.9, ease: "power2.in" }, 28.9);
  });

  return (
    <SceneShell bg={theme.paper} tone="light">
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(80% 90% at 78% 32%, #FFFFFF 0%, #F4F2EA 52%, #EDE7DA 100%)",
        }}
      />
      <div
        ref={host}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: vertical ? "column" : "row",
          alignItems: vertical ? "stretch" : "center",
          justifyContent: vertical ? "center" : "flex-start",
          gap: vertical ? 44 : 70,
          padding: vertical ? "110px 60px 76px" : "92px 100px",
        }}
      >
        <div
          style={{
            flex: vertical ? "0 0 auto" : "0 0 34%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div data-eyebrow>
            <Eyebrow color={theme.inkFaint} size={vertical ? 17 : 19}>
              01 / Listen
            </Eyebrow>
          </div>
          <h2
            data-heading
            style={{
              margin: 0,
              marginTop: vertical ? 34 : 38,
              fontFamily: fontSerif,
              fontWeight: 400,
              fontSize: vertical ? 68 : 78,
              lineHeight: 1.04,
              letterSpacing: "-0.035em",
              color: theme.ink,
            }}
          >
            Start listening.
            <br />
            Keep your hands free.
          </h2>
          <p
            data-body
            style={{
              margin: 0,
              marginTop: vertical ? 26 : 30,
              fontFamily: fontSans,
              fontSize: vertical ? 25 : 27,
              lineHeight: 1.55,
              color: theme.inkSoft,
              maxWidth: 620,
            }}
          >
            Use the mic in the room, or share a Meet, Zoom, or Teams tab. JotBox
            captures the words and writes the notes while you stay in the conversation.
          </p>

          <div
            style={{
              marginTop: vertical ? 34 : 42,
              display: "flex",
              flexDirection: "column",
              gap: vertical ? 14 : 16,
            }}
          >
            {POINTS.map((point, index) => (
              <div
                data-point
                key={point}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  fontFamily: fontSans,
                  fontSize: vertical ? 22 : 24,
                  color: theme.ink,
                }}
              >
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 30,
                    height: 30,
                    borderRadius: 99,
                    backgroundColor: index === 2 ? theme.green : theme.mintSoft,
                    color: index === 2 ? theme.mint : theme.greenMid,
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                {point}
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
            <div data-shot-setup style={{ position: "absolute", inset: 0 }}>
              <Shot
                src="screens/capture-setup.png"
                alt="JotBox capture setup"
                aspect={16 / 9}
                frameAspect={vertical ? 4 / 3 : 16 / 9}
                matte="#F4F2EA"
                radius={vertical ? 18 : 22}
                barHeight={vertical ? 36 : 44}
                style={{ width: "100%", height: "100%" }}
              >
                <Spot id="setup-cards" x={0.72} y={0.355} w={0.5} h={0.22} dim="rgba(10,26,20,0.42)" showAt={3.7} hideAt={7.6} />
              </Shot>
            </div>
            <div data-shot-live style={{ position: "absolute", inset: 0 }}>
              <Shot
                src="screens/capture-live.png"
                alt="JotBox listening with live notes and transcript"
                aspect={1440 / 1100}
                frameAspect={vertical ? 4 / 3 : 16 / 9}
                matte="#F4F2EA"
                radius={vertical ? 18 : 22}
                barHeight={vertical ? 36 : 44}
                style={{ width: "100%", height: "100%" }}
              >
                <Spot id="live-notes" x={0.4} y={0.47} w={0.37} h={0.66} dim="rgba(10,26,20,0.42)" showAt={12.1} hideAt={15.4} />
                <Spot id="live-transcript" x={0.78} y={0.32} w={0.38} h={0.4} dim="rgba(10,26,20,0.42)" showAt={16.7} hideAt={21.4} />
              </Shot>
            </div>
          </div>
        </div>
      </div>
    </SceneShell>
  );
}
