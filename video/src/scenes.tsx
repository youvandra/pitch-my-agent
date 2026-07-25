import React from "react";
import { OffthreadVideo, interpolate, useCurrentFrame } from "remotion";
import type { VideoSpec } from "./schema";
import {
  A,
  AgentCard,
  Avatar,
  BlurIn,
  Bubble,
  Eyebrow,
  H1,
  MaskLine,
  OkxMark,
  Pop,
  ServiceRow,
  Stage,
  Swipe,
} from "./ui";

// Every scene is a pure function of the spec — no hardcoded copy or colors.
// That is what lets one fixed template serve any agent.
//
// The scenes deliberately do NOT share a layout. A deck of identical
// title-and-paragraph slides reads as a template no matter how good the copy is,
// so each beat gets its own composition and its own visual device: a portrait, a
// staged conversation, a product card, a price list, a screen recording. Copy
// appears only where it earns its place — some scenes are a single line.

interface SceneProps {
  spec: VideoSpec;
}

/** 1 · HOOK — centred portrait. Who this is, nothing else. */
export const SceneHook: React.FC<SceneProps> = ({ spec }) => (
  <Stage theme={spec.theme} align="center">
    <Pop delay={1}>
      <Avatar theme={spec.theme} url={spec.avatarUrl} name={spec.agentName} size={196} />
    </Pop>
    <div style={{ marginTop: 46 }}>
      <Eyebrow theme={spec.theme} delay={10}>
        {spec.hook.eyebrow ?? "On OKX.ai"}
      </Eyebrow>
      <MaskLine delay={16}>
        <H1 theme={spec.theme} size={124}>
          {spec.agentName}
        </H1>
      </MaskLine>
    </div>
  </Stage>
);

/**
 * 2 · PROBLEM — staged conversation, left aligned.
 *
 * Showing the wall an agent runs into lands harder than describing it, so this
 * beat is played out as messages rather than a paragraph.
 */
export const SceneProblem: React.FC<SceneProps> = ({ spec }) => {
  const frame = useCurrentFrame();
  return (
    <Stage theme={spec.theme} align="left">
      <Eyebrow theme={spec.theme} delay={2}>
        {spec.problem.eyebrow ?? "The problem"}
      </Eyebrow>
      <MaskLine delay={8}>
        <H1 theme={spec.theme} size={92}>
          {spec.problem.headline}
        </H1>
      </MaskLine>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 18,
          width: 1180,
          marginTop: 46,
          alignItems: "stretch",
        }}
      >
        <BlurIn delay={26} y={16}>
          <Bubble theme={spec.theme} from="user">
            {spec.problemExchange.user}
          </Bubble>
        </BlurIn>
        <BlurIn delay={40} y={16}>
          <Bubble theme={spec.theme} from="agent">
            <span style={{ opacity: interpolate(frame, [40, 56], [0.4, 1], { extrapolateRight: "clamp" }) }}>
              {spec.problemExchange.agent}
            </span>
          </Bubble>
        </BlurIn>
      </div>
    </Stage>
  );
};

/** 3 · REVEAL — the product shot. The marketplace card, centred, popped in. */
export const SceneReveal: React.FC<SceneProps> = ({ spec }) => (
  <Stage theme={spec.theme} align="center">
    <Eyebrow theme={spec.theme} delay={2}>
      {spec.reveal.eyebrow ?? "Meet"}
    </Eyebrow>
    <Pop delay={10} from={0.9}>
      <AgentCard
        theme={spec.theme}
        name={spec.agentName}
        agentId={spec.agentId}
        avatarUrl={spec.avatarUrl}
        tagline={spec.tagline}
        serviceCount={spec.services.length}
      />
    </Pop>
    <BlurIn delay={30}>
      <div style={{ fontSize: 32, color: spec.theme.muted, marginTop: 34 }}>{spec.reveal.sub}</div>
    </BlurIn>
  </Stage>
);

/** 5 · SERVICES — the price list, built one row at a time, left aligned. */
export const SceneServices: React.FC<SceneProps> = ({ spec }) => (
  <Stage theme={spec.theme} align="left">
    <Eyebrow theme={spec.theme} delay={2}>
      What it sells
    </Eyebrow>
    <div style={{ display: "flex", flexDirection: "column", gap: 18, width: 1400, marginTop: 6 }}>
      {spec.services.map((s, i) => (
        <BlurIn key={`${s.name}-${i}`} delay={8 + i * 9} y={22}>
          <ServiceRow
            theme={spec.theme}
            name={s.name}
            description={s.description}
            price={s.price}
            index={i}
          />
        </BlurIn>
      ))}
    </div>
  </Stage>
);

/** 6 · CTA — one line, centred, with the id an agent actually needs. */
export const SceneCta: React.FC<SceneProps> = ({ spec }) => (
  <Stage theme={spec.theme} align="center">
    <Eyebrow theme={spec.theme} delay={2}>
      {spec.cta.eyebrow ?? "Try it"}
    </Eyebrow>
    <MaskLine delay={8}>
      <H1 theme={spec.theme} size={128}>
        Agent <A theme={spec.theme}>#{spec.agentId}</A>
      </H1>
    </MaskLine>
    <Swipe theme={spec.theme} delay={26} width={420} />
    <BlurIn delay={32}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 34 }}>
        <span style={{ fontSize: 32, color: spec.theme.muted }}>available on</span>
        <OkxMark width={190} />
      </div>
    </BlurIn>
  </Stage>
);
