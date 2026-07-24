import { z } from "zod";

// Mirrors the backend `VideoSpec` type. Remotion validates incoming --props
// against this, so a malformed spec fails loudly at bundle time instead of
// rendering a broken video.

export const paletteSchema = z.object({
  primary: z.string(),
  accent: z.string(),
  bg: z.string(),
  bg2: z.string(),
  text: z.string(),
  muted: z.string(),
  source: z.enum(["ai-refined", "extracted", "fallback"]).optional(),
});

export const sceneCopySchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  sub: z.string().optional(),
});

export const serviceCardSchema = z.object({
  name: z.string(),
  description: z.string(),
  price: z.string(),
});

export const videoSpecSchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  avatarUrl: z.string(),
  tagline: z.string(),
  style: z.enum(["terminal", "playful", "saas"]),
  theme: paletteSchema,
  hook: sceneCopySchema,
  problem: sceneCopySchema,
  reveal: sceneCopySchema,
  services: z.array(serviceCardSchema),
  cta: sceneCopySchema,
  liveSegmentUrl: z.string().optional(),
  durationSec: z.number(),
});

export type Palette = z.infer<typeof paletteSchema>;
export type SceneCopy = z.infer<typeof sceneCopySchema>;
export type ServiceCard = z.infer<typeof serviceCardSchema>;
export type VideoSpec = z.infer<typeof videoSpecSchema>;

export const FPS = 30;

/** Scene weights. Durations are derived from the spec's total length. */
export const SCENE_WEIGHTS = {
  hook: 0.16,
  problem: 0.16,
  reveal: 0.16,
  live: 0.22,
  services: 0.2,
  cta: 0.1,
} as const;

export type SceneName = keyof typeof SCENE_WEIGHTS;

/**
 * Split the total duration across scenes. Without a live segment its share is
 * redistributed proportionally, so the video never leaves a dead gap.
 */
export function sceneFrames(spec: VideoSpec): Record<SceneName, number> {
  const total = Math.round(spec.durationSec * FPS);
  const hasLive = !!spec.liveSegmentUrl;
  const weights: Record<SceneName, number> = { ...SCENE_WEIGHTS };
  if (!hasLive) {
    const spare = weights.live;
    const rest = 1 - spare;
    for (const key of Object.keys(weights) as SceneName[]) {
      weights[key] = key === "live" ? 0 : weights[key] + (weights[key] / rest) * spare;
    }
  }
  const out = {} as Record<SceneName, number>;
  for (const key of Object.keys(weights) as SceneName[]) {
    out[key] = Math.round(total * weights[key]);
  }
  return out;
}

export const DEFAULT_SPEC: VideoSpec = {
  agentId: "6006",
  agentName: "Example Agent",
  avatarUrl: "",
  tagline: "An example agent used for the Remotion studio preview.",
  style: "terminal",
  theme: {
    primary: "#F2820C",
    accent: "#FBB454",
    bg: "#05070C",
    bg2: "#0E131E",
    text: "#F4F1E9",
    muted: "#93A0B4",
    source: "fallback",
  },
  hook: { eyebrow: "On OKX.ai", headline: "Example Agent", sub: "What this agent does, in one line." },
  problem: {
    eyebrow: "The problem",
    headline: "Your agent hits a wall.",
    sub: "Some work needs a specialist. Paying one should take a single call.",
  },
  reveal: { eyebrow: "Meet", headline: "Example Agent", sub: "2 services, pay-per-call over x402." },
  services: [
    { name: "Service One", description: "What the first service returns.", price: "$1.00" },
    { name: "Service Two", description: "What the second service returns.", price: "$3.00" },
  ],
  cta: { eyebrow: "Try it", headline: "Agent #6006", sub: "Find it on OKX.ai and call it from your own agent." },
  durationSec: 60,
};
