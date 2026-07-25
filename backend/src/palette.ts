// Per-agent brand palette, derived from the agent's avatar/logo (PLAN §2b).
//
// Hybrid by design:
//   1. deterministic extraction  → ground truth for the logo's real colors
//   2. optional vision refine    → harmonious, contrast-safe video palette
//   3. per-style fallback        → a video must never fail over color
import sharp from "sharp";
import { config, hasVision } from "./config.js";
import { getCachedPalette, cachePalette } from "./store.js";
import type { Palette, VisualStyle } from "./types.js";

const FALLBACKS: Record<VisualStyle, Palette> = {
  terminal: {
    primary: "#F2820C", accent: "#FBB454", bg: "#05070C", bg2: "#0E131E",
    text: "#F4F1E9", muted: "#93A0B4", source: "fallback",
  },
  playful: {
    primary: "#FF4D6D", accent: "#FFD166", bg: "#1A1033", bg2: "#2A1A4A",
    text: "#FFF8F0", muted: "#B8A9D9", source: "fallback",
  },
  saas: {
    primary: "#2563EB", accent: "#38BDF8", bg: "#FFFFFF", bg2: "#F1F5F9",
    text: "#0F172A", muted: "#64748B", source: "fallback",
  },
};

const hex = (r: number, g: number, b: number): string =>
  "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");

/** Relative luminance (WCAG). Used to keep text readable on the chosen bg. */
function luminance(color: string): number {
  const n = parseInt(color.slice(1), 16);
  const parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pull an avatar's identity colors out of it, most telling first.
 *
 * Neutrals (white card backgrounds, black outlines) are skipped: a logo on a
 * white square should yield its ink color, not white.
 *
 * Ranking is by salience, not area. Ranking by area returns whatever covers the
 * most pixels, which on an illustrated avatar is the background — BoredComic's
 * gave five shades of the same dark red and missed the vivid yellow wordmark
 * that is the logo's actual identity. Weighting by saturation, and preferring
 * mid lightness over near-black or near-white, puts a small bright mark ahead of
 * a large murky field.
 *
 * The sample is 160px rather than 64px for the same reason: at 64px a wordmark
 * is a handful of pixels and averages into its background before it can be
 * counted.
 */
export async function extractColors(imageBytes: Buffer, take = 5): Promise<string[]> {
  const { data, info } = await sharp(imageBytes)
    .resize(160, 160, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const buckets = new Map<string, { n: number; r: number; g: number; b: number; sat: number }>();
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    // Skip neutrals, and skip colours so dark they cannot serve as a brand
    // colour on a dark stage: ensureReadable would have to rewrite their
    // lightness so far that nothing of the original is left, which is how a
    // vivid red logo ended up as dusty pink.
    if (sat < 0.25 || max < 90 || min > 235) continue;
    // Quantize to 32-value steps so near-identical pixels group together.
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, sat: 0 };
    buckets.set(key, { n: cur.n + 1, r: cur.r + r, g: cur.g + g, b: cur.b + b, sat: cur.sat + sat });
  }

  return [...buckets.values()]
    .map((c) => {
      const r = Math.round(c.r / c.n);
      const g = Math.round(c.g / c.n);
      const b = Math.round(c.b / c.n);
      const sat = c.sat / c.n;
      const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
      return { hex: hex(r, g, b), score: c.n * sat * sat * (1 - Math.abs(lightness - 0.55)) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, take)
    .map((c) => c.hex);
}

/** Ask a vision model to turn the avatar + raw colors into a usable palette. */
async function refineWithVision(
  avatarUrl: string,
  extracted: string[],
  style: VisualStyle,
): Promise<Palette | null> {
  const prompt =
    `You are designing the color palette for a short promo video about this agent.\n` +
    `Dominant colors extracted from its logo: ${extracted.join(", ") || "(none)"}.\n` +
    `Visual style: ${style}.\n\n` +
    `Return ONLY minified JSON with keys primary, accent, bg, bg2, text, muted — all "#rrggbb".\n` +
    `Rules: keep the logo's identity in primary/accent; bg/bg2 are close backgrounds; ` +
    `text must have at least 7:1 contrast against bg; muted at least 4.5:1.`;

  const res = await fetch(`${config.sumopodBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.sumopodApiKey}`,
    },
    body: JSON.stringify({
      model: config.sumopodVisionModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: avatarUrl } },
          ],
        },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) return null;

  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = body.choices?.[0]?.message?.content ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;

  const p = JSON.parse(match[0]) as Record<string, string>;
  const ok = (v: string | undefined): v is string => !!v && /^#[0-9a-fA-F]{6}$/.test(v);
  if (!ok(p.primary) || !ok(p.accent) || !ok(p.bg) || !ok(p.bg2) || !ok(p.text) || !ok(p.muted)) {
    return null;
  }
  // Trust but verify: an unreadable palette is worse than the fallback.
  if (contrastRatio(p.text, p.bg) < 4.5) return null;

  return {
    primary: p.primary, accent: p.accent, bg: p.bg, bg2: p.bg2,
    text: p.text, muted: p.muted, source: "ai-refined",
  };
}

