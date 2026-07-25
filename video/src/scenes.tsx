import React from "react";
import { OffthreadVideo, interpolate, useCurrentFrame } from "remotion";
import type { VideoSpec } from "./schema";
import { makeGrid, staggerBeats } from "./beat";
import {
  A,
  TYPE,
  FONT_MONO,
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
  <Stage theme={spec.theme} styleKind={spec.style} align="center">
    <Pop delay={1}>
      <Avatar theme={spec.theme} url={spec.avatarUrl} name={spec.agentName} size={196} />
    </Pop>
    <div style={{ marginTop: 46 }}>
      <Eyebrow theme={spec.theme} delay={10}>
        {spec.hook.eyebrow ?? "On OKX.ai"}
      </Eyebrow>
      <MaskLine delay={16}>
        <H1 theme={spec.theme} size={TYPE.display}>
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
    <Stage theme={spec.theme} styleKind={spec.style} align="left">
      <Eyebrow theme={spec.theme} delay={2}>
        {spec.problem.eyebrow ?? "The problem"}
      </Eyebrow>
      <MaskLine delay={8}>
        <H1 theme={spec.theme} size={TYPE.h1}>
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
  <Stage theme={spec.theme} styleKind={spec.style} align="center">
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


/**
 * 4 · DEMO — one purchase, staged end to end.
 *
 * The moat of the whole video. A generic promo template can show headlines and
 * a price list for anything; only a tool that understands how an OKX.ai agent
 * is actually bought can stage the x402 loop — request in, 402 challenge,
 * settlement, delivery — with the service's real name and real fee. The window
 * says "simulated" because the session is an illustration; the name, the price
 * and the protocol are not.
 */
const typedChars = (frame: number, start: number, text: string, cps = 1.7): string =>
  frame <= start ? "" : text.slice(0, Math.floor((frame - start) * cps));

const DemoResultCard: React.FC<{ spec: VideoSpec; start: number }> = ({ spec, start }) => {
  const frame = useCurrentFrame();
  const flow = spec.demoFlow!;
  const theme = spec.theme;
  const local = frame - start;
  const grid = makeGrid(spec.bpm);
  const delays = staggerBeats(grid, flow.resultLines.length, 0, 1);
  if (local < 0) return null;

  const reveal = (i: number, dist = 14) => ({
    opacity: interpolate(local - delays[i], [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    transform: `translateY(${interpolate(local - delays[i], [0, 12], [dist, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
  });

  if (flow.resultKind === "image-grid") {
    return (
      <div style={{ display: "flex", gap: 18, marginTop: 26 }}>
        {flow.resultLines.map((line, i) => (
          <div key={line} style={{ flex: 1, ...reveal(i) }}>
            <div
              style={{
                height: 210,
                borderRadius: 12,
                background: theme.bg,
                border: `1px solid ${theme.muted}2e`,
                overflow: "hidden",
                position: "relative",
              }}
            >
              {/* shimmer: the artwork arriving */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `linear-gradient(115deg, transparent 30%, ${theme.primary}22 47%, ${theme.accent}2e 50%, transparent 66%)`,
                  transform: `translateX(${interpolate(local - delays[i], [0, 46], [-320, 320], { extrapolateRight: "clamp" })}px)`,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 14,
                  borderRadius: 8,
                  border: `1px dashed ${theme.muted}33`,
                }}
              />
            </div>
            <div style={{ fontSize: 21, color: theme.muted, marginTop: 10, textAlign: "center" }}>{line}</div>
          </div>
        ))}
      </div>
    );
  }

  if (flow.resultKind === "chart") {
    const heights = [0.52, 0.86, 0.66, 0.94];
    return (
      <div style={{ display: "flex", gap: 26, alignItems: "flex-end", height: 230, marginTop: 26 }}>
        {flow.resultLines.map((line, i) => (
          <div key={line} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
            <div
              style={{
                height: interpolate(local - delays[i], [0, 20], [0, 170 * heights[i % heights.length]], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
                borderRadius: 8,
                background: `linear-gradient(180deg, ${theme.accent}, ${theme.accent}55)`,
              }}
            />
            <div style={{ fontSize: 21, color: theme.muted, marginTop: 10, textAlign: "center" }}>{line}</div>
          </div>
        ))}
      </div>
    );
  }

  if (flow.resultKind === "report") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 26 }}>
        {flow.resultLines.map((line, i) => (
          <div key={line} style={{ display: "flex", alignItems: "center", gap: 16, ...reveal(i, 10) }}>
            <span style={{ color: theme.primary, fontFamily: FONT_MONO, fontSize: 24 }}>✓</span>
            <span style={{ fontSize: 26, color: theme.text }}>{line}</span>
            <div style={{ flex: 1, height: 10, borderRadius: 5, background: `${theme.muted}1f` }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 26 }}>
      {flow.resultLines.map((line, i) => (
        <div key={line} style={{ fontFamily: FONT_MONO, fontSize: 24, color: theme.text, ...reveal(i, 8) }}>
          {line}
        </div>
      ))}
    </div>
  );
};

export const SceneDemo: React.FC<SceneProps> = ({ spec }) => {
  const frame = useCurrentFrame();
  const flow = spec.demoFlow;
  if (!flow) return null;
  const theme = spec.theme;

  const request = `> ${flow.request}`;
  const typingDone = 12 + Math.ceil(request.length / 1.7);
  const t402 = typingDone + 12;
  const tSettle = t402 + 22;
  const tResult = tSettle + 16;
  const line = (at: number): React.CSSProperties => ({
    opacity: interpolate(frame, [at, at + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  });

  return (
    <Stage theme={spec.theme} styleKind={spec.style} align="center">
      <Eyebrow theme={theme} delay={2}>
        One call, start to finish
      </Eyebrow>
      <Pop delay={6} from={0.96}>
        <div
          style={{
            width: 1220,
            borderRadius: 18,
            background: theme.bg2,
            border: `1px solid ${theme.muted}26`,
            boxShadow: `0 50px 120px -50px #000, 0 0 70px -42px ${theme.primary}55`,
            overflow: "hidden",
            textAlign: "left",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "16px 22px",
              borderBottom: `1px solid ${theme.muted}1f`,
            }}
          >
            {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
              <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />
            ))}
            <div style={{ fontFamily: FONT_MONO, fontSize: 20, color: theme.muted, marginLeft: 12 }}>
              x402 session — {flow.serviceName}
            </div>
            <div style={{ marginLeft: "auto", fontFamily: FONT_MONO, fontSize: 17, color: `${theme.muted}88`, letterSpacing: "0.14em" }}>
              SIMULATED
            </div>
          </div>

          <div style={{ padding: "26px 30px 30px", fontFamily: FONT_MONO }}>
            <div style={{ fontSize: 25, color: theme.text, minHeight: 34 }}>
              {typedChars(frame, 12, request)}
              {frame < typingDone ? <span style={{ color: theme.accent }}>▊</span> : null}
            </div>
            <div style={{ fontSize: 23, color: theme.accent, marginTop: 16, ...line(t402) }}>
              402 Payment Required — {flow.price} USDT0 · X Layer
            </div>
            <div style={{ fontSize: 23, color: theme.muted, marginTop: 10, ...line(tSettle) }}>
              <span style={{ color: theme.primary }}>✓</span> x402 settled · exact scheme · delivering…
            </div>
            <DemoResultCard spec={spec} start={tResult} />
            {flow.resultCaption ? (
              <div style={{ fontSize: 21, color: theme.muted, marginTop: 22, ...line(tResult + 30) }}>
                → {flow.resultCaption}
              </div>
            ) : null}
          </div>
        </div>
      </Pop>
    </Stage>
  );
};

/** 5 · SERVICES — the price list, built one row at a time, left aligned. */
export const SceneServices: React.FC<SceneProps> = ({ spec }) => (
  <Stage theme={spec.theme} styleKind={spec.style} align="left">
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
  <Stage theme={spec.theme} styleKind={spec.style} align="center">
    <Eyebrow theme={spec.theme} delay={2}>
      {spec.cta.eyebrow ?? "Try it"}
    </Eyebrow>
    <MaskLine delay={8}>
      <H1 theme={spec.theme} size={TYPE.display}>
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
