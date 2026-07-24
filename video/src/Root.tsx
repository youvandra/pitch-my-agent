import React from "react";
import { Composition } from "remotion";
import { Video } from "./Video";
import { DEFAULT_SPEC, FPS, totalFrames, videoSpecSchema, type VideoSpec } from "./schema";

// One composition serves every agent: the backend passes a VideoSpec as --props
// and the duration is derived from it.
export const Root: React.FC = () => (
  <>
    <Composition
      id="Pitch"
      component={Video}
      schema={videoSpecSchema}
      defaultProps={DEFAULT_SPEC}
      width={1920}
      height={1080}
      fps={FPS}
      durationInFrames={totalFrames(DEFAULT_SPEC)}
      // Length comes from the scene grid, not the requested duration: scenes are
      // rounded up to whole bars (and grow to fit narration), so anything else
      // would clip the final scene.
      calculateMetadata={({ props }: { props: VideoSpec }) => ({
        durationInFrames: totalFrames(props),
      })}
    />
  </>
);
