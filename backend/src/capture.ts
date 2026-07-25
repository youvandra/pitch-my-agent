// Live-proof capture: a real recording of the marketplace being used, then the
// prompt being pasted into Claude Desktop.
//
// This is the whole argument of the live-proof tier. An animated video can claim
// anything; footage of the actual marketplace, the actual agent, and the prompt
// landing in a real Claude window is the part a buyer cannot fake.
//
// It is filmed in two pieces because no single recorder covers both:
//   1. Browser — Playwright's recordVideo films the page content directly, so
//      nothing but the viewport is ever in frame (no desktop leak, no
//      permission, no avfoundation device index).
//   2. Claude Desktop — a native app, so this piece is an ffmpeg screen grab
//      cropped to the Claude window.
// The two clips are concatenated into one live segment.
//
// macOS permission note: driving another app through AppleScript / System Events
// needs the Automation entitlement, which a background process spawned under
// Claude Code cannot obtain (every such call returns error -1743, and no consent
// prompt ever appears). So this file avoids Apple Events entirely: the window is
// brought forward with `open -a`, keystrokes go through cliclick (CGEvent,
// Accessibility only), and window bounds come from Quartz's read-only window
// list (no permission at all).
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { AgentProfile } from "./types.js";

const execFileP = promisify(execFile);
const MARKETPLACE_URL = "https://okx.ai";

// 16:10, the shape of the laptop mockup the footage is framed in.
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 800;

export interface CaptureResult {
  file: string;
  steps: Array<{ step: string; ok: boolean; note?: string }>;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ─── Prompt ──────────────────────────────────────────────────────────────────

/**
 * The prompt a user would paste into Claude to call this agent.
 *
 * Built from the agent's own service metadata rather than scraped from the "Use
 * now" dialog: we already have the data, so the exact text on screen is known and
 * correct. Mirrors OKX's own "Use now" wording.
 */
function buildPrompt(agent: AgentProfile): string {
  const svc = agent.services[0];
  const lines = [`I'd like to use the service provided by Agent ${agent.agentId}:`];
  if (svc) {
    lines.push(`Service title: ${svc.name}`);
    if (svc.type) lines.push(`Service type: ${svc.type}`);
    if (svc.endpoint) lines.push(`Endpoint: ${svc.endpoint}`);
  }
  lines.push("Please use OKX Agent Payments Protocol to send a request to this endpoint");
  return lines.join("\n");
}

function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve) => {
    const p = spawn("pbcopy");
    p.on("close", () => resolve());
    p.on("error", () => resolve());
    p.stdin.end(text);
  });
}

/** Send one cmd-chorded keystroke via cliclick (CGEvent — no Apple Events). */
async function pressCmd(letter: string): Promise<void> {
  try {
    await execFileP(config.cliclickBin, ["kd:cmd", `t:${letter}`, "ku:cmd"], { timeout: 8000 });
  } catch (err) {
    console.warn(`cliclick cmd+${letter} failed:`, err instanceof Error ? err.message.split("\n")[0] : err);
  }
}

// ─── Window geometry (Quartz, read-only, no permission) ──────────────────────

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Logical width of the main display, for scaling bounds to capture pixels. */
  logicalW: number;
}

const QUARTZ_SCRIPT = `import Quartz
w = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID)
c = [x for x in w if x.get('kCGWindowOwnerName') == 'Claude' and x.get('kCGWindowLayer', 0) == 0 and x.get('kCGWindowBounds', {}).get('Width', 0) > 300]
c.sort(key=lambda x: -x['kCGWindowBounds']['Width'] * x['kCGWindowBounds']['Height'])
lw = Quartz.CGDisplayBounds(Quartz.CGMainDisplayID()).size.width
if c:
    b = c[0]['kCGWindowBounds']
    print(int(b['X']), int(b['Y']), int(b['Width']), int(b['Height']), int(lw))
else:
    print('NONE')`;

async function claudeGeometry(): Promise<Geometry | null> {
  try {
    const { stdout } = await execFileP(config.pythonBin, ["-c", QUARTZ_SCRIPT], { timeout: 8000 });
    const parts = stdout.trim().split(/\s+/).map(Number);
    if (parts.length === 5 && parts.every((n) => Number.isFinite(n))) {
      const [x, y, w, h, logicalW] = parts;
      return { x, y, w, h, logicalW };
    }
  } catch (err) {
    console.warn("could not read the Claude window bounds:", err instanceof Error ? err.message.split("\n")[0] : err);
  }
  return null;
}

