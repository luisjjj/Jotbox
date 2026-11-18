import { Img, staticFile } from "remotion";
import { fontSans, fontSerif, theme } from "../theme";

export function Brand({
  size = 64,
  tone = "dark",
  showWord = true,
}: {
  size?: number;
  tone?: "dark" | "light";
  showWord?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.28 }}>
      <Img
        src={staticFile("brand/logo.png")}
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.24,
          boxShadow:
            tone === "dark"
              ? "0 18px 50px rgba(0,0,0,0.35)"
              : "0 16px 40px rgba(11,42,33,0.18)",
        }}
      />
      {showWord ? (
        <span
          style={{
            fontFamily: fontSerif,
            fontSize: size * 0.82,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: tone === "dark" ? theme.paper : theme.green,
          }}
        >
          JotBox
        </span>
      ) : null}
    </div>
  );
}

export function UrlPill({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: fontSans,
        fontSize: 18,
        color: tone === "dark" ? "rgba(244,242,234,0.6)" : "rgba(18,22,19,0.55)",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 99,
          backgroundColor: tone === "dark" ? theme.mint : theme.greenMid,
          opacity: 0.75,
        }}
      />
      jotbox.online
    </div>
  );
}
