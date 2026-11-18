import { Composition } from "remotion";
import { DURATION, Walkthrough } from "./Walkthrough";

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="JotBox-Wide"
        component={Walkthrough}
        durationInFrames={DURATION}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="JotBox-Vertical"
        component={Walkthrough}
        durationInFrames={DURATION}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
}
