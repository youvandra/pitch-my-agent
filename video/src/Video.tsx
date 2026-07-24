import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, useCurrentFrame } from "remotion";
import { sceneFrames, type SceneName, type VideoSpec } from "./schema";
import { OkxMark } from "./ui";
import { SceneCta, SceneHook, SceneLive, SceneProblem, SceneReveal, SceneServices } from "./scenes";

const FADE = 9;

// Soft dissolve between sequences instead of hard cuts.
const Fade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, FADE, dur - FADE, dur], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const ORDER: SceneName[] = ["hook", "problem", "reveal", "live", "services", "cta"];

const COMPONENTS: Record<SceneName, React.FC<{ spec: VideoSpec }>> = {
  hook: SceneHook,
  problem: SceneProblem,
  reveal: SceneReveal,
  live: SceneLive,
  services: SceneServices,
  cta: SceneCta,
};

export const Video: React.FC<VideoSpec> = (spec) => {
  const frames = sceneFrames(spec);
  // Narration is keyed by scene so a line always plays over the scene it
  // describes, however long the grid made that scene.
  const voice = new Map((spec.narration ?? []).map((n) => [n.scene, n]));
  let from = 0;

  return (
    <AbsoluteFill style={{ background: spec.theme.bg }}>
      {/* Music runs the whole length, well under the voice: it carries the pulse
          the cuts are quantized to, it should never compete with narration. */}
      {spec.musicUrl ? <Audio src={spec.musicUrl} volume={0.22} /> : null}
      {ORDER.map((name) => {
        const dur = frames[name];
        // A zero-length scene (e.g. no live segment) is skipped entirely.
        if (dur <= 0) return null;
        const Scene = COMPONENTS[name];
        const line = voice.get(name);
        const node = (
          <Sequence key={name} from={from} durationInFrames={dur}>
            {/* The voice sits outside <Fade> — dipping narration volume with the
                visual dissolve would clip the first and last words. */}
            {line ? <Audio src={line.audioUrl} /> : null}
            <Fade dur={dur}>
              <Scene spec={spec} />
            </Fade>
          </Sequence>
        );
        from += dur;
        return node;
      })}
      {/* Platform mark, held quietly in the corner for the whole runtime so the
          video reads as OKX.ai content without repeating the name on every scene. */}
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-end", padding: 56, pointerEvents: "none" }}>
        <OkxMark width={124} opacity={0.28} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
