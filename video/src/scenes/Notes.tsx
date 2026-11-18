import { AbsoluteFill } from "remotion";
import { Eyebrow, SceneShell } from "../components/SceneShell";
import { Shot, Spot } from "../components/Shot";
import { pullBack, pushIn, useGsapTimeline, useLayoutInfo } from "../lib/motion";
import { fontSans, fontSerif, theme } from "../theme";

const ITEMS = [
  { title: "Summary you can send", body: "The room in a few clean lines." },
  { title: "Key points", body: "The decisions and the numbers." },
  { title: "Actions with owners", body: "Who said they would do what." },
];

export function Notes() {
  const { vertical } = useLayoutInfo();
  const host = useGsapTimeline((timeline, root) => {
    const eyebrow = root.querySelector("[data-eyebrow]");
    const heading = root.querySelector("[data-heading]");
    const body = root.querySelector("[data-body]");
    const items = root.querySelectorAll("[data-item]");
    const frame = root.querySelector("[data-frame]");
    const camera = root.querySelector("[data-camera]");

    timeline
      .fromTo(eyebrow, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, 0.3)
      .fromTo(heading, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1.1, ease: "power3.out" }, 0.7)
      .fromTo(body, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.9, ease: "power2.out" }, 1.45)
      .fromTo(frame, { opacity: 0, y: 56 }, { opacity: 1, y: 0, duration: 1.2, ease: "power3.out" }, 0.6)
      .fromTo(
        items,
        { opacity: 0, x: -18 },
        { opacity: 1, x: 0, duration: 0.8, stagger: 0.22, ease: "power2.out" },
        1.9,
      );

    pushIn(timeline, camera, { x: 0.5, y: 0.5, scale: vertical ? 1.25 : 1.25 }, 4.4);
    pullBack(timeline, camera, 9.2);

    pushIn(timeline, camera, { x: 0.5, y: 0.5, scale: vertical ? 1.27 : 1.3 }, 10.1);
    pullBack(timeline, camera, 14.5);

    pushIn(timeline, camera, { x: 0.5, y: vertical ? 0.55 : 0.6, scale: vertical ? 1.27 : 1.3 }, 15.3);
    pullBack(timeline, camera, 22.9);

    timeline.to(root, { opacity: 0, duration: 0.9, ease: "power2.in" }, 27);
  });

  return (
    <SceneShell bg={theme.paperSoft} tone="light">
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(90% 80% at 70% 30%, #FBF9F3 0%, #EDE9DF 55%, #E3DCCB 100%)",
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
          gap: vertical ? 40 : 70,
          padding: vertical ? "104px 60px 76px" : "86px 100px",
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
              02 / Read
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
            The room goes quiet.
            <br />
            The notes are ready.
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
            Written from the spoken words and your jottings. A summary, the key points,
            and every action with the person who owns it.
          </p>

          <div
            style={{
              marginTop: vertical ? 28 : 36,
              display: "flex",
              flexDirection: "column",
              gap: vertical ? 16 : 20,
            }}
          >
            {ITEMS.map((item, index) => (
              <div
                data-item
                key={item.title}
                style={{
                  display: "flex",
                  gap: 16,
                  paddingLeft: 2,
                }}
              >
                <div
                  style={{
                    width: 2,
                    flexShrink: 0,
                    backgroundColor: index === 2 ? theme.green : "rgba(18,22,19,0.16)",
                  }}
                />
                <div>
                  <div
                    style={{
                      fontFamily: fontSans,
                      fontSize: vertical ? 22 : 23,
                      fontWeight: 600,
                      color: theme.ink,
                    }}
                  >
                    {item.title}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontFamily: fontSans,
                      fontSize: vertical ? 19 : 20,
                      color: theme.inkFaint,
                    }}
                  >
                    {item.body}
                  </div>
                </div>
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
              src="screens/notes.png"
              alt="JotBox session notes with summary, key points, and actions"
              aspect={16 / 9}
              frameAspect={vertical ? 4 / 3 : 16 / 9}
              matte="#F6F3EB"
              radius={vertical ? 18 : 22}
              barHeight={vertical ? 36 : 44}
              style={{ width: "100%", height: "100%" }}
            >
              <Spot id="summary" x={0.43} y={0.32} w={0.55} h={0.18} dim="rgba(10,26,20,0.42)" showAt={4.7} hideAt={8.9} />
              <Spot id="points" x={0.44} y={0.48} w={0.55} h={0.17} dim="rgba(10,26,20,0.42)" showAt={10.4} hideAt={14.2} />
              <Spot id="actions" x={0.46} y={0.68} w={0.61} h={0.22} dim="rgba(10,26,20,0.42)" showAt={15.6} hideAt={22.6} />
            </Shot>
          </div>
        </div>
      </div>
    </SceneShell>
  );
}
