import React from "react";
import { OffthreadVideo, interpolate, useCurrentFrame } from "remotion";
import type { VideoSpec } from "./schema";
import { makeGrid, staggerBeats } from "./beat";
import {
  A,
  TYPE,
  FONT_DISPLAY,
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

/**
 * 1 · HOOK — who this is. Three compositions, chosen per agent:
 * a logo-led portrait, a tagline-led statement, or a side-by-side badge.
 */
const HookPortrait: React.FC<SceneProps> = ({ spec }) => (
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

const HookStatement: React.FC<SceneProps> = ({ spec }) => (
  <Stage theme={spec.theme} styleKind={spec.style} align="center">
    <Eyebrow theme={spec.theme} delay={4}>
      {spec.hook.eyebrow ?? "On OKX.ai"}
    </Eyebrow>
    <MaskLine delay={10}>
      <H1 theme={spec.theme} size={TYPE.h1}>
        {spec.tagline}
      </H1>
    </MaskLine>
    <BlurIn delay={34}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 44 }}>
        <Avatar theme={spec.theme} url={spec.avatarUrl} name={spec.agentName} size={64} />
        <span style={{ fontFamily: FONT_MONO, fontSize: 27, color: spec.theme.muted }}>{spec.agentName}</span>
      </div>
    </BlurIn>
  </Stage>
);

const HookBadge: React.FC<SceneProps> = ({ spec }) => (
  <Stage theme={spec.theme} styleKind={spec.style} align="left">
    <div style={{ display: "flex", alignItems: "center", gap: 52 }}>
      <Pop delay={2}>
        <Avatar theme={spec.theme} url={spec.avatarUrl} name={spec.agentName} size={230} />
      </Pop>
      <div>
        <Eyebrow theme={spec.theme} delay={12}>
          {spec.hook.eyebrow ?? "On OKX.ai"}
        </Eyebrow>
        <MaskLine delay={18}>
          <H1 theme={spec.theme} size={TYPE.display}>
            {spec.agentName}
          </H1>
        </MaskLine>
        <BlurIn delay={34}>
          <div style={{ fontSize: TYPE.sub, color: spec.theme.muted, marginTop: 20, maxWidth: 900 }}>
            {spec.tagline}
          </div>
        </BlurIn>
      </div>
    </div>
  </Stage>
);

export const SceneHook: React.FC<SceneProps> = ({ spec }) => {
  const variant = spec.scenePlan?.hook ?? "portrait";
  if (variant === "statement") return <HookStatement spec={spec} />;
  if (variant === "badge") return <HookBadge spec={spec} />;
  return <HookPortrait spec={spec} />;
};

/**
 * 2 · PROBLEM — staged conversation, left aligned.
 *
 * Showing the wall an agent runs into lands harder than describing it, so this
 * beat is played out as messages rather than a paragraph.
 */
const ProblemChat: React.FC<SceneProps> = ({ spec }) => {
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
        {/* a beat of "typing…" before the refusal: the pause is what makes
            the exchange read as a real conversation and the no land harder */}
        {frame >= 40 && frame < 66 ? (
          <div style={{ display: "flex", gap: 7, padding: "16px 22px" }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: spec.theme.muted,
                  opacity: 0.35 + 0.45 * Math.abs(Math.sin((frame - 40) / 6 + i * 1.05)),
                }}
              />
            ))}
          </div>
        ) : null}
        <BlurIn delay={66} y={16}>
          <Bubble theme={spec.theme} from="agent">
            <span style={{ opacity: interpolate(frame, [66, 80], [0.4, 1], { extrapolateRight: "clamp" }) }}>
              {spec.problemExchange.agent}
            </span>
          </Bubble>
        </BlurIn>
      </div>
    </Stage>
  );
};

