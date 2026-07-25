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

/** The three marketplace services this ASP sells, one endpoint each. */
export type TierId = "animated" | "live-proof" | "live-proof-plus";

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

// ─── Narration ───────────────────────────────────────────────────────────────

/** Narrator voice to use. Resolved to a concrete ElevenLabs voice at runtime. */
export type VoiceGender = "male" | "female" | "neutral";

/** Scenes that can carry a spoken line. Mirrors the Remotion scene order. */
export type SceneKey = "hook" | "problem" | "reveal" | "live" | "services" | "cta";

/**
 * One synthesized voiceover line. `durationSec` is measured from the returned
 * PCM, not estimated — scene timing is derived from it, so it has to be exact.
 */
export interface NarrationLine {
  scene: SceneKey;
  text: string;
  audioUrl: string;
  durationSec: number;
}

// ─── VideoSpec: the only thing the AI writes ─────────────────────────────────

export interface SceneCopy {
  /** Small label above the headline. */
  eyebrow?: string;
  headline: string;
  sub?: string;
}

/** The two-message exchange staged in the problem scene. */
export interface ProblemExchange {
  user: string;
  agent: string;
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
  /** Dialogue for the problem scene — written per agent, not boilerplate. */
  problemExchange: ProblemExchange;
  reveal: SceneCopy;
  services: ServiceCard[];
  cta: SceneCopy;
  /** Absolute/relative URL of the recorded live segment, when present. */
  liveSegmentUrl?: string;
  /**
   * The settled payment behind the live segment, shown as a receipt card.
   *
   * Claude Desktop runs a paid request as a background session and stays on its
   * home screen, so the work itself cannot be filmed without also filming the
   * operator's private screen. These figures come from okx-pay's receipt, which
   * means the proof survives without the camera following anything.
   */
  liveProof?: {
    amountUsd: number;
    asset: string;
    network: string;
    wallet?: string;
    serviceName?: string;
    agentId?: string;
  };
  /**
   * A concrete, ready-to-run request for the agent's first service.
   *
   * The marketplace's own "Use now" text only names the service, so the agent
   * receiving it has to ask a follow-up ("which wallet?", "a comic about
   * what?") before it can do anything. The live segment is supposed to show
   * work being done, not an agent asking for clarification — so the pasted
   * prompt carries the specifics with it.
   */
  demoRequest?: string;
  /** Backing track, synthesized per job at `bpm` so cuts land on its beat. */
  musicUrl?: string;
  /**
   * Spoken lines, one per scene. Empty when no voice provider is configured —
   * the video then renders silent rather than failing.
   */
  narration?: NarrationLine[];
  /**
   * Tempo of the backing track. Scene cuts are quantized to bars at this tempo,
   * so the timing is authored rather than arbitrary (see docs/VIDEO_CRAFT.md).
   */
  bpm: number;
  /** Total target duration in seconds. Grows to fit the narration. */
  durationSec: number;
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export type JobStage =
  | "queued"
  | "fetching_agent"
  | "building_spec"
  | "extracting_palette"
  | "recording_live"
  | "recording_voice"
  | "rendering"
  | "packaging"
  | "done"
  | "failed";

export interface GeneratePitchInput {
  agentId: string;
  /**
   * Which of the agent's services to demonstrate. Drives the price (its fee is
   * passed through), the written brief, and the service called on camera.
   * Omitted → the cheapest one.
   */
  serviceId?: string;
  style?: VisualStyle;
  /** Include the recorded live segment (premium tier). */
  includeLiveSegment?: boolean;
  /** Narrate the video. Default true; ignored when no voice provider is set. */
  voiceover?: boolean;
  /** Narrator voice. Default comes from ELEVENLABS_VOICE_GENDER. */
  voice?: VoiceGender;
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
