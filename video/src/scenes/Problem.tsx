import { AbsoluteFill } from "remotion";
import { Eyebrow, SceneShell } from "../components/SceneShell";
import { ParticleField } from "../components/ParticleField";
import { useGsapTimeline, useLayoutInfo } from "../lib/motion";
import { fontSans, fontSerif, theme } from "../theme";

const CARDS = [
  { index: "01", title: "The decision", body: "The thing everyone agreed on." },
  { index: "02", title: "The number", body: "The figure that changed the plan." },
  { index: "03", title: "The promise", body: "The thing you said you would do." },
];

export function Problem() {
  const { vertical } = useLayoutInfo();
  const host = useGsapTimeline((timeline, root) => {
    const eyebrow = root.querySelector("[data-eyebrow]");
    const line1 = root.querySelector("[data-line1]");
    const line2 = root.querySelector("[data-line2]");
    const sub = root.querySelector("[data-sub]");
    const cards = root.querySelectorAll("[data-card]");
    const turn = root.querySelector("[data-turn]");
    const turnSub = root.querySelector("[data-turn-sub]");
    const cardsColumn = root.querySelector("[data-cards]");

    timeline
      .fromTo(eyebrow, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, 0.25)
      .fromTo(line1, { opacity: 0, y: 46 }, { opacity: 1, y: 0, duration: 1.1, ease: "power3.out" }, 0.7)
      .fromTo(line2, { opacity: 0, y: 46 }, { opacity: 1, y: 0, duration: 1.1, ease: "power3.out" }, 2.15)
      .fromTo(sub, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.9, ease: "power2.out" }, 3.3)
      .fromTo(
        cards,
        { opacity: 0, y: 46, scale: 0.97 },
        { opacity: 1, y: 0, scale: 1, duration: 0.9, stagger: 0.32, ease: "power3.out" },
        4.6,
      )
      .fromTo(turn, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1, ease: "power3.out" }, 10.4)
      .fromTo(turnSub, { opacity: 0 }, { opacity: 1, duration: 0.9, ease: "power2.out" }, 11.4)
      .to(cardsColumn, { opacity: 0.28, duration: 1.2, ease: "power1.inOut" }, 12.4)
      .to(root, { opacity: 0, duration: 0.9, ease: "power2.in" }, 17.2);
  });

  return (
    <SceneShell bg={theme.greenDeep} tone="dark">
      <AbsoluteFill style={{ background: "radial-gradient(80% 70% at 22% 32%, #143D2F 0%, #0A241C 48%, #061611 100%)" }} />
      <ParticleField tone="dark" density={0.7} />
      <div
        ref={host}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: vertical ? "column" : "row",
          alignItems: vertical ? "stretch" : "center",
          justifyContent: vertical ? "space-between" : "flex-start",
          gap: vertical ? 48 : 100,
          padding: vertical ? "110px 72px 100px" : "100px 130px",
        }}
      >
        <div
          data-left
          style={{
            flex: vertical ? "0 0 auto" : "1 1 54%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div data-eyebrow>
            <Eyebrow color="rgba(220,234,217,0.5)" size={vertical ? 17 : 19}>
              The problem
            </Eyebrow>
          </div>
          <h2
            style={{
              margin: 0,
              marginTop: vertical ? 42 : 46,
              fontFamily: fontSerif,
              fontWeight: 400,
              fontSize: vertical ? 82 : 104,
              lineHeight: 1.02,
              letterSpacing: "-0.035em",
              color: theme.paper,
            }}
          >
            <span data-line1 style={{ display: "block" }}>
              You are in the room.
            </span>
            <span data-line2 style={{ display: "block", color: "rgba(244,242,234,0.52)" }}>
              Then the room ends.
            </span>
          </h2>
          <p
            data-sub
            style={{
              margin: 0,
              marginTop: vertical ? 34 : 40,
              maxWidth: 760,
              fontFamily: fontSans,
              fontSize: vertical ? 27 : 29,
              lineHeight: 1.55,
              color: "rgba(244,242,234,0.6)",
            }}
          >
            The useful parts do not wait for you to type them. And you cannot type and
            listen at the same time.
          </p>

          <div
            data-turn
            style={{
              marginTop: vertical ? 46 : 66,
              fontFamily: fontSerif,
              fontSize: vertical ? 40 : 46,
              fontStyle: "italic",
              color: theme.mint,
            }}
          >
            You were listening. That is the work.
          </div>
          <div
            data-turn-sub
            style={{
              marginTop: 16,
              fontFamily: fontSans,
              fontSize: vertical ? 24 : 25,
              color: "rgba(244,242,234,0.5)",
            }}
          >
            JotBox handles the record.
          </div>
        </div>

        <div
          data-cards
          style={{
            flex: vertical ? "0 0 auto" : "0 0 36%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: vertical ? 22 : 26,
          }}
        >
          {CARDS.map((card) => (
            <div
              key={card.index}
              data-card
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: vertical ? 22 : 26,
                padding: vertical ? "28px 30px" : "30px 32px",
                borderRadius: 24,
                backgroundColor: "rgba(220,234,217,0.055)",
                border: "1px solid rgba(220,234,217,0.14)",
              }}
            >
              <div
                style={{
                  fontFamily: fontSans,
                  fontSize: vertical ? 18 : 19,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: theme.accent,
                  paddingTop: 6,
                }}
              >
                {card.index}
              </div>
              <div>
                <div
                  style={{
                    fontFamily: fontSerif,
                    fontSize: vertical ? 34 : 36,
                    color: theme.paper,
                    lineHeight: 1.15,
                  }}
                >
                  {card.title}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    fontFamily: fontSans,
                    fontSize: vertical ? 22 : 23,
                    lineHeight: 1.45,
                    color: "rgba(244,242,234,0.5)",
                  }}
                >
                  {card.body}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SceneShell>
  );
}
