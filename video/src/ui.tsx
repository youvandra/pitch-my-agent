import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadDisplay } from "@remotion/google-fonts/Sora";
import { loadFont as loadBody } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import type { Palette } from "./schema";
import { OKX_LOGO_WHITE } from "./okx-logo";

// Fonts are bundled and self-hosted by Remotion at build time, so a render never
// depends on a system font and type is pixel-identical every time. Only the
// weights and subset actually used are loaded — pulling every weight costs
// hundreds of network requests per render.
export const FONT_DISPLAY = loadDisplay("normal", {
  weights: ["700", "800"],
  subsets: ["latin"],
  ignoreTooManyRequestsWarning: true,
}).fontFamily;

export const FONT_BODY = loadBody("normal", {
  weights: ["400", "600"],
  subsets: ["latin"],
  ignoreTooManyRequestsWarning: true,
}).fontFamily;

export const FONT_MONO = loadMono("normal", {
  weights: ["600", "700"],
  subsets: ["latin"],
  ignoreTooManyRequestsWarning: true,
}).fontFamily;

/** One easing for everything: decelerate into place. Never linear. */
export const EASE = Easing.bezier(0.16, 1, 0.3, 1);

const tnum: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

/** Progress 0→1 over `dur` frames starting at `delay`. */
export function useProg(delay = 0, dur = 20): number {
  const frame = useCurrentFrame();
  return interpolate(frame - delay, [0, dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
}

// ─── Stage ───────────────────────────────────────────────────────────────────

export type Align = "center" | "left";

/**
 * The ground every scene sits on.
 *
 * Alignment is decided once, here, and inherited by everything inside — mixing a
 * left-aligned block with a centred headline is the fastest way to make a video
 * look accidental. The backdrop drifts continuously so a scene is never
 * completely static, even while nothing is animating.
 */
export const Stage: React.FC<{
  theme: Palette;
  align?: Align;
  children: React.ReactNode;
}> = ({ theme, align = "center", children }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 110) * 3;
  const glow = 0.1 + Math.sin(frame / 75) * 0.025;

  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        color: theme.text,
        fontFamily: FONT_BODY,
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        justifyContent: "center",
        textAlign: align,
        padding: "0 132px",
        overflow: "hidden",
      }}
    >
      {/* faint grid, masked to the centre so edges stay clean */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${theme.muted}14 1px, transparent 1px), linear-gradient(90deg, ${theme.muted}14 1px, transparent 1px)`,
          backgroundSize: "88px 88px",
          maskImage: "radial-gradient(120% 100% at 50% 40%, #000 25%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(120% 100% at 50% 40%, #000 25%, transparent 78%)",
        }}
      />
      {/* drifting brand glow + floor vignette */}
      <AbsoluteFill
        style={{
          background:
            `radial-gradient(58% 48% at ${50 + drift}% 6%, ${theme.primary}${Math.round(glow * 255).toString(16).padStart(2, "0")}, transparent 62%),` +
            `radial-gradient(80% 60% at 50% 116%, #00000088, transparent 60%)`,
        }}
      />
      <div style={{ position: "relative", width: "100%", display: "flex", flexDirection: "column", alignItems: align === "center" ? "center" : "flex-start" }}>
        {children}
      </div>
    </AbsoluteFill>
  );
};

// ─── Motion primitives ───────────────────────────────────────────────────────

/** Line rises out of a clip. The workhorse for headlines. */
export const MaskLine: React.FC<{ delay?: number; dur?: number; children: React.ReactNode }> = ({
  delay = 0,
  dur = 24,
  children,
}) => {
  const p = useProg(delay, dur);
  return (
    <div style={{ overflow: "hidden", padding: "0.08em 0.02em" }}>
      <div style={{ transform: `translateY(${interpolate(p, [0, 1], [110, 0])}%)` }}>{children}</div>
    </div>
  );
};

