import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { Job, JobStage, Delivery, Palette } from "./types.js";

// In-memory job registry, mirrored to disk so a finished delivery survives a
// restart. A buyer already paid for that render — losing the handle would mean
// they paid for nothing.

const jobs = new Map<string, Job>();
const paletteCache = new Map<string, Palette>();

const jobsDir = () => path.join(config.outputDir, "jobs");

function jobFile(jobId: string): string {
  return path.join(jobsDir(), `${jobId}.json`);
}

export function initStore(): void {
  fs.mkdirSync(jobsDir(), { recursive: true });
  for (const file of fs.readdirSync(jobsDir())) {
    if (!file.endsWith(".json")) continue;
    try {
      const job = JSON.parse(fs.readFileSync(path.join(jobsDir(), file), "utf-8")) as Job;
      jobs.set(job.jobId, job);
    } catch {
      // A corrupt record must not stop the server from booting.
    }
  }
}

function persist(job: Job): void {
  try {
    fs.mkdirSync(jobsDir(), { recursive: true });
    fs.writeFileSync(jobFile(job.jobId), JSON.stringify(job), "utf-8");
  } catch (err) {
    console.error(`failed to persist job ${job.jobId}:`, err);
  }
}

export function createJob(job: Job): Job {
  jobs.set(job.jobId, job);
  persist(job);
  return job;
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export function setStage(jobId: string, stage: JobStage): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.stage = stage;
  persist(job);
}

export function completeJob(jobId: string, delivery: Delivery): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.stage = "done";
  job.delivery = delivery;
  job.finishedAt = Date.now();
  persist(job);
}

export function failJob(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.stage = "failed";
  job.error = error;
  job.finishedAt = Date.now();
  persist(job);
}

// Palette is deterministic per agent + style, so cache it: re-renders of the
// same agent must not drift in color.
export function getCachedPalette(key: string): Palette | undefined {
  return paletteCache.get(key);
}

export function cachePalette(key: string, palette: Palette): void {
  paletteCache.set(key, palette);
}

/** Delete rendered output and job records past their TTL. */
export function startCleanup(): void {
  const sweep = () => {
    const cutoff = Date.now() - config.outputTtlMs;
    for (const [jobId, job] of jobs) {
      if ((job.finishedAt ?? job.startedAt) > cutoff) continue;
      jobs.delete(jobId);
      fs.rmSync(jobFile(jobId), { force: true });
      fs.rmSync(path.join(config.outputDir, jobId), { recursive: true, force: true });
    }
  };
  sweep();
  setInterval(sweep, 3_600_000).unref();
}

/** Resolve a file inside a job's output dir, refusing path traversal. */
export function resolveOutputPath(jobId: string, file: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(jobId)) return null;
  const dir = path.resolve(config.outputDir, jobId);
  const full = path.resolve(dir, file);
  if (!full.startsWith(dir + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}