/** The other problem composition: one blunt question, centred, no theatre. */
const ProblemWall: React.FC<SceneProps> = ({ spec }) => (
  <Stage theme={spec.theme} styleKind={spec.style} align="center">
    <Eyebrow theme={spec.theme} delay={2}>
      {spec.problem.eyebrow ?? "The problem"}
    </Eyebrow>
    <MaskLine delay={8}>
      <H1 theme={spec.theme} size={TYPE.display}>
        {spec.problem.headline}
      </H1>
    </MaskLine>
    <Swipe theme={spec.theme} delay={26} width={380} />
    <BlurIn delay={34}>
      <div style={{ fontSize: TYPE.sub, color: spec.theme.muted, marginTop: 30, maxWidth: 1100 }}>
        {spec.problem.sub}
      </div>
    </BlurIn>
  </Stage>
);

export const SceneProblem: React.FC<SceneProps> = ({ spec }) =>
  (spec.scenePlan?.problem ?? "chat") === "wall" ? <ProblemWall spec={spec} /> : <ProblemChat spec={spec} />;

/** 3 · REVEAL — the product shot: marketplace card, or a name-led banner. */
const RevealCard: React.FC<SceneProps> = ({ spec }) => (
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

const RevealBanner: React.FC<SceneProps> = ({ spec }) => (
  <Stage theme={spec.theme} styleKind={spec.style} align="left">
    <Eyebrow theme={spec.theme} delay={2}>
      {spec.reveal.eyebrow ?? "Meet"}
    </Eyebrow>
    <MaskLine delay={8}>
      <H1 theme={spec.theme} size={TYPE.display}>
        {spec.reveal.headline}
      </H1>
    </MaskLine>
    <BlurIn delay={26}>
      <div style={{ fontSize: TYPE.sub, color: spec.theme.muted, marginTop: 24, maxWidth: 1150 }}>
        {spec.reveal.sub}
      </div>
    </BlurIn>
    <BlurIn delay={38}>
      <div style={{ display: "flex", gap: 16, marginTop: 40 }}>
        {[`#${spec.agentId}`, `${spec.services.length} services`, "pay-per-call · x402"].map((chip) => (
          <div
            key={chip}
            style={{
              fontFamily: FONT_MONO,
              fontSize: 23,
              color: spec.theme.accent,
              border: `1px solid ${spec.theme.accent}44`,
              borderRadius: 999,
              padding: "10px 22px",
              background: `${spec.theme.accent}0d`,
            }}
          >
            {chip}
          </div>
        ))}
      </div>
    </BlurIn>
  </Stage>
);

export const SceneReveal: React.FC<SceneProps> = ({ spec }) =>
  (spec.scenePlan?.reveal ?? "card") === "banner" ? <RevealBanner spec={spec} /> : <RevealCard spec={spec} />;

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
              {/* what stays once the artwork has "arrived" — an empty black
                  box reads as a failed load, so the panel keeps a quiet
                  duotone wash and its page number */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `linear-gradient(145deg, ${theme.primary}1c, transparent 55%, ${theme.accent}14)`,
                  opacity: interpolate(local - delays[i], [24, 44], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                }}
              />
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
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: FONT_MONO,
                  fontSize: 40,
                  fontWeight: 700,
                  color: `${theme.text}2e`,
                }}
              >
                {i + 1}
              </div>
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

/** 5 · SERVICES — the catalogue: rows, a card grid, or one hero offer. */
const ServicesList: React.FC<SceneProps> = ({ spec }) => {
  const delays = staggerBeats(makeGrid(spec.bpm), spec.services.length, 1, 1);
  return (
    <Stage theme={spec.theme} styleKind={spec.style} align="left">
      <Eyebrow theme={spec.theme} delay={2}>
        What it sells
      </Eyebrow>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, width: 1400, marginTop: 6 }}>
        {spec.services.map((s, i) => (
          <BlurIn key={`${s.name}-${i}`} delay={delays[i]} y={22}>
            <ServiceRow theme={spec.theme} name={s.name} description={s.description} price={s.price} index={i} />
          </BlurIn>
        ))}
      </div>
    </Stage>
  );
};

