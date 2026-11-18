import type { ReactNode } from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Eyebrow, SceneShell } from "../components/SceneShell";
import { ParticleField } from "../components/ParticleField";
import { useGsapTimeline, useLayoutInfo } from "../lib/motion";
import { fontSans, fontSerif, theme } from "../theme";

export function Share() {
  const { vertical } = useLayoutInfo();
  const host = useGsapTimeline((timeline, root) => {
    const eyebrow = root.querySelector("[data-eyebrow]");
    const heading = root.querySelector("[data-heading]");
    const body = root.querySelector("[data-body]");
    const cards = root.querySelectorAll("[data-card]");

    timeline
      .fromTo(eyebrow, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" }, 0.2)
      .fromTo(heading, { opacity: 0, y: 38 }, { opacity: 1, y: 0, duration: 1, ease: "power3.out" }, 0.5)
      .fromTo(body, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, 1.15)
      .fromTo(
        cards,
        { opacity: 0, y: 54 },
        { opacity: 1, y: 0, duration: 0.9, stagger: 0.22, ease: "power3.out" },
        1.8,
      )
      .to(root, { opacity: 0, duration: 0.9, ease: "power2.in" }, 15.1);
  });

  const cardHeight = vertical ? 380 : 540;

  return (
    <SceneShell bg={theme.greenDeep} tone="dark">
      <AbsoluteFill style={{ background: "radial-gradient(80% 80% at 50% 20%, #154331 0%, #0A251C 52%, #061611 100%)" }} />
      <ParticleField tone="dark" density={0.8} showGrid={false} />
      <div
        ref={host}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          padding: vertical ? "110px 60px 80px" : "88px 100px 74px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: vertical ? "column" : "row",
            alignItems: vertical ? "flex-start" : "flex-end",
            justifyContent: "space-between",
            gap: vertical ? 22 : 40,
          }}
        >
          <div style={{ maxWidth: vertical ? "100%" : 980 }}>
            <div data-eyebrow>
              <Eyebrow color="rgba(220,234,217,0.5)" size={vertical ? 17 : 19}>
                05 / Keep and share
              </Eyebrow>
            </div>
            <h2
              data-heading
              style={{
                margin: 0,
                marginTop: vertical ? 28 : 32,
                fontFamily: fontSerif,
                fontWeight: 400,
                fontSize: vertical ? 70 : 84,
                lineHeight: 1.02,
                letterSpacing: "-0.035em",
                color: theme.paper,
              }}
            >
              Yours to keep.
              <br />
              <span style={{ color: theme.mint }}>Yours to share.</span>
            </h2>
          </div>
          <p
            data-body
            style={{
              margin: 0,
              maxWidth: 560,
              fontFamily: fontSans,
              fontSize: vertical ? 23 : 25,
              lineHeight: 1.55,
              color: "rgba(244,242,234,0.6)",
              textAlign: vertical ? "left" : "right",
            }}
          >
            Send a read-only link, export a branded PDF, or keep JotBox pinned above
            your calls.
          </p>
        </div>

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexDirection: vertical ? "column" : "row",
            gap: vertical ? 20 : 30,
            alignItems: "stretch",
          }}
        >
          <div
            data-card
            style={{
              flex: vertical ? "0 0 auto" : 1,
              height: cardHeight,
              borderRadius: 22,
              overflow: "hidden",
              border: "1px solid rgba(220,234,217,0.18)",
              backgroundColor: "#101A15",
              position: "relative",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <ShotVisual>
              <Thumb src="screens/share.png" bg="#0C1510" />
            </ShotVisual>
            <CardLabel vertical={vertical} number="01" title="Read-only link" note="No audio. No private jottings." />
          </div>

          <div
            data-card
            style={{
              flex: vertical ? "0 0 auto" : 1,
              height: cardHeight,
              borderRadius: 22,
              overflow: "hidden",
              border: "1px solid rgba(220,234,217,0.18)",
              backgroundColor: "#0E1712",
              position: "relative",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <ShotVisual>
              <Thumb src="screens/pdf.png" bg="#0C1510" sheet />
            </ShotVisual>
            <CardLabel vertical={vertical} number="02" title="Branded PDF" note="A clean export for the client." />
          </div>

          <div
            data-card
            style={{
              flex: vertical ? "0 0 auto" : 1,
              height: cardHeight,
              borderRadius: 22,
              border: "1px solid rgba(220,234,217,0.18)",
              background:
                "linear-gradient(155deg, #EAF2E7 0%, #DCEAD9 55%, #C9DCC6 100%)",
              position: "relative",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <ShotVisual matte>
              <Thumb src="screens/island.png" bg="transparent" width={86} />
            </ShotVisual>
            <CardLabel vertical={vertical} number="03" title="Desktop pill" note="Pinned above Meet, Zoom, or slides." dark />
          </div>
        </div>
      </div>
    </SceneShell>
  );
}

function ShotVisual({ matte = false, children }: { matte?: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        backgroundColor: matte ? theme.mintSoft : "#0C1510",
        display: "grid",
        placeItems: "center",
      }}
    >
      {children}
    </div>
  );
}

function Thumb({
  src,
  bg = "#0C1510",
  width = 100,
  pad = 20,
  sheet = false,
}: {
  src: string;
  bg?: string;
  width?: number;
  pad?: number;
  sheet?: boolean;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: bg,
        display: "grid",
        placeItems: "center",
        padding: pad,
      }}
    >
      <Img
        src={staticFile(src)}
        style={{
          width: `${width}%`,
          maxHeight: "100%",
          objectFit: "contain",
          display: "block",
          borderRadius: sheet ? 6 : 10,
          boxShadow: sheet ? "0 22px 54px rgba(2,12,9,0.55)" : undefined,
        }}
      />
    </div>
  );
}

function CardLabel({
  vertical = false,
  number,
  title,
  note,
  dark = false,
}: {
  vertical?: boolean;
  number: string;
  title: string;
  note: string;
  dark?: boolean;
}) {
  return (
    <div
      style={{
        flexShrink: 0,
        padding: vertical ? "16px 22px 20px" : "18px 22px 20px",
        borderTop: `1px solid ${dark ? "rgba(11,42,33,0.12)" : "rgba(220,234,217,0.12)"}`,
      }}
    >
      <div
        style={{
          fontFamily: fontSans,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.14em",
          color: dark ? "rgba(11,42,33,0.5)" : "rgba(220,234,217,0.5)",
        }}
      >
        {number}
      </div>
      <div
        style={{
          marginTop: 6,
          fontFamily: fontSerif,
          fontSize: vertical ? 30 : 28,
          lineHeight: 1.1,
          color: dark ? theme.green : theme.paper,
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 6,
          fontFamily: fontSans,
          fontSize: vertical ? 17 : 17,
          lineHeight: 1.4,
          color: dark ? "rgba(11,42,33,0.62)" : "rgba(244,242,234,0.56)",
        }}
      >
        {note}
      </div>
    </div>
  );
}
