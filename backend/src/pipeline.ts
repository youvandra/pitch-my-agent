// End-to-end job pipeline: agent metadata → palette → spec → (live segment) →
// render → delivery. Runs in the background; the buyer polls `get_job`.
import path from "node:path";
import { config } from "./config.js";
import { fetchAgent } from "./okx.js";
import { buildPalette } from "./palette.js";
import { buildSpec, buildScript } from "./spec.js";
import { synthesizeNarration } from "./voice.js";
import { writeMusic } from "./music.js";
import { captureLiveProof } from "./capture.js";
import { renderVideo } from "./render.js";
import { setStage, completeJob, failJob, getJob } from "./store.js";
import type { Delivery, GeneratePitchInput, NarrationLine, VisualStyle } from "./types.js";

export interface TierSpec {
  id: string;
  durationSec: number;
  /** Premium includes the recorded live segment. */
  liveSegment: boolean;
}

export const TIERS: Record<string, TierSpec> = {
  animated: { id: "animated", durationSec: 60, liveSegment: false },
  "live-proof": { id: "live-proof", durationSec: 100, liveSegment: true },
};

/** Rough ETA so a caller knows how long to poll for. */
export function etaSeconds(tier: TierSpec): number {
  return tier.liveSegment ? 420 : 240;
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

/**
 * Film the marketplace being used with this agent.
 *
 * Returns undefined rather than throwing when capture is off or the recording
 * fails: a live-proof job then delivers the animated cut instead of nothing.
 * The caller is told, so the tier can be honest about what it produced.
 */
async function recordLiveSegment(
  jobId: string,
  agentId: string,
  agentName: string,
): Promise<string | undefined> {
  try {
    const result = await captureLiveProof(jobId, agentId, agentName);
    if (!result) return undefined;
    const failed = result.steps.filter((s) => !s.ok);
    if (failed.length > 0) {
      console.warn(
        `live capture completed with ${failed.length} failed step(s): ` +
          failed.map((s) => s.step).join(", "),
      );
    }
    return publicUrl(jobId, result.file);
  } catch (err) {
    console.error(`live capture failed for job ${jobId}:`, err);
    return undefined;
  }
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

    if (tier.liveSegment && input.includeLiveSegment !== false) {
      setStage(jobId, "recording_live");
      const liveSegmentUrl = await recordLiveSegment(jobId, agent.agentId, agent.name);
      if (liveSegmentUrl) spec.liveSegmentUrl = liveSegmentUrl;
    }

    if (input.voiceover !== false) {
      setStage(jobId, "recording_voice");
      const script = await buildScript(spec, agent);
      // The live scene collapses to nothing when there is no recording, so
      // narrating it would mean paying for audio that never plays.
      const speakable = spec.liveSegmentUrl ? script : script.filter((l) => l.scene !== "live");
      const narration = await synthesizeNarration(jobId, speakable, input.voice);
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
