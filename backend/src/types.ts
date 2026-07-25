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

/** The single service this ASP sells. */
export type TierId = "animated";

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
export type SceneKey = "hook" | "problem" | "reveal" | "demo" | "services" | "cta";

// ─── Demo flow: one call, staged ─────────────────────────────────────────────

/**
 * What the delivered artifact looks like, so the demo scene can stage a result
 * that resembles what this agent actually returns — panels for a comic agent,
 * a chart for a market one — instead of one generic response card for all.
 */
export type ResultKind = "image-grid" | "report" | "chart" | "text";

/**
 * The staged x402 exchange at the centre of the video.
 *
 * This is the domain knowledge the video trades on: an OKX.ai service is bought
 * mid-conversation over x402, and showing that loop — request, 402 challenge,
 * settlement, delivery — is what separates this from a generic promo template.
 * The service name and fee are the agent's real listing data; the session
 * itself is openly a staged illustration, and the scene labels it as such.
 */
export interface DemoFlow {
  /** The concrete request a buyer would send. Carries every input needed. */
  request: string;
  /** Real fee of the demoed service, display string, e.g. "$0.50". */
  price: string;
  /** Name of the demoed service, from the listing. */
  serviceName: string;
  resultKind: ResultKind;
  /** 2-4 short fragments naming what came back (panel titles, findings, series). */
  resultLines: string[];
  /** One line naming the artifact, e.g. "3-page comic · PDF + reader link". */
  resultCaption?: string;
}

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
  /** The staged call at the heart of the video. */
  demoFlow?: DemoFlow;
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
  | "recording_voice"
  | "rendering"
  | "packaging"
  | "done"
  | "failed";

export interface GeneratePitchInput {
  agentId: string;
  style?: VisualStyle;
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
