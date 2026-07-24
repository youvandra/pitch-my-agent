// End-to-end job pipeline: agent metadata → palette → spec → (live segment) →
// render → delivery. Runs in the background; the buyer polls `get_job`.
import path from "node:path";
import { config } from "./config.js";
import { fetchAgent } from "./okx.js";
import { buildPalette } from "./palette.js";
import { buildSpec } from "./spec.js";
import { renderVideo } from "./render.js";
import { setStage, completeJob, failJob, getJob } from "./store.js";
import type { Delivery, GeneratePitchInput, VisualStyle } from "./types.js";

export interface TierSpec {
  id: string;
  durationSec: number;
  /** Premium includes the recorded live segment. */
  liveSegment: boolean;
}

export const TIERS: Record<string, TierSpec> = {
  standard: { id: "standard", durationSec: 60, liveSegment: false },
  premium: { id: "premium", durationSec: 100, liveSegment: true },
};

/** Rough ETA so a caller knows how long to poll for. */
export function etaSeconds(tier: TierSpec): number {
  return tier.liveSegment ? 420 : 240;
}

function publicUrl(jobId: string, file: string): string {
  const rel = `/videos/${jobId}/${file}`;
  return config.publicBaseUrl ? `${config.publicBaseUrl}${rel}` : rel;
}

/**
 * Record the live segment: a real session paying + calling the target agent.
 *
 * Not implemented yet — it needs the okx-pay MCP wrapper plus the macOS
 * automation (osascript + ffmpeg). Until then a premium job renders without it
 * rather than failing, and the delivery simply carries no liveSegmentUrl.
 * See PLAN §4.
 */
async function recordLiveSegment(_jobId: string, _agentId: string): Promise<string | undefined> {
  return undefined;
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
      const liveSegmentUrl = await recordLiveSegment(jobId, agent.agentId);
      if (liveSegmentUrl) spec.liveSegmentUrl = liveSegmentUrl;
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
