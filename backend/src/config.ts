import "dotenv/config";
import path from "node:path";

export const config = {
  port: Number(process.env.PORT || "3007"),
  nodeEnv: process.env.NODE_ENV || "development",
  // Public origin for absolute URLs in deliveries. Empty → relative URLs.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""),

  // x402 seller side. XLAYER_* are merchant API credentials used by the OKX
  // facilitator to settle incoming payments — unrelated to the buyer-side
  // agentic-wallet session used by the demo caller.
  x402Mode: (process.env.X402_MODE || "off") as "off" | "demo" | "on",
  x402PayTo: process.env.X402_PAY_TO || "",
  xlayerApiKey: process.env.XLAYER_API_KEY || "",
  xlayerSecretKey: process.env.XLAYER_SECRET_KEY || "",
  xlayerPassphrase: process.env.XLAYER_PASSPHRASE || "",

  priceStandardUsd: process.env.PRICE_STANDARD_USD || "2.00",
  pricePremiumUsd: process.env.PRICE_PREMIUM_USD || "4.00",

  // AI layer. Without a key the deterministic fallback runs, so a video is
  // still produced — just with generic copy and an extraction-only palette.
  sumopodApiKey: process.env.SUMOPOD_API_KEY || "",
  sumopodBaseUrl: process.env.SUMOPOD_BASE_URL || "https://ai.sumopod.com/v1",
  sumopodModel: process.env.SUMOPOD_MODEL || "deepseek-v4-flash",
  // Vision model for palette refinement. Empty → extraction-only palette.
  sumopodVisionModel: process.env.SUMOPOD_VISION_MODEL || "",

  // Voiceover (ElevenLabs). Without a key the layer no-ops and the video
  // renders silent — a missing voice must never fail a paid render.
  elevenApiKey: process.env.ELEVENLABS_API_KEY || "",
  // Optional: leave empty to auto-resolve a voice from the account (see
  // voice.ts). ElevenLabs retires its current default voices after 2026-12-31,
  // so pinning a legacy premade id is a scheduled outage.
  elevenVoiceId: process.env.ELEVENLABS_VOICE_ID || "",
  elevenModel: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",

  // Tempo of the generated backing track. Scene cuts are quantized to bars at
  // this tempo (see docs/VIDEO_CRAFT.md).
  bpm: Number(process.env.BPM || "112"),

  // Absolute path: a spawned process does not inherit the interactive PATH.
  onchainosBin: process.env.ONCHAINOS_BIN || "onchainos",

  videoProjectDir: path.resolve(process.env.VIDEO_PROJECT_DIR || "../video"),
  outputDir: process.env.OUTPUT_DIR || "/tmp/pitch-my-agent",
  outputTtlMs: Number(process.env.OUTPUT_TTL_MS || "604800000"),
  renderTimeoutMs: Number(process.env.RENDER_TIMEOUT_MS || "900000"),
  renderConcurrency: Number(process.env.RENDER_CONCURRENCY || "1"),
};

export const hasAi = (): boolean => !!config.sumopodApiKey;
export const hasVision = (): boolean => !!config.sumopodApiKey && !!config.sumopodVisionModel;
export const hasVoice = (): boolean => !!config.elevenApiKey;
