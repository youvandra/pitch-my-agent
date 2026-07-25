// Live-proof capture: a real recording of the marketplace being used, then the
// prompt being pasted into Claude Desktop.
//
// This is the whole argument of the live-proof tier. An animated video can claim
// anything; footage of the actual marketplace, the actual agent, and the prompt
// landing in a real Claude window is the part a buyer cannot fake.
//
// It is filmed in two pieces because no single recorder covers both:
//   1. Browser — Playwright's recordVideo films the page content directly, so
//      nothing but the viewport can ever be in frame (no desktop leak, no
//      permission, no avfoundation device index).
//   2. Claude Desktop — a native app, not a page, so this piece is an ffmpeg
//      screen grab cropped to the Claude window.
// The two clips are then concatenated into one live segment.
//
// Selector reality: the search control on okx.ai is a button labelled "Search
// agent or task", which is verified. Everything past it (result rows, the agent
// page, "Use now") is NOT — the agent pages redirect when opened directly, so the
// markup could not be inspected ahead of time. Each step is attempted
// independently; a failure is logged with a screenshot and the run continues.
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
 * Built here from the agent's own service metadata rather than scraped from the
 * "Use now" dialog: we already have the data, and constructing it means the exact
 * text on screen is known and correct. Mirrors OKX's own "Use now" wording.
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

/**
 * Collapse the Claude sidebar so the recording does not show the user's chat
 * history. Clicks the View-menu item whose name contains "Hide Sidebar" — which
 * only exists while the sidebar is shown, so it never re-opens a hidden one, and
 * matching by substring survives "Hide"/"Collapse"/"Toggle" wording. Best-effort:
 * if there is no such item the recording just keeps the sidebar.
 */
async function hideSidebar(): Promise<void> {
  await runOsa(
    `tell application "System Events" to tell process "${config.claudeAppName}"\n` +
    `  repeat with m in menu bar items of menu bar 1\n` +
    `    try\n` +
    `      repeat with mi in menu items of menu 1 of m\n` +
    `        if name of mi contains "Hide Sidebar" then\n` +
    `          click mi\n` +
    `          return\n` +
    `        end if\n` +
    `      end repeat\n` +
    `    end try\n` +
    `  end repeat\n` +
    `end tell`,
  );
}

async function runOsa(script: string): Promise<void> {
  try {
    await execFileP("osascript", ["-e", script], { timeout: 15000 });
  } catch (err) {
    // Keystrokes need Accessibility permission; if it is not granted the paste
    // silently fails but the recording still shows Claude open. Log, don't throw.
    console.warn("osascript step failed (Accessibility permission?):", err instanceof Error ? err.message.split("\n")[0] : err);
  }
}

// ─── Screen recording (Claude segment only) ──────────────────────────────────

/**
 * Resolve the avfoundation screen index at runtime — it is not stable, since
 * cameras and mics enumerate first and their order shifts between runs.
 */
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
        proc.stdin?.write("q");
        proc.stdin?.end();
        setTimeout(() => proc.kill("SIGTERM"), 4000);
        setTimeout(() => proc.kill("SIGKILL"), 8000);
      }),
  };
}

/** Claude window bounds in logical points: [x, y, w, h], or null. */
async function claudeWindowBounds(): Promise<[number, number, number, number] | null> {
  try {
    const { stdout } = await execFileP("osascript", [
      "-e",
      `tell application "System Events" to tell process "${config.claudeAppName}" to get {position, size} of window 1`,
    ], { timeout: 8000 });
    const nums = stdout.trim().split(",").map((n) => Number(n.trim()));
    if (nums.length === 4 && nums.every((n) => Number.isFinite(n))) {
      return [nums[0], nums[1], nums[2], nums[3]];
    }
  } catch (err) {
    console.warn("could not read the Claude window bounds:", err instanceof Error ? err.message.split("\n")[0] : err);
  }
  return null;
}

async function logicalScreenWidth(): Promise<number | null> {
  try {
    const { stdout } = await execFileP("osascript", [
      "-e",
      'tell application "Finder" to get bounds of window of desktop',
    ], { timeout: 8000 });
    const w = Number(stdout.trim().split(",")[2]);
    return Number.isFinite(w) ? w : null;
  } catch {
    return null;
  }
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

export async function captureLiveProof(
  jobId: string,
  agent: AgentProfile,
): Promise<CaptureResult | null> {
  if (!config.liveCaptureEnabled) return null;

  const outDir = path.join(config.outputDir, jobId);
  fs.mkdirSync(outDir, { recursive: true });
  const steps: CaptureResult["steps"] = [];
  const agentName = agent.name;

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

    await attempt("open search", async () => {
      await page.getByRole("button", { name: /search agent or task/i }).click({ timeout: 15000 });
    });

    await attempt("type the agent name", async () => {
      const box = page.getByRole("textbox").first();
      await box.waitFor({ state: "visible", timeout: 10000 });
      await box.pressSequentially(agentName, { delay: 110 });
    }, 2200);

    await attempt("open the agent", async () => {
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
    await runOsa(`tell application "${config.claudeAppName}" to activate`);
    await wait(2000); // let the window come forward
    await hideSidebar(); // collapse chat history before anything is filmed
    await wait(700);

    const bounds = await claudeWindowBounds();
    const screenIndex = await resolveScreenIndex();
    const rec = startScreenRecording(claudePath, screenIndex);
    await wait(700); // ffmpeg warm-up before the action

    // New chat, then paste. Deliberately NOT sent: the paid call cannot complete
    // yet (no okx-pay wrapper), so the shot ends on the prompt sitting in Claude.
    await runOsa(
      `tell application "${config.claudeAppName}" to activate\n` +
      `delay 0.4\n` +
      `tell application "System Events" to keystroke "n" using command down\n` +
      `delay 0.9\n` +
      `tell application "System Events" to keystroke "v" using command down`,
    );
    await wait(2600); // hold on the pasted prompt

    await rec.stop();
    steps.push({ step: "paste into Claude", ok: fs.existsSync(claudePath) });

    // Scale the logical window bounds to physical capture pixels for the crop.
    const dims = rec.dims();
    const logicalW = await logicalScreenWidth();
    if (bounds && dims && logicalW) {
      const ratio = dims.w / logicalW;
      const [x, y, w, h] = bounds;
      crop = {
        x: Math.max(0, Math.round(x * ratio)),
        y: Math.max(0, Math.round(y * ratio)),
        w: Math.min(dims.w, Math.round(w * ratio)),
        h: Math.min(dims.h, Math.round(h * ratio)),
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
