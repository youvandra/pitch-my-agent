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

  priceAnimatedUsd: process.env.PRICE_ANIMATED_USD || "2.00",
  priceLiveProofUsd: process.env.PRICE_LIVE_PROOF_USD || "4.00",
  priceLiveProofPlusUsd: process.env.PRICE_LIVE_PROOF_PLUS_USD || "6.00",
  // Highest target-service fee each live tier pays for. A service above the top
  // ceiling is refused before payment rather than delivered without its live
  // segment — see pricing.ts.
  maxServiceFeeLiveProofUsd: process.env.MAX_SERVICE_FEE_LIVE_PROOF_USD || "1.00",
  maxServiceFeeLiveProofPlusUsd: process.env.MAX_SERVICE_FEE_LIVE_PROOF_PLUS_USD || "3.00",

  // AI layer. Without a key the deterministic fallback runs, so a video is
  // still produced — just with generic copy and an extraction-only palette.
  sumopodApiKey: process.env.SUMOPOD_API_KEY || "",
  sumopodBaseUrl: process.env.SUMOPOD_BASE_URL || "https://ai.sumopod.com/v1",
  sumopodModel: process.env.SUMOPOD_MODEL || "deepseek-v4-flash",
  // Vision model for palette refinement. Empty → extraction-only palette.
  sumopodVisionModel: process.env.SUMOPOD_VISION_MODEL || "",

  // Voiceover (ElevenLabs). Without a key the layer no-ops and the video
  // renders silent — a missing voice must never fail a paid render.
  // Kill switch for test renders: narration is the only part of the pipeline
  // that spends money per run, so it can be turned off while iterating on the
  // visuals without touching the code that uses it.
  voiceEnabled: process.env.VOICE_ENABLED !== "false",
  elevenApiKey: process.env.ELEVENLABS_API_KEY || "",
  // Optional: leave empty to auto-resolve a voice from the account (see
  // voice.ts). ElevenLabs retires its current default voices after 2026-12-31,
  // so pinning a legacy premade id is a scheduled outage.
  elevenVoiceId: process.env.ELEVENLABS_VOICE_ID || "",
  elevenModel: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
  // Default narrator voice when the caller does not pick one.
  voiceGender: (process.env.ELEVENLABS_VOICE_GENDER || "male") as "male" | "female" | "neutral",
  // PCM sample rate. 44100 needs a Pro plan; 22050 works on lower tiers and is
  // ample for narration. Downgrades automatically if the plan rejects it.
  elevenSampleRate: Number(process.env.ELEVENLABS_SAMPLE_RATE || "22050"),

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
  // Delete every other job's output before rendering. Only ever for local
  // iteration — in production this would destroy deliveries buyers paid for.
  prunePreviousRenders: process.env.PRUNE_PREVIOUS_RENDERS === "true",

  // Live-proof capture (macOS only). Needs Screen Recording permission for the
  // process that runs it, and Playwright installed.
  liveCaptureEnabled: process.env.LIVE_CAPTURE_ENABLED === "true",
  // avfoundation device index for the display; `ffmpeg -f avfoundation
  // -list_devices true -i ""` prints it. 4 on this machine.
  captureScreenIndex: process.env.CAPTURE_SCREEN_INDEX || "2",
  ffmpegBin: process.env.FFMPEG_BIN || "ffmpeg",
  ffprobeBin: process.env.FFPROBE_BIN || "ffprobe",
  // Where the okx-pay MCP wrapper records each settled call. The live segment
  // reads the delivery from there instead of OCR-ing it off the recording.
  okxPayReceiptDir: process.env.OKX_PAY_RECEIPT_DIR || `${process.env.HOME}/.okx-pay`,
  // How long the recording waits for the agent to settle a paid call before
  // giving up and cutting what it has.
  liveCallTimeoutMs: Number(process.env.LIVE_CALL_TIMEOUT_MS || 180_000),
  // How long to wait for the paid agent to actually produce its artifact after
  // settlement. Payment is instant; the work is not.
  deliveryTimeoutMs: Number(process.env.DELIVERY_TIMEOUT_MS || 240_000),
  claudeAppName: process.env.CLAUDE_APP_NAME || "Claude",
  // cliclick sends keystrokes via CGEvent — Accessibility only, no Apple Events
  // (Automation entitlement is unobtainable for this background process).
  cliclickBin: process.env.CLICLICK_BIN || "/opt/homebrew/bin/cliclick",
  // python3 with pyobjc-framework-Quartz, for read-only window bounds.
  pythonBin: process.env.PYTHON_BIN || "python3",
};

export const hasAi = (): boolean => !!config.sumopodApiKey;
export const hasVision = (): boolean => !!config.sumopodApiKey && !!config.sumopodVisionModel;
export const hasVoice = (): boolean => config.voiceEnabled && !!config.elevenApiKey;
