import React from "react";
import { Composition } from "remotion";
import { Video } from "./Video";
import { DEFAULT_SPEC, FPS, videoSpecSchema, type VideoSpec } from "./schema";

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
      durationInFrames={Math.round(DEFAULT_SPEC.durationSec * FPS)}
      calculateMetadata={({ props }: { props: VideoSpec }) => ({
        durationInFrames: Math.round(props.durationSec * FPS),
      })}
    />
  </>
);