/** Blur + fade + lift. For supporting copy. */
export const BlurIn: React.FC<{
  delay?: number;
  dur?: number;
  y?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ delay = 0, dur = 20, y = 20, children, style }) => {
  const p = useProg(delay, dur);
  return (
    <div
      style={{
        opacity: p,
        filter: `blur(${interpolate(p, [0, 1], [12, 0])}px)`,
        transform: `translateY(${interpolate(p, [0, 1], [y, 0])}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Springy pop, for objects that should feel physical. */
export const Pop: React.FC<{ delay?: number; from?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  delay = 0,
  from = 0.84,
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 150, mass: 0.9 } });
  return (
    <div style={{ transform: `scale(${interpolate(s, [0, 1], [from, 1])})`, opacity: Math.min(1, s * 1.4), ...style }}>
      {children}
    </div>
  );
};

/** Accent underline that draws itself. */
export const Swipe: React.FC<{ theme: Palette; delay?: number; width: number }> = ({ theme, delay = 0, width }) => {
  const p = useProg(delay, 18);
  return (
    <div
      style={{
        width: width * p,
        height: 7,
        borderRadius: 999,
        marginTop: 22,
        background: theme.primary,
        boxShadow: `0 0 26px ${theme.primary}66`,
      }}
    />
  );
};

/** Number that counts up — cheap way to make a price feel like an event. */
export const Counter: React.FC<{
  to: number;
  delay?: number;
  dur?: number;
  prefix?: string;
  decimals?: number;
  style?: React.CSSProperties;
}> = ({ to, delay = 0, dur = 26, prefix = "", decimals = 2, style }) => {
  const p = useProg(delay, dur);
  return (
    <span style={{ ...tnum, ...style }}>
      {prefix}
      {(p * to).toFixed(decimals)}
    </span>
  );
};

// ─── Typography ──────────────────────────────────────────────────────────────

export const Eyebrow: React.FC<{ theme: Palette; delay?: number; children: React.ReactNode }> = ({
  theme,
  delay = 0,
  children,
}) => (
  <BlurIn delay={delay} dur={16} y={10}>
    <div
      style={{
        fontFamily: FONT_MONO,
        fontWeight: 600,
        letterSpacing: "0.3em",
        textTransform: "uppercase",
        color: theme.primary,
        fontSize: 24,
        marginBottom: 22,
      }}
    >
      {children}
    </div>
  </BlurIn>
);

export const H1: React.FC<{ theme: Palette; size?: number; children: React.ReactNode }> = ({
  theme,
  size = 112,
  children,
}) => (
  <div
    style={{
      fontFamily: FONT_DISPLAY,
      fontWeight: 800,
      fontSize: size,
      lineHeight: 1.02,
      letterSpacing: "-0.025em",
      color: theme.text,
      textWrap: "balance",
      maxWidth: 1500,
    }}
  >
    {children}
  </div>
);

export const Sub: React.FC<{ theme: Palette; delay?: number; children: React.ReactNode }> = ({
  theme,
  delay = 0,
  children,
}) => (
  <BlurIn delay={delay} dur={20}>
    <div style={{ fontSize: 36, lineHeight: 1.42, color: theme.muted, marginTop: 28, maxWidth: 1080 }}>
      {children}
    </div>
  </BlurIn>
);

/** Accent-coloured inline span. */
export const A: React.FC<{ theme: Palette; children: React.ReactNode }> = ({ theme, children }) => (
  <span style={{ color: theme.primary }}>{children}</span>
);

// ─── Illustrative objects ────────────────────────────────────────────────────

export const Avatar: React.FC<{ theme: Palette; url: string; name: string; size?: number }> = ({
  theme,
  url,
  name,
  size = 160,
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.24,
      overflow: "hidden",
      flexShrink: 0,
      background: theme.bg2,
      border: `2px solid ${theme.primary}66`,
      boxShadow: `0 24px 60px -20px ${theme.primary}55`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: FONT_DISPLAY,
      fontWeight: 800,
      fontSize: size * 0.4,
      color: theme.primary,
    }}
  >
    {url ? (
      // Remotion's <Img> holds the frame until the image has loaded; a plain
      // <img> renders an empty box because the capture does not wait for it.
      <Img src={url} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    ) : (
      name.slice(0, 1).toUpperCase()
    )}
  </div>
);

/** The agent as it appears on the marketplace — the product shot of this video. */
export const AgentCard: React.FC<{
  theme: Palette;
  name: string;
  agentId: string;
  avatarUrl: string;
  tagline: string;
  serviceCount: number;
}> = ({ theme, name, agentId, avatarUrl, tagline, serviceCount }) => (
  <div
    style={{
      width: 1080,
      background: theme.bg2,
      border: `1.5px solid ${theme.primary}44`,
      borderRadius: 28,
      padding: 44,
      textAlign: "left",
      display: "flex",
      gap: 36,
      alignItems: "center",
      boxShadow: `0 40px 100px -40px #000, 0 0 60px -30px ${theme.primary}66`,
    }}
  >
    <Avatar theme={theme} url={avatarUrl} name={name} size={150} />
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 52, color: theme.text }}>{name}</div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 20,
            fontWeight: 700,
            color: theme.primary,
            border: `1px solid ${theme.primary}66`,
            borderRadius: 999,
            padding: "4px 14px",
          }}
        >
          ASP
        </div>
      </div>
      <div style={{ fontSize: 28, color: theme.muted, lineHeight: 1.4 }}>{tagline}</div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 22, color: theme.muted, marginTop: 16, opacity: 0.8 }}>
        #{agentId} · {serviceCount} service{serviceCount === 1 ? "" : "s"} · x402
      </div>
    </div>
  </div>
);

