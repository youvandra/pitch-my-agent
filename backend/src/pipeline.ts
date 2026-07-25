// End-to-end job pipeline: agent metadata → palette → spec → (live segment) →
// render → delivery. Runs in the background; the buyer polls `get_job`.
import path from "node:path";
import { config } from "./config.js";
import { fetchAgent } from "./okx.js";
import { buildPalette } from "./palette.js";
import { buildSpec, buildScript } from "./spec.js";
import { synthesizeNarration } from "./voice.js";
import { writeMusic } from "./music.js";
import { renderVideo } from "./render.js";
import { setStage, completeJob, failJob, getJob } from "./store.js";
import type { AgentProfile, Delivery, GeneratePitchInput, NarrationLine, VisualStyle } from "./types.js";

export interface TierSpec {
  id: string;
  durationSec: number;
}

export const TIERS: Record<string, TierSpec> = {
  animated: { id: "animated", durationSec: 60 },
};

/** Rough ETA so a caller knows how long to poll for. */
export function etaSeconds(): number {
  return 240;
}

function publicUrl(jobId: string, file: string): string {
  const rel = `/videos/${jobId}/${file}`;
  return config.publicBaseUrl ? `${config.publicBaseUrl}${rel}` : rel;
}

/** Breathing room around a spoken line, so narration never butts into a cut. */
const VO_PAD_SEC = 0.55;
/** Cuts snap to half bars — see sceneFrames() in video/src/schema.ts. */
const QUANTIZE_BEATS = 2;
/** Must match FPS in video/src/schema.ts. */
const FPS = 30;

/**
 * Total duration once narration exists.
 *
 * Each scene is its spoken line rounded up to a whole bar — that is what keeps
 * cuts on the beat. The arithmetic runs in whole frames, exactly as
 * `sceneFrames()` does in the template: computing it in float seconds instead
 * drifts by a frame per bar, and the delivery would then disagree with the file
 * it describes.
 */
function totalWithNarration(bpm: number, narration: NarrationLine[]): number {
  const unit = Math.round((60 / bpm) * QUANTIZE_BEATS * FPS);
  const frames = narration.reduce((sum, line) => {
    const needed = Math.round((line.durationSec + VO_PAD_SEC) * FPS);
    return sum + Math.max(unit * 2, Math.ceil(needed / unit) * unit);
  }, 0);
  return frames / FPS;
}

export async function runPipeline(jobId: string, input: GeneratePitchInput, tier: TierSpec): Promise<void> {
  try {
    const style: VisualStyle = input.style ?? "terminal";

    setStage(jobId, "fetching_agent");
    const agent = await fetchAgent(input.agentId);

    setStage(jobId, "extracting_palette");
    const theme = await buildPalette(agent.agentId, agent.avatarUrl, style);

    setStage(jobId, "building_spec");
    const spec = await buildSpec(agent, style, theme, tier.durationSec);

    // The model may pick a style that fits the agent's character better than
    // the default. The palette's backdrop comes from the style, so honouring
    // that choice means rebuilding the theme — but never over an explicit
    // caller choice: the buyer outranks the model.
    const planned = spec.scenePlan?.style;
    if (!input.style && planned && planned !== style) {
      spec.style = planned;
      spec.theme = await buildPalette(agent.agentId, agent.avatarUrl, planned);
    }

    if (input.voiceover !== false) {
      setStage(jobId, "recording_voice");
      const script = await buildScript(spec, agent);
      const narration = await synthesizeNarration(jobId, script, input.voice);
      if (narration.length > 0) {
        spec.narration = narration;
        // Once narrated, the voice sets the length: each scene is its line
        // rounded up to a whole bar, and the renderer derives the composition
        // from exactly that. Reporting the tier's nominal duration instead would
        // make the delivery disagree with the file.
        spec.durationSec = totalWithNarration(spec.bpm, narration);
      }
    }

    // The bed is generated last, because it has to be exactly as long as the
    // finished edit — which is only known once narration has set the pacing.
    try {
      const file = writeMusic(jobId, spec.durationSec, spec.bpm, `${agent.agentId}:${style}`);
      spec.musicUrl = publicUrl(jobId, file);
    } catch (err) {
      console.error(`music synthesis failed for job ${jobId}, rendering without it:`, err);
    }

    setStage(jobId, "rendering");
    const { thumbnailPath, resolution } = await renderVideo(jobId, spec);

    setStage(jobId, "packaging");
    const delivery: Delivery = {
      jobId,
      agentId: agent.agentId,
      agentName: agent.name,
      videoUrl: publicUrl(jobId, "pitch.mp4"),
      thumbnailUrl: publicUrl(jobId, path.basename(thumbnailPath)),
      durationSec: spec.durationSec,
      resolution,
      style,
      theme,
      spec,
      createdAt: new Date().toISOString(),
    };

    completeJob(jobId, delivery);
  } catch (err) {
    const message = err instanceof Error ? err.message : "pitch generation failed";
    console.error(`job ${jobId} failed:`, err);
    failJob(jobId, message);
  }
}

/** Public status view for the free `get_job` tool. */
export function jobStatus(jobId: string): Record<string, unknown> | null {
  const job = getJob(jobId);
  if (!job) return null;
  if (job.stage === "done" && job.delivery) return { status: "done", ...job.delivery };
  if (job.stage === "failed") {
    return { status: "failed", jobId, error: job.error ?? "unknown error", charged: false };
  }
  return {
    status: "generating",
    jobId,
    stage: job.stage,
    elapsedSeconds: Math.round((Date.now() - job.startedAt) / 1000),
    next: "Poll get_job again in ~15 seconds.",
  };
}