const ServicesGrid: React.FC<SceneProps> = ({ spec }) => {
  const items = spec.services.slice(0, 4);
  const delays = staggerBeats(makeGrid(spec.bpm), items.length, 1, 1);
  return (
    <Stage theme={spec.theme} styleKind={spec.style} align="left">
      <Eyebrow theme={spec.theme} delay={2}>
        What it sells
      </Eyebrow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, width: 1400, marginTop: 6 }}>
        {items.map((s, i) => (
          <BlurIn key={`${s.name}-${i}`} delay={delays[i]} y={20}>
            <div
              style={{
                background: spec.theme.bg2,
                border: `1px solid ${spec.theme.primary}2e`,
                borderRadius: 20,
                padding: "28px 32px",
                textAlign: "left",
                height: 172,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 33, color: spec.theme.text }}>
                  {s.name}
                </div>
                <div
                  style={{
                    fontSize: 23,
                    color: spec.theme.muted,
                    marginTop: 8,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {s.description}
                </div>
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 32, fontWeight: 700, color: spec.theme.accent }}>
                {s.price}
              </div>
            </div>
          </BlurIn>
        ))}
      </div>
    </Stage>
  );
};

const ServicesHero: React.FC<SceneProps> = ({ spec }) => {
  const price = (p: string): number => {
    const n = Number(p.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : Infinity;
  };
  const sorted = [...spec.services].sort((a, b) => price(a.price) - price(b.price));
  const [hero, ...rest] = sorted;
  const delays = staggerBeats(makeGrid(spec.bpm), rest.length + 1, 1, 1);
  if (!hero) return null;
  return (
    <Stage theme={spec.theme} styleKind={spec.style} align="left">
      <Eyebrow theme={spec.theme} delay={2}>
        Start here
      </Eyebrow>
      <BlurIn delay={delays[0]} y={24}>
        <div
          style={{
            width: 1400,
            background: spec.theme.bg2,
            border: `1.5px solid ${spec.theme.accent}55`,
            borderRadius: 24,
            padding: "40px 44px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 40,
            textAlign: "left",
            boxShadow: `0 40px 100px -45px #000, 0 0 60px -35px ${spec.theme.accent}55`,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 46, color: spec.theme.text }}>
              {hero.name}
            </div>
            <div style={{ fontSize: 26, color: spec.theme.muted, marginTop: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {hero.description}
            </div>
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 56, fontWeight: 700, color: spec.theme.accent, whiteSpace: "nowrap" }}>
            {hero.price}
          </div>
        </div>
      </BlurIn>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 1400, marginTop: 20 }}>
        {rest.slice(0, 3).map((s, i) => (
          <BlurIn key={`${s.name}-${i}`} delay={delays[i + 1]} y={14}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "18px 30px",
                borderRadius: 14,
                border: `1px solid ${spec.theme.muted}1f`,
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 27, color: spec.theme.text }}>{s.name}</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 27, color: spec.theme.muted }}>{s.price}</span>
            </div>
          </BlurIn>
        ))}
      </div>
    </Stage>
  );
};

export const SceneServices: React.FC<SceneProps> = ({ spec }) => {
  const variant = spec.scenePlan?.services ?? "list";
  if (variant === "grid") return <ServicesGrid spec={spec} />;
  if (variant === "hero" && spec.services.length > 0) return <ServicesHero spec={spec} />;
  return <ServicesList spec={spec} />;
};

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
    {/* the address itself: a CTA that names a place beats one that names a brand */}
    <BlurIn delay={44}>
      <div
        style={{
          marginTop: 30,
          fontFamily: FONT_MONO,
          fontSize: 27,
          color: spec.theme.accent,
          border: `1px solid ${spec.theme.accent}44`,
          borderRadius: 12,
          padding: "12px 26px",
          background: `${spec.theme.accent}0d`,
        }}
      >
        okx.ai/agents/{spec.agentId}
      </div>
    </BlurIn>
  </Stage>
);
