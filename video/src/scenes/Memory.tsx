import { AbsoluteFill } from "remotion";
import { Eyebrow, SceneShell } from "../components/SceneShell";
import { Shot, Spot } from "../components/Shot";
import { pullBack, pushIn, useGsapTimeline, useLayoutInfo } from "../lib/motion";
import { fontSans, fontSerif, theme } from "../theme";

export function Memory() {
  const { vertical } = useLayoutInfo();
  const host = useGsapTimeline((timeline, root) => {
    const eyebrow = root.querySelector("[data-eyebrow]");
    const heading = root.querySelector("[data-heading]");
    const body = root.querySelector("[data-body]");
    const frame = root.querySelector("[data-frame]");
    const badge = root.querySelector("[data-badge]");
    const camera = root.querySelector("[data-camera]");

    timeline
      .fromTo(eyebrow, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, 0.3)
      .fromTo(heading, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1.1, ease: "power3.out" }, 0.65)
      .fromTo(body, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.9, ease: "power2.out" }, 1.4)
      .fromTo(
        frame,
        { opacity: 0, y: 60 },
        { opacity: 1, y: 0, duration: 1.3, ease: "power3.out" },
        0.6,
      )
      .fromTo(
        badge,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.9, ease: "power2.out" },
        7.6,
      );

    pushIn(timeline, camera, { x: vertical ? 0.55 : 0.42, y: 0.5, scale: vertical ? 1.25 : 1.2 }, 9.4);
    pullBack(timeline, camera, 14.7);

    pushIn(timeline, camera, { x: 0.55, y: vertical ? 0.45 : 0.42, scale: vertical ? 1.25 : 1.3 }, 15.4);
    pullBack(timeline, camera, 21.5);

    timeline.to(root, { opacity: 0, duration: 0.9, ease: "power2.in" }, 23);
  });

  return (
    <SceneShell bg={theme.paper} tone="light">
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(80% 80% at 24% 26%, #FFFFFF 0%, #F5F2EA 48%, #E8E1D2 100%)",
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
          gap: vertical ? 40 : 64,
          padding: vertical ? "104px 60px 76px" : "90px 100px",
        }}
      >
        <div
          style={{
            flex: vertical ? "0 0 auto" : "0 0 35%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div data-eyebrow>
            <Eyebrow color={theme.inkFaint} size={vertical ? 17 : 19}>
              04 / Remember
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
              color: theme.ink,
            }}
          >
            What the organisation knows.
          </h2>
          <p
            data-body
            style={{
              margin: 0,
              marginTop: vertical ? 24 : 28,
              fontFamily: fontSans,
              fontSize: vertical ? 24 : 26,
              lineHeight: 1.55,
              color: theme.inkSoft,
            }}
          >
            Ask a question across months of meetings. Every answer points back to the
            room it came from, and only the meetings you can open are used.
          </p>

          <div
            data-badge
            style={{
              marginTop: vertical ? 28 : 34,
              padding: vertical ? "20px 22px" : "22px 24px",
              borderRadius: 20,
              backgroundColor: theme.green,
              color: theme.mint,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              maxWidth: 560,
            }}
          >
            <div
              style={{
                fontFamily: fontSans,
                fontSize: vertical ? 20 : 21,
                fontWeight: 700,
                letterSpacing: "0.02em",
              }}
            >
              English and Nigerian Pidgin
            </div>
            <div
              style={{
                fontFamily: fontSans,
                fontSize: vertical ? 18 : 19,
                color: "rgba(220,234,217,0.7)",
                lineHeight: 1.45,
              }}
            >
              Kept the way people actually speak, not translated into corporate English.
            </div>
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
              src="screens/memory.png"
              alt="JotBox organisation memory chat citing past meetings"
              aspect={1440 / 1000}
              frameAspect={vertical ? 4 / 3 : 16 / 9}
              matte="#F6F3EB"
              radius={vertical ? 18 : 22}
              barHeight={vertical ? 36 : 44}
              style={{ width: "100%", height: "100%" }}
            >
              <Spot id="answer" x={0.47} y={0.37} w={0.5} h={0.22} dim="rgba(10,26,20,0.42)" showAt={9.7} hideAt={14.4} />
              <Spot id="private" x={0.85} y={0.37} w={0.23} h={0.32} dim="rgba(10,26,20,0.42)" showAt={15.7} hideAt={21.2} />
            </Shot>
          </div>
        </div>
      </div>
    </SceneShell>
  );
}