/** A chat bubble — used to stage the "agent hits a wall" moment. */
export const Bubble: React.FC<{
  theme: Palette;
  from: "user" | "agent";
  children: React.ReactNode;
  width?: number;
}> = ({ theme, from, children, width = 660 }) => (
  <div
    style={{
      width,
      alignSelf: from === "user" ? "flex-end" : "flex-start",
      background: from === "user" ? theme.bg2 : `${theme.primary}1f`,
      border: `1px solid ${from === "user" ? theme.muted + "33" : theme.primary + "55"}`,
      borderRadius: 20,
      borderBottomRightRadius: from === "user" ? 6 : 20,
      borderBottomLeftRadius: from === "user" ? 20 : 6,
      padding: "22px 26px",
      fontSize: 30,
      lineHeight: 1.35,
      color: theme.text,
      textAlign: "left",
    }}
  >
    {children}
  </div>
);

export const ServiceRow: React.FC<{
  theme: Palette;
  name: string;
  description: string;
  price: string;
  index: number;
}> = ({ theme, name, description, price, index }) => {
  const numeric = Number(price.replace(/[^0-9.]/g, ""));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 40,
        width: "100%",
        padding: "26px 34px",
        borderRadius: 20,
        background: theme.bg2,
        border: `1px solid ${theme.primary}2e`,
        textAlign: "left",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 36, color: theme.text }}>{name}</div>
        <div style={{ fontSize: 25, color: theme.muted, marginTop: 6 }}>{description}</div>
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 40,
          fontWeight: 700,
          color: theme.primary,
          whiteSpace: "nowrap",
        }}
      >
        {Number.isFinite(numeric) && numeric > 0 ? (
          <Counter to={numeric} delay={12 + index * 7} prefix="$" />
        ) : (
          price
        )}
      </div>
    </div>
  );
};

/**
 * The OKX wordmark. Always white — the stage is dark and the mark should read as
 * the platform's, not be tinted into the agent's palette.
 */
export const OkxMark: React.FC<{ width?: number; opacity?: number }> = ({ width = 210, opacity = 1 }) => (
  <Img
    src={OKX_LOGO_WHITE}
    alt="OKX"
    style={{ width, height: "auto", display: "block", opacity }}
  />
);

/** Browser chrome around the recorded live segment, so it reads as real usage. */
export const BrowserFrame: React.FC<{ theme: Palette; children: React.ReactNode }> = ({ theme, children }) => (
  <div
    style={{
      width: "100%",
      borderRadius: 18,
      overflow: "hidden",
      border: `1px solid ${theme.primary}44`,
      background: "#000",
      boxShadow: `0 50px 120px -50px #000`,
    }}
  >
    <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "14px 18px", background: theme.bg2 }}>
      {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
        <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />
      ))}
    </div>
    {children}
  </div>
);