// ─── Screen recording (Claude segment only) ──────────────────────────────────

/** Resolve the avfoundation screen index at runtime — it shifts between runs. */
function resolveScreenIndex(): Promise<string> {
  return new Promise((resolve) => {
    const probe = spawn(config.ffmpegBin, ["-f", "avfoundation", "-list_devices", "true", "-i", ""]);
    let out = "";
    probe.stderr?.on("data", (d) => (out += String(d)));
    probe.on("close", () => {
      const line = out.split("\n").find((l) => /capture screen/i.test(l));
      const m = line?.match(/\[(\d+)\]\s*Capture screen/i);
      resolve(m ? m[1] : config.captureScreenIndex);
    });
    probe.on("error", () => resolve(config.captureScreenIndex));
  });
}

interface Recorder {
  stop: () => Promise<void>;
  /** Physical capture dimensions, once ffmpeg has reported them. */
  dims: () => { w: number; h: number } | null;
}

function startScreenRecording(outPath: string, screenIndex: string): Recorder {
  const proc = spawn(
    config.ffmpegBin,
    ["-y", "-f", "avfoundation", "-framerate", "30", "-i", `${screenIndex}:none`, "-r", "30", "-pix_fmt", "yuv420p", outPath],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  let dims: { w: number; h: number } | null = null;
  proc.stderr?.on("data", (d) => {
    stderr += String(d);
    // avfoundation logs the capture resolution; needed to scale window bounds.
    const m = stderr.match(/,\s(\d{3,4})x(\d{3,4})[,\s]/);
    if (m && !dims) dims = { w: Number(m[1]), h: Number(m[2]) };
  });

  return {
    dims: () => dims,
    stop: () =>
      new Promise<void>((resolve) => {
        proc.once("close", () => {
          if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
            console.error(`Claude recording produced nothing. ffmpeg said:\n${stderr.slice(-500)}`);
          }
          resolve();
        });
        // 'q' asks ffmpeg to finalise the container; a recorder wedged on a
        // permission dialog ignores stdin, so escalate rather than hang.
        proc.stdin?.write("q");
        proc.stdin?.end();
        setTimeout(() => proc.kill("SIGTERM"), 4000);
        setTimeout(() => proc.kill("SIGKILL"), 8000);
      }),
  };
}

/**
 * Concatenate the browser clip and the Claude clip into one live segment.
 *
 * Both are normalised to the mockup's 16:10: the Claude grab is cropped to the
 * window rect (so the desktop around it never shows), then each is scaled to fit
 * and padded, so neither is distorted and the two play back-to-back at one size.
 */
