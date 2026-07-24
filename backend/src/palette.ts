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
 * Pull the most saturated non-neutral colors out of an avatar. Neutrals (white
 * card backgrounds, black outlines) are skipped: a logo on a white square should
 * yield its ink color, not white.
 */
export async function extractColors(imageBytes: Buffer, take = 5): Promise<string[]> {
  const { data, info } = await sharp(imageBytes)
    .resize(64, 64, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.25 || max < 32 || min > 235) continue; // skip neutrals
    // Quantize to 32-value steps so near-identical pixels group together.
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    buckets.set(key, { n: cur.n + 1, r: cur.r + r, g: cur.g + g, b: cur.b + b });
  }

  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, take)
    .map((c) => hex(Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)));
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
          accent: ensureReadable(extracted[1] ?? extracted[0], fallback.bg),
          source: "extracted",
        };
      } else {
        // No vision model: keep the style's proven backdrop and only swap in the
        // logo's own hues, so contrast stays predictable.
        palette = {
          ...fallback,
          primary: ensureReadable(extracted[0], fallback.bg),
          accent: ensureReadable(extracted[1] ?? extracted[0], fallback.bg),
          source: "extracted",
        };
      }
    }
  } catch (err) {
    console.error(`palette build failed for agent ${agentId}, using fallback:`, err);
    palette = fallback;
  }

  cachePalette(cacheKey, palette);
  return palette;
}
