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

export const narrationLineSchema = z.object({
  scene: z.enum(["hook", "problem", "reveal", "demo", "services", "cta"]),
  text: z.string(),
  audioUrl: z.string(),
  durationSec: z.number(),
});

export const problemExchangeSchema = z.object({
  user: z.string(),
  agent: z.string(),
});

export const demoFlowSchema = z.object({
  request: z.string(),
  price: z.string(),
  serviceName: z.string(),
  resultKind: z.enum(["image-grid", "report", "chart", "text"]),
  resultLines: z.array(z.string()),
  resultCaption: z.string().optional(),
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
  problemExchange: problemExchangeSchema,
  reveal: sceneCopySchema,
  services: z.array(serviceCardSchema),
  cta: sceneCopySchema,
  demoFlow: demoFlowSchema.optional(),
  musicUrl: z.string().optional(),
  narration: z.array(narrationLineSchema).optional(),
  bpm: z.number(),
  durationSec: z.number(),
});

export type Palette = z.infer<typeof paletteSchema>;
export type DemoFlow = z.infer<typeof demoFlowSchema>;
export type SceneCopy = z.infer<typeof sceneCopySchema>;
export type ServiceCard = z.infer<typeof serviceCardSchema>;
export type NarrationLine = z.infer<typeof narrationLineSchema>;
export type VideoSpec = z.infer<typeof videoSpecSchema>;

export const FPS = 30;

/** Scene weights. Durations are derived from the spec's total length. */
export const SCENE_WEIGHTS = {
  hook: 0.16,
  problem: 0.16,
  reveal: 0.15,
  // The staged x402 call is the argument of the whole video — it gets the
  // largest share of the runtime.
  demo: 0.25,
  services: 0.17,
  cta: 0.11,
} as const;

export type SceneName = keyof typeof SCENE_WEIGHTS;

/** Breathing room after a spoken line, mirroring the backend's VO_PAD_SEC. */
const VO_PAD_SEC = 0.55;

/**
 * Cuts are quantized to HALF bars, not whole ones.
 *
 * A whole bar at 112 BPM is 2.13s, so rounding a 3.4s line up to bars leaves
 * almost three seconds of nothing happening — which is exactly what made the
 * first cut feel slow. Half bars still land on the beat while cutting the worst
 * case slack to about a second.
 */
const QUANTIZE_BEATS = 2;

/**
 * Scene lengths in frames.
 *
 * Two modes, both landing every cut on a bar boundary so the edit sits on the
 * beat rather than at an arbitrary frame:
 *
 * - **Narrated** — each scene is as long as its spoken line needs, rounded up to
 *   a whole bar. The voice drives the pacing; the grid keeps the cuts musical.
 * - **Silent** — the total is split by weight, then each scene is snapped to the
 *   grid the same way.
 *
 * A scene with no live segment collapses to zero and its share is redistributed,
 * so the video never sits on a dead gap.
 */
export function sceneFrames(spec: VideoSpec): Record<SceneName, number> {
  const unit = Math.round((60 / spec.bpm) * QUANTIZE_BEATS * FPS);
  const snapUp = (frames: number): number =>
    Math.max(unit * 2, Math.ceil(frames / unit) * unit);

  const out = {} as Record<SceneName, number>;

  const hasDemo = !!spec.demoFlow;
  const narration = spec.narration ?? [];
  if (narration.length > 0) {
    const spoken = new Map(narration.map((n) => [n.scene, n.durationSec]));
    for (const key of Object.keys(SCENE_WEIGHTS) as SceneName[]) {
      if (key === "demo" && !hasDemo) {
        out[key] = 0;
        continue;
      }
      const sec = spoken.get(key);
      // A scene nobody narrates still needs to breathe: give it one bar.
      out[key] = sec ? snapUp(Math.round((sec + VO_PAD_SEC) * FPS)) : unit * 2;
    }
    return out;
  }

  const total = Math.round(spec.durationSec * FPS);
  const weights: Record<SceneName, number> = { ...SCENE_WEIGHTS };
  if (!hasDemo) {
    // Redistribute the demo's share so the piece keeps its length.
    const spare = weights.demo;
    const rest = 1 - spare;
    for (const key of Object.keys(weights) as SceneName[]) {
      weights[key] = key === "demo" ? 0 : weights[key] + (weights[key] / rest) * spare;
    }
  }
  for (const key of Object.keys(weights) as SceneName[]) {
    out[key] = weights[key] === 0 ? 0 : snapUp(Math.round(total * weights[key]));
  }
  return out;
}

/** Total composition length, derived from the scene grid so nothing is clipped. */
export function totalFrames(spec: VideoSpec): number {
  const frames = sceneFrames(spec);
  return Object.values(frames).reduce((a, b) => a + b, 0);
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
  problemExchange: {
    user: "Can you handle this for me?",
    agent: "I can't do that on my own.",
  },
  reveal: { eyebrow: "Meet", headline: "Example Agent", sub: "2 services, pay-per-call over x402." },
  services: [
    { name: "Service One", description: "What the first service returns.", price: "$1.00" },
    { name: "Service Two", description: "What the second service returns.", price: "$3.00" },
  ],
  cta: { eyebrow: "Try it", headline: "Agent #6006", sub: "Find it on OKX.ai and call it from your own agent." },
  bpm: 112,
  demoFlow: {
    request: "Make a 3-page sci-fi comic: a robot chef enters a cooking contest.",
    price: "$0.50",
    serviceName: "Generate Comic Basic",
    resultKind: "image-grid",
    resultLines: ["Page 1 — The entry", "Page 2 — The disaster", "Page 3 — The win"],
    resultCaption: "3-page comic · PDF + reader link",
  },
  durationSec: 60,
};