async function concat(
  browser: string,
  claude: string,
  crop: { w: number; h: number; x: number; y: number } | null,
  outPath: string,
): Promise<boolean> {
  const fit = `scale=${CAPTURE_WIDTH}:${CAPTURE_HEIGHT}:force_original_aspect_ratio=decrease,pad=${CAPTURE_WIDTH}:${CAPTURE_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  const claudeChain = crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},${fit}` : fit;
  const filter = `[0:v]${fit}[a];[1:v]${claudeChain}[b];[a][b]concat=n=2:v=1[out]`;
  try {
    await execFileP(
      config.ffmpegBin,
      ["-y", "-i", browser, "-i", claude, "-filter_complex", filter, "-map", "[out]", "-r", "30", "-pix_fmt", "yuv420p", outPath],
      { timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
    );
    return fs.existsSync(outPath) && fs.statSync(outPath).size > 10_000;
  } catch (err) {
    console.error("could not concatenate the live segments:", err instanceof Error ? err.message.split("\n")[0] : err);
    return false;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function captureLiveProof(jobId: string, agent: AgentProfile): Promise<CaptureResult | null> {
  if (!config.liveCaptureEnabled) return null;

  const outDir = path.join(config.outputDir, jobId);
  fs.mkdirSync(outDir, { recursive: true });
  const steps: CaptureResult["steps"] = [];
  const agentName = agent.name;

  // Imported lazily so a deployment without Playwright still boots and can serve
  // the animated tier.
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("live capture skipped: playwright is not installed");
    return null;
  }

  const prompt = buildPrompt(agent);
  const browserPath = path.join(outDir, "browser.webm");
  const claudePath = path.join(outDir, "claude.mp4");
  const outPath = path.join(outDir, "live.mp4");

  // ── Part 1: browser (Playwright records the page) ──
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT },
    recordVideo: { dir: outDir, size: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT } },
  });
  const page = await context.newPage();
  const video = page.video();

  const shot = async (label: string) => {
    try {
      await page.screenshot({ path: path.join(outDir, `capture-fail-${label}.png`) });
    } catch {
      /* debugging nicety only */
    }
  };
  const attempt = async (label: string, fn: () => Promise<void>, settle = 1500): Promise<boolean> => {
    try {
      await fn();
      await wait(settle);
      steps.push({ step: label, ok: true });
      return true;
    } catch (err) {
      const note = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.error(`live capture step "${label}" failed: ${note}`);
      steps.push({ step: label, ok: false, note });
      await shot(label);
      return false;
    }
  };

  try {
    await attempt("open marketplace", async () => {
      await page.goto(MARKETPLACE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    }, 2500);

    // Verified control: a button labelled "Search agent or task".
    await attempt("open search", async () => {
      await page.getByRole("button", { name: /search agent or task/i }).click({ timeout: 15000 });
    });

    await attempt("type the agent name", async () => {
      const box = page.getByRole("textbox").first();
      await box.waitFor({ state: "visible", timeout: 10000 });
      // Typed slowly: this is footage, and instant text reads as a jump cut.
      await box.pressSequentially(agentName, { delay: 110 });
    }, 2200);

    await attempt("open the agent", async () => {
      // The result row opens the agent in a new tab. To keep one continuous
      // video, catch that tab, take its URL, close it, and navigate THIS page
      // there — so the agent page is filmed in the same recording as the search.
      const row = page.getByRole("row", { name: new RegExp(agentName, "i") }).first();
      const target = (await row.count()) > 0 ? row : page.getByText(agentName, { exact: false }).first();
      const [popup] = await Promise.all([
        context.waitForEvent("page", { timeout: 12000 }).catch(() => null),
        target.click({ timeout: 15000 }),
      ]);
      if (popup) {
        await popup.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
        const url = popup.url();
        await popup.close();
        if (url && url !== "about:blank" && !/okx\.ai\/?$/.test(url)) {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        }
      }
    }, 3000);

    await attempt("press Use now", async () => {
      await page.getByRole("button", { name: /use now/i }).first().click({ timeout: 15000 });
    }, 2600);
  } finally {
    // recordVideo is only finalised once the context closes.
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  try {
    const tmp = await video?.path();
    if (tmp && fs.existsSync(tmp)) fs.renameSync(tmp, browserPath);
  } catch {
    /* handled by the existence check below */
  }
  if (!fs.existsSync(browserPath) || fs.statSync(browserPath).size < 10_000) {
    console.error("live capture: no usable browser footage");
    return null;
  }

  // ── Part 2: Claude Desktop (screen grab, cropped to its window) ──
  let claudeRecorded = false;
  let crop: { w: number; h: number; x: number; y: number } | null = null;
  try {
    await copyToClipboard(prompt);
    // `open -a` brings the app forward without an Apple Event.
    await execFileP("open", ["-a", config.claudeAppName]).catch(() => {});
    await wait(2500);

    const geom = await claudeGeometry();
    const screenIndex = await resolveScreenIndex();
    const rec = startScreenRecording(claudePath, screenIndex);
    await wait(800); // ffmpeg warm-up before the action

    // New chat, then paste. Deliberately NOT sent: the paid call cannot complete
    // yet (no okx-pay wrapper), so the shot ends on the prompt sitting in Claude.
    await pressCmd("n");
    await wait(1100);
    await pressCmd("v");
    await wait(2600); // hold on the pasted prompt

    await rec.stop();
    steps.push({ step: "paste into Claude", ok: fs.existsSync(claudePath) });

    // Scale the logical window bounds to physical capture pixels for the crop.
    const dims = rec.dims();
    if (geom && dims && geom.logicalW > 0) {
      const ratio = dims.w / geom.logicalW;
      crop = {
        x: Math.max(0, Math.round(geom.x * ratio)),
        y: Math.max(0, Math.round(geom.y * ratio)),
        w: Math.min(dims.w, Math.round(geom.w * ratio)),
        h: Math.min(dims.h, Math.round(geom.h * ratio)),
      };
    }
    claudeRecorded = fs.existsSync(claudePath) && fs.statSync(claudePath).size > 10_000;
  } catch (err) {
    console.error("Claude capture failed, delivering the browser segment only:", err);
  }

  // ── Stitch, or fall back to the browser clip alone ──
  let file: string;
  if (claudeRecorded && (await concat(browserPath, claudePath, crop, outPath))) {
    file = "live.mp4";
  } else {
    file = "browser.webm";
  }

  return { file, steps };
}