/** Convert #rrggbb to HSL, nudge lightness, convert back. */
function withLightness(color: string, targetL: number): string {
  const n = parseInt(color.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h *= 60;
  if (h < 0) h += 360;

  const c = (1 - Math.abs(2 * targetL - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = targetL - c / 2;
  const [r2, g2, b2] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return (
    "#" +
    [r2, g2, b2]
      .map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Hue of a colour in degrees, 0-360. */
function hueOf(color: string): number {
  const n = parseInt(color.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Shortest distance between two hues, 0-180. */
function hueDistance(a: string, b: string): number {
  const d = Math.abs(hueOf(a) - hueOf(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/** Rotate a colour's hue, keeping its saturation and lightness. */
function rotateHue(color: string, degrees: number): string {
  const n = parseInt(color.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = (hueOf(color) + degrees + 360) % 360;

  const c = (1 - Math.abs(2 * l - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r2, g2, b2] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return (
    "#" +
    [r2, g2, b2].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")
  );
}

/** Least hue separation before two colours stop reading as two colours. */
const MIN_ACCENT_HUE_SEPARATION = 40;
/**
 * Least contrast between primary and accent.
 *
 * Hue separation alone is not enough. Rotating a colour round the wheel keeps
 * its lightness, so the pair differs in hue while sitting at the same value —
 * they vibrate against each other and neither can lead, because nothing tells
 * the eye which is more important. Measured across twelve marketplace avatars,
 * synthesized accents came out between 1.03 and 1.63; a value step of 1.8 is
 * what makes one of them read as the highlight.
 */
const MIN_ACCENT_CONTRAST = 1.8;

/**
 * Push an accent away from the primary in lightness, without losing the
 * background legibility it already has.
 */
function separateValue(accent: string, primary: string, bg: string): string {
  if (contrastRatio(accent, primary) >= MIN_ACCENT_CONTRAST) return accent;

  // Search both directions rather than guessing one from the background. An
  // earlier version only walked away from the backdrop, which is a dead end on
  // a light stage: every lighter candidate fails legibility against the
  // background, so the loop returned the accent unchanged. The saas palette
  // came out at 1.01 — two colours 163 degrees apart and indistinguishable.
  // A light stage leaves only a narrow band of usable lightness — everything
  // pale enough to sit near the primary is also too pale to read on the
  // backdrop — so the search runs to near-black at one end and near-white at
  // the other rather than stopping at comfortable mid-tones.
  let best = accent;
  for (let i = 1; i <= 22; i++) {
    for (const lightness of [0.5 + i * 0.021, 0.5 - i * 0.021]) {
      if (lightness < 0.06 || lightness > 0.96) continue;
      const candidate = withLightness(accent, lightness);
      if (contrastRatio(candidate, bg) < 3) continue;
      if (contrastRatio(candidate, primary) >= MIN_ACCENT_CONTRAST) return candidate;
      if (contrastRatio(candidate, primary) > contrastRatio(best, primary)) best = candidate;
    }
  }
  return best;
}

/**
 * Choose an accent that is actually a second colour.
 *
 * Taking the two most common colours from a logo usually takes two shades of
 * the same one: BoredComic's mark gave #cc5c63 and #ae686c, 1.06 apart in
 * contrast and 6 degrees apart in hue. Every accent in the video — eyebrows,
 * prices, rules, badges — then collapsed onto the primary, and the whole piece
 * read as one flat colour.
 *
 * So the accent is the most common candidate that is far enough round the wheel
 * to be distinguishable. When a logo genuinely is monochrome, rotating the
 * primary invents the second colour rather than repeating the first.
 */
function pickAccent(primary: string, candidates: string[], bg: string): string {
  const distinct = candidates.find(
    (c) => hueDistance(c, primary) >= MIN_ACCENT_HUE_SEPARATION,
  );
  // 150 degrees: clearly a different colour, without the vibration of an exact
  // complement sitting next to the primary.
  const hue = ensureReadable(distinct ?? rotateHue(primary, 150), bg);
  return separateValue(hue, primary, bg);
}

/**
 * Force a brand color to be legible against the background.
 *
 * A logo color is chosen for a logo, not for type on a dark stage: BoredComic's
 * mark yields a near-black red that vanishes against the backdrop. Keep the hue
 * — that is the brand — and raise lightness until it actually reads.
 */
function ensureReadable(color: string, bg: string, minRatio = 4.5): string {
  if (contrastRatio(color, bg) >= minRatio) return color;
  const bgIsDark = luminance(bg) < 0.5;
  for (let i = 1; i <= 18; i++) {
    // Walk away from the background: lighter on a dark stage, darker on a light one.
    const target = bgIsDark ? 0.3 + i * 0.035 : 0.7 - i * 0.035;
    const candidate = withLightness(color, Math.min(0.95, Math.max(0.05, target)));
    if (contrastRatio(candidate, bg) >= minRatio) return candidate;
  }
  return bgIsDark ? "#F4F1E9" : "#0F172A";
}

/**
 * Apply the palette's guarantees, whatever produced it.
 *
 * The vision model proposes; it does not decide. Left to itself it returns
 * plausible-looking pairs that fail in motion — two colours at the same value,
 * or an accent that vanishes on the backdrop — and because its output used to be
 * taken verbatim, the rules below only ever applied when no model was
 * configured. That is backwards: a model is one more source of a proposal, and
 * every proposal gets the same treatment.
 */
function enforceGuarantees(p: Palette): Palette {
  const primary = ensureReadable(p.primary, p.bg);
  const accent =
    hueDistance(p.accent, primary) >= MIN_ACCENT_HUE_SEPARATION
      ? separateValue(ensureReadable(p.accent, p.bg), primary, p.bg)
      : pickAccent(primary, [], p.bg);
  return { ...p, primary, accent };
}

/**
 * Build the palette for an agent. Never throws — every failure path degrades to
 * the style's default palette.
 */
export async function buildPalette(
  agentId: string,
  avatarUrl: string,
  style: VisualStyle,
): Promise<Palette> {
  const cacheKey = `${agentId}:${style}`;
  const cached = getCachedPalette(cacheKey);
  if (cached) return cached;

  const fallback = FALLBACKS[style];
  let palette = fallback;

  try {
    let extracted: string[] = [];
    if (avatarUrl) {
      const res = await fetch(avatarUrl);
      if (res.ok) {
        extracted = await extractColors(Buffer.from(await res.arrayBuffer()));
      }
    }

    if (extracted.length > 0) {
      if (hasVision()) {
        palette = (await refineWithVision(avatarUrl, extracted, style)) ?? {
          ...fallback,
          primary: ensureReadable(extracted[0], fallback.bg),
          accent: pickAccent(extracted[0], extracted.slice(1), fallback.bg),
          source: "extracted",
        };
      } else {
        // No vision model: keep the style's proven backdrop and only swap in the
        // logo's own hues, so contrast stays predictable.
        palette = {
          ...fallback,
          primary: ensureReadable(extracted[0], fallback.bg),
          accent: pickAccent(extracted[0], extracted.slice(1), fallback.bg),
          source: "extracted",
        };
      }
    }
  } catch (err) {
    console.error(`palette build failed for agent ${agentId}, using fallback:`, err);
    palette = fallback;
  }

  palette = enforceGuarantees(palette);
  cachePalette(cacheKey, palette);
  return palette;
}
