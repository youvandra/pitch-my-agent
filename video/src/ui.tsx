import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadDisplay } from "@remotion/google-fonts/Sora";
import { loadFont as loadBody } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import type { Palette } from "./schema";

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

export const EASE = (t: number): number => 1 - (1 - t) ** 3;

/** Progress 0→1 over `dur` frames starting at `delay`. */
export function useProg(delay = 0, dur = 24): number {
  const frame = useCurrentFrame();
  return interpolate(frame - delay, [0, dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
}

/** Full-bleed stage with the palette's two-tone backdrop. */
export const Stage: React.FC<{ theme: Palette; children: React.ReactNode }> = ({ theme, children }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(120% 90% at 50% 0%, ${theme.bg2} 0%, ${theme.bg} 60%)`,
      color: theme.text,
      fontFamily: FONT_BODY,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 96,
    }}
  >
    {children}
  </AbsoluteFill>
);

/** Rises and fades in. The workhorse entrance. */
export const Rise: React.FC<{
  delay?: number;
  distance?: number;
  children: React.ReactNode;
}> = ({ delay = 0, distance = 28, children }) => {
  const p = useProg(delay, 22);
  return (
    <div style={{ opacity: p, transform: `translateY(${interpolate(p, [0, 1], [distance, 0])}px)` }}>
      {children}
    </div>
  );
};

/** Springy pop, for badges and prices. */
export const Pop: React.FC<{ delay?: number; children: React.ReactNode }> = ({ delay = 0, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 180 } });
  return <div style={{ transform: `scale(${interpolate(s, [0, 1], [0.8, 1])})`, opacity: s }}>{children}</div>;
};

export const Eyebrow: React.FC<{ theme: Palette; children: React.ReactNode }> = ({ theme, children }) => (
  <div
    style={{
      fontFamily: FONT_MONO,
      fontSize: 22,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: theme.accent,
      fontWeight: 600,
      marginBottom: 18,
    }}
  >
    {children}
  </div>
);

export const H1: React.FC<{ theme: Palette; size?: number; children: React.ReactNode }> = ({
  theme,
  size = 104,
  children,
}) => (
  <div
    style={{
      fontFamily: FONT_DISPLAY,
      fontWeight: 800,
      fontSize: size,
      lineHeight: 1.04,
      letterSpacing: "-0.025em",
      color: theme.text,
    }}
  >
    {children}
  </div>
);

export const Sub: React.FC<{ theme: Palette; children: React.ReactNode }> = ({ theme, children }) => (
  <div style={{ fontSize: 34, lineHeight: 1.45, color: theme.muted, marginTop: 24, maxWidth: 1080 }}>
    {children}
  </div>
);

/** Agent avatar in a rounded card. Falls back to a monogram when missing. */
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
      borderRadius: size * 0.22,
      overflow: "hidden",
      background: theme.bg2,
      border: `2px solid ${theme.primary}`,
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
      <img src={url} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    ) : (
      name.slice(0, 1).toUpperCase()
    )}
  </div>
);

export const ServiceRow: React.FC<{
  theme: Palette;
  name: string;
  description: string;
  price: string;
}> = ({ theme, name, description, price }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 40,
      padding: "28px 36px",
      borderRadius: 18,
      background: theme.bg2,
      border: `1px solid ${theme.primary}33`,
    }}
  >
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 38, color: theme.text }}>{name}</div>
      <div style={{ fontSize: 26, color: theme.muted, marginTop: 8 }}>{description}</div>
    </div>
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 40,
        fontWeight: 700,
        color: theme.primary,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {price}
    </div>
  </div>
);

/** Browser chrome around the recorded live segment, so it reads as real usage. */
export const BrowserFrame: React.FC<{ theme: Palette; children: React.ReactNode }> = ({ theme, children }) => (
  <div
    style={{
      width: "100%",
      borderRadius: 16,
      overflow: "hidden",
      border: `1px solid ${theme.primary}44`,
      background: "#000",
    }}
  >
    <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "14px 18px", background: theme.bg2 }}>
      {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
        <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />
      ))}
    </div>
    {children}
  </div>
);
