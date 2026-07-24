import React from "react";
import { OffthreadVideo } from "remotion";
import type { SceneCopy, VideoSpec } from "./schema";
import { Avatar, BrowserFrame, Eyebrow, H1, Pop, Rise, ServiceRow, Stage, Sub } from "./ui";

// Every scene is a pure function of the spec — no hardcoded copy or colors.
// That is what makes one fixed template serve any agent.

interface SceneProps {
  spec: VideoSpec;
}

/** Shared layout for the three copy-driven scenes. */
const CopyScene: React.FC<{ spec: VideoSpec; copy: SceneCopy; size?: number }> = ({ spec, copy, size }) => (
  <Stage theme={spec.theme}>
    <div style={{ textAlign: "center", maxWidth: 1400 }}>
      {copy.eyebrow ? (
        <Rise delay={2}>
          <Eyebrow theme={spec.theme}>{copy.eyebrow}</Eyebrow>
        </Rise>
      ) : null}
      <Rise delay={8}>
        <H1 theme={spec.theme} size={size}>
          {copy.headline}
        </H1>
      </Rise>
      {copy.sub ? (
        <Rise delay={18}>
          <Sub theme={spec.theme}>{copy.sub}</Sub>
        </Rise>
      ) : null}
    </div>
  </Stage>
);

export const SceneHook: React.FC<SceneProps> = ({ spec }) => (
  <Stage theme={spec.theme}>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
      <Pop delay={2}>
        <Avatar theme={spec.theme} url={spec.avatarUrl} name={spec.agentName} size={190} />
      </Pop>
      <div style={{ marginTop: 44 }}>
        <Rise delay={14}>
          <Eyebrow theme={spec.theme}>{spec.hook.eyebrow ?? "On OKX.ai"}</Eyebrow>
        </Rise>
        <Rise delay={20}>
          <H1 theme={spec.theme}>{spec.hook.headline}</H1>
        </Rise>
        {spec.hook.sub ? (
          <Rise delay={30}>
            <Sub theme={spec.theme}>{spec.hook.sub}</Sub>
          </Rise>
        ) : null}
      </div>
    </div>
  </Stage>
);

export const SceneProblem: React.FC<SceneProps> = ({ spec }) => (
  <CopyScene spec={spec} copy={spec.problem} />
);

export const SceneReveal: React.FC<SceneProps> = ({ spec }) => (
  <CopyScene spec={spec} copy={spec.reveal} />
);

/**
 * The live segment: a real recording of the agent being paid and called. This is
 * the differentiator — it only renders when the pipeline produced a clip.
 */
export const SceneLive: React.FC<SceneProps> = ({ spec }) => (
  <Stage theme={spec.theme}>
    <div style={{ width: "100%", maxWidth: 1560 }}>
      <Rise delay={2}>
        <Eyebrow theme={spec.theme}>Live · paid over x402</Eyebrow>
      </Rise>
      <Rise delay={10}>
        <BrowserFrame theme={spec.theme}>
          {spec.liveSegmentUrl ? (
            <OffthreadVideo src={spec.liveSegmentUrl} style={{ width: "100%", display: "block" }} />
          ) : (
            <div style={{ height: 620 }} />
          )}
        </BrowserFrame>
      </Rise>
    </div>
  </Stage>
);

export const SceneServices: React.FC<SceneProps> = ({ spec }) => (
  <Stage theme={spec.theme}>
    <div style={{ width: "100%", maxWidth: 1360 }}>
      <Rise delay={2}>
        <Eyebrow theme={spec.theme}>Services</Eyebrow>
      </Rise>
      <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 12 }}>
        {spec.services.map((s, i) => (
          <Rise key={`${s.name}-${i}`} delay={10 + i * 8}>
            <ServiceRow theme={spec.theme} name={s.name} description={s.description} price={s.price} />
          </Rise>
        ))}
      </div>
    </div>
  </Stage>
);

export const SceneCta: React.FC<SceneProps> = ({ spec }) => (
  <Stage theme={spec.theme}>
    <div style={{ textAlign: "center" }}>
      <Pop delay={2}>
        <Avatar theme={spec.theme} url={spec.avatarUrl} name={spec.agentName} size={130} />
      </Pop>
      <div style={{ marginTop: 36 }}>
        <Rise delay={12}>
          <Eyebrow theme={spec.theme}>{spec.cta.eyebrow ?? "Try it"}</Eyebrow>
        </Rise>
        <Rise delay={18}>
          <H1 theme={spec.theme} size={92}>
            {spec.cta.headline}
          </H1>
        </Rise>
        {spec.cta.sub ? (
          <Rise delay={26}>
            <Sub theme={spec.theme}>{spec.cta.sub}</Sub>
          </Rise>
        ) : null}
      </div>
    </div>
  </Stage>
);
