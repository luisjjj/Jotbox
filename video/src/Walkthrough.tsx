import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { Capture } from "./scenes/Capture";
import { Close } from "./scenes/Close";
import { Intro } from "./scenes/Intro";
import { Library } from "./scenes/Library";
import { Memory } from "./scenes/Memory";
import { Notes } from "./scenes/Notes";
import { Problem } from "./scenes/Problem";
import { Share } from "./scenes/Share";
import { fontSans } from "./theme";

export const DURATION = 5040;

export function Walkthrough() {
  return (
    <AbsoluteFill style={{ backgroundColor: "#04120D", fontFamily: fontSans }}>
      <Audio src={staticFile("music.m4a")} volume={0.82} />
      <Sequence from={0} durationInFrames={252}>
        <Intro />
      </Sequence>
      <Sequence from={240} durationInFrames={552} premountFor={12}>
        <Problem />
      </Sequence>
      <Sequence from={780} durationInFrames={912} premountFor={12}>
        <Capture />
      </Sequence>
      <Sequence from={1680} durationInFrames={852} premountFor={12}>
        <Notes />
      </Sequence>
      <Sequence from={2520} durationInFrames={732} premountFor={12}>
        <Library />
      </Sequence>
      <Sequence from={3240} durationInFrames={732} premountFor={12}>
        <Memory />
      </Sequence>
      <Sequence from={3960} durationInFrames={492} premountFor={12}>
        <Share />
      </Sequence>
      <Sequence from={4440} durationInFrames={600}>
        <Close />
      </Sequence>
    </AbsoluteFill>
  );
}
