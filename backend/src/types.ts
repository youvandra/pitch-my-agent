// ─── Agent metadata (from the onchainos CLI) ─────────────────────────────────

export interface AgentService {
  serviceId?: string;
  name: string;
  description: string;
  /** "A2MCP" | "A2A" */
  type: string;
  /** Plain number as a string, USDT implied. */
  fee: string;
  endpoint: string;
}

export interface AgentProfile {
  agentId: string;
  name: string;
  description: string;
  avatarUrl: string;
  role: string;
  /** Marketplace listing status label, when available. */
  status?: string;
  services: AgentService[];
}

// ─── Brand palette (see PLAN §2b) ────────────────────────────────────────────

/**
 * Video color tokens. Derived from the target agent's avatar: deterministic
 * dominant-color extraction first, then optionally refined by a vision model
 * into a contrast-safe, harmonious set. Falls back to the theme default.
 */
export interface Palette {
  primary: string;
  accent: string;
  bg: string;
  bg2: string;
  text: string;
  muted: string;
  /** How this palette was produced — surfaced in the delivery for transparency. */
  source: "ai-refined" | "extracted" | "fallback";
}

export type VisualStyle = "terminal" | "playful" | "saas";

// ─── VideoSpec: the only thing the AI writes ─────────────────────────────────

export interface SceneCopy {
  /** Small label above the headline. */
  eyebrow?: string;
  headline: string;
  sub?: string;
}

export interface ServiceCard {
  name: string;
  description: string;
  /** Display string, e.g. "$1.00". */
  price: string;
}

/**
 * Fully describes a video. Consumed as props by the fixed Remotion template —
 * the LLM fills this in, it never emits TSX.
 */
export interface VideoSpec {
  agentId: string;
  agentName: string;
  avatarUrl: string;
  tagline: string;
  style: VisualStyle;
  theme: Palette;
  hook: SceneCopy;
  problem: SceneCopy;
  reveal: SceneCopy;
  services: ServiceCard[];
  cta: SceneCopy;
  /** Absolute/relative URL of the recorded live segment, when present. */
  liveSegmentUrl?: string;
  /** Total target duration in seconds. */
  durationSec: number;
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export type JobStage =
  | "queued"
  | "fetching_agent"
  | "building_spec"
  | "extracting_palette"
  | "recording_live"
  | "rendering"
  | "packaging"
  | "done"
  | "failed";

export interface GeneratePitchInput {
  agentId: string;
  style?: VisualStyle;
  /** Include the recorded live segment (premium tier). */
  includeLiveSegment?: boolean;
}

export interface Delivery {
  jobId: string;
  agentId: string;
  agentName: string;
  videoUrl: string;
  thumbnailUrl: string;
  gifUrl?: string;
  durationSec: number;
  resolution: string;
  style: VisualStyle;
  theme: Palette;
  spec: VideoSpec;
  createdAt: string;
}

export interface Job {
  jobId: string;
  input: GeneratePitchInput;
  tier: string;
  stage: JobStage;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  delivery?: Delivery;
}
