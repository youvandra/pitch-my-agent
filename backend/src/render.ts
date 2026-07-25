// Remotion render worker.
//
// The template lives in its own project (VIDEO_PROJECT_DIR) and is invoked as a
// subprocess with the VideoSpec passed as props. Keeping Remotion out of the
// backend's dependency tree means the API process stays light and a render that
// crashes Chromium cannot take the server down with it.
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { config } from "./config.js";
import type { VideoSpec } from "./types.js";

const COMPOSITION_ID = "Pitch";

export interface RenderResult {
  videoPath: string;
  thumbnailPath: string;
  resolution: string;
}

let active = 0;
const queue: Array<() => void> = [];

/** Chromium is memory-hungry — cap concurrent renders. */
async function withRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= config.renderConcurrency) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    queue.shift()?.();
  }
}

function runRemotion(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "npx",
      args,
      { cwd: config.videoProjectDir, timeout: config.renderTimeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) return reject(new Error(`remotion failed: ${stderr || err.message}`));
        resolve();
      },
    );
    child.on("error", reject);
  });
}

/** Chromium could not be started in time — a contention failure, not a bad spec. */
const isBrowserStartupTimeout = (err: unknown): boolean =>
  err instanceof Error && /setting up the headless browser/i.test(err.message);

/**
 * Run Remotion, retrying once when Chromium fails to start in time.
 *
 * Remotion's browser-setup timeout fires at 30s and takes the whole job with
 * it, though the same spec renders fine once the machine is quiet. Only this
 * one failure is retried: everything else is a real error and should surface
 * immediately.
 */
async function spawnRemotion(args: string[]): Promise<void> {
  try {
    await runRemotion(args);
  } catch (err) {
    if (!isBrowserStartupTimeout(err)) throw err;
    console.warn("remotion could not start Chromium in time — retrying once");
    await new Promise((r) => setTimeout(r, 5000));
    await runRemotion(args);
  }
}

/**
 * Render a spec to mp4 plus a poster frame. Output lands in
 * `${OUTPUT_DIR}/${jobId}/` and is served by the static route.
 */
/**
 * Serve a job's own files over http for the duration of a render.
 *
 * Remotion fetches assets over http(s) only: `file://` is rejected outright, and
 * a relative URL is resolved against its bundle, which does not contain our
 * output directory. Rather than copying assets around, the render gets a
 * throwaway loopback server bound to an ephemeral port. It is up only while the
 * render runs, and it does not depend on the public API being reachable.
 */
function serveJobAssets(outDir: string): Promise<{ origin: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    // Only ever serve files inside this job's directory.
    const name = path.basename(decodeURIComponent((req.url ?? "").split("?")[0]));
    const file = path.join(outDir, name);
    if (!name || !file.startsWith(outDir + path.sep) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Length": fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close();
        reject(new Error("could not bind the render asset server"));
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => server.close(),
      });
    });
  });
}

/**
 * Point the renderer at the local asset server. The stored spec keeps its public
 * URLs — that is what the buyer needs — so only the props are rewritten.
 */
function localizeProps(jobId: string, spec: VideoSpec, origin: string): VideoSpec {
  const marker = `/videos/${jobId}/`;
  const local = (url: string | undefined): string | undefined => {
    if (!url) return url;
    const idx = url.indexOf(marker);
    // Remote assets (the agent's avatar) are already fetchable — leave them.
    if (idx === -1) return url;
    return `${origin}/${url.slice(idx + marker.length)}`;
  };

  return {
    ...spec,
    musicUrl: local(spec.musicUrl),
    narration: spec.narration?.map((line) => ({
      ...line,
      audioUrl: local(line.audioUrl) ?? line.audioUrl,
    })),
  };
}

/**
 * Delete every other job's output. Local iteration only — renders are large and
 * pile up fast while tuning — and gated behind a flag because in production this
 * would destroy deliveries buyers already paid for.
 */
function prunePreviousRenders(keepJobId: string): void {
  if (!config.prunePreviousRenders) return;
  try {
    for (const entry of fs.readdirSync(config.outputDir)) {
      if (entry === keepJobId || entry === "jobs") continue;
      fs.rmSync(path.join(config.outputDir, entry), { recursive: true, force: true });
    }
  } catch (err) {
    console.error("could not prune previous renders:", err);
  }
}

export async function renderVideo(jobId: string, spec: VideoSpec): Promise<RenderResult> {
  const outDir = path.join(config.outputDir, jobId);
  fs.mkdirSync(outDir, { recursive: true });
  prunePreviousRenders(jobId);

  const propsPath = path.join(outDir, "props.json");
  const videoPath = path.join(outDir, "pitch.mp4");
  const thumbnailPath = path.join(outDir, "thumbnail.png");
  return withRenderSlot(async () => {
    const assets = await serveJobAssets(outDir);
    fs.writeFileSync(propsPath, JSON.stringify(localizeProps(jobId, spec, assets.origin)), "utf-8");
    try {
      await spawnRemotion([
        "remotion", "render", "src/index.ts", COMPOSITION_ID, videoPath,
        `--props=${propsPath}`,
        "--codec=h264",
        "--log=error",
      ]);

      // Poster frame for the delivery payload and marketplace previews.
      await spawnRemotion([
        "remotion", "still", "src/index.ts", COMPOSITION_ID, thumbnailPath,
        `--props=${propsPath}`,
        "--frame=90",
        "--log=error",
      ]);

      if (!fs.existsSync(videoPath)) throw new Error("render produced no output file");
      return { videoPath, thumbnailPath, resolution: "1920x1080" };
    } finally {
      assets.close();
    }
  });
}
