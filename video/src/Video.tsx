import React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, useCurrentFrame } from "remotion";
import { sceneFrames, type SceneName, type VideoSpec } from "./schema";
import { Caption, CaptionSpace } from "./ui";
import { SceneCta, SceneHook, SceneProblem, SceneReveal, SceneServices } from "./scenes";

const FADE = 9;

/**
 * Scene enter/exit.
 *
 * A pure cross-fade reads as a slideshow: nothing travels, so consecutive scenes
 * feel like separate images rather than one edit. Each scene now also drifts and
 * scales slightly through the cut, which gives the eye direction without
 * changing any timing — the sequence still owns exactly `dur` frames, so the
 * beat grid and the duration reported in the delivery stay exact.
 */
const Transition: React.FC<{ dur: number; dir: number; children: React.ReactNode }> = ({
  dur,
  dir,
  children,
}) => {
  const frame = useCurrentFrame();
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  const opacity = interpolate(frame, [0, FADE, dur - FADE, dur], [0, 1, 1, 0], clamp);
  const x = interpolate(frame, [0, FADE, dur - FADE, dur], [dir * 46, 0, 0, dir * -46], {
    ...clamp,
    easing: EASE,
  });
  const scale = interpolate(frame, [0, FADE, dur - FADE, dur], [1.03, 1, 1, 0.985], {
    ...clamp,
    easing: EASE,
  });

  return (
    <AbsoluteFill style={{ opacity, transform: `translateX(${x}px) scale(${scale})` }}>
      {children}
    </AbsoluteFill>
  );
};

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

const ORDER: SceneName[] = ["hook", "problem", "reveal", "services", "cta"];

const COMPONENTS: Record<SceneName, React.FC<{ spec: VideoSpec }>> = {
  hook: SceneHook,
  problem: SceneProblem,
  reveal: SceneReveal,
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
      {ORDER.map((name, index) => {
        const dur = frames[name];
        // A zero-length scene is skipped entirely.
        if (dur <= 0) return null;
        const Scene = COMPONENTS[name];
        const line = voice.get(name);
        const node = (
          <Sequence key={name} from={from} durationInFrames={dur}>
            {/* Voice and captions sit outside the transition: dipping narration
                with the visual dissolve would clip the first and last words, and
                sliding the caption with the scene makes it hard to read. */}
            {line ? <Audio src={line.audioUrl} /> : null}
            <Transition dur={dur} dir={index % 2 === 0 ? 1 : -1}>
              <CaptionSpace.Provider value={!!line}>
                <Scene spec={spec} />
              </CaptionSpace.Provider>
            </Transition>
            {line ? (
              <Caption theme={spec.theme} text={line.text} durationSec={line.durationSec} />
            ) : null}
          </Sequence>
        );
        from += dur;
        return node;
      })}
    </AbsoluteFill>
  );
};
