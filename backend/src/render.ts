// Remotion render worker.
//
// The template lives in its own project (VIDEO_PROJECT_DIR) and is invoked as a
// subprocess with the VideoSpec passed as props. Keeping Remotion out of the
// backend's dependency tree means the API process stays light and a render that
// crashes Chromium cannot take the server down with it.
import { execFile } from "node:child_process";
import fs from "node:fs";
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

function spawnRemotion(args: string[]): Promise<void> {
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

/**
 * Render a spec to mp4 plus a poster frame. Output lands in
 * `${OUTPUT_DIR}/${jobId}/` and is served by the static route.
 */
export async function renderVideo(jobId: string, spec: VideoSpec): Promise<RenderResult> {
  const outDir = path.join(config.outputDir, jobId);
  fs.mkdirSync(outDir, { recursive: true });

  const propsPath = path.join(outDir, "props.json");
  const videoPath = path.join(outDir, "pitch.mp4");
  const thumbnailPath = path.join(outDir, "thumbnail.png");
  fs.writeFileSync(propsPath, JSON.stringify(spec), "utf-8");

  return withRenderSlot(async () => {
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
  });
}
