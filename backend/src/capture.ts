// Live-proof capture: a real recording of an agent being found, paid, and
// delivering.
//
// This is the whole argument of the live-proof tier. An animated video can claim
// anything; the actual marketplace, a real request leaving a real Claude window,
// and the artifact that came back are the parts a buyer cannot fake.
//
// Three beats, two recorders, because no single one covers all of it:
//   1. Browser — Playwright's recordVideo films the page content directly, so
//      nothing but the viewport is ever in frame (no desktop leak, no
//      permission, no avfoundation device index).
//   2. Claude Desktop — a native app, so this piece is an ffmpeg screen grab
//      cropped to its composer. It ends at the send: Claude runs the request as
//      a background session and stays on a home screen carrying the operator's
//      usage statistics, so there is nothing after the send worth filming and
//      quite a lot worth not filming.
//   3. The delivery — the link the agent answered with, opened in Playwright
//      again. Read from okx-pay's receipt rather than off the screen.
// The clips are normalised and concatenated into one live segment.
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
import { findService } from "./pricing.js";
import type { AgentProfile } from "./types.js";

const execFileP = promisify(execFile);
const MARKETPLACE_URL = "https://okx.ai";

// 16:10, the shape of the laptop mockup the footage is framed in.
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 800;

export interface CaptureResult {
  file: string;
  steps: Array<{ step: string; ok: boolean; note?: string }>;
  /** The settled payment, when one happened, for the receipt card. */
  proof?: {
    amountUsd: number;
    asset: string;
    network: string;
    wallet?: string;
  };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ─── Prompt ──────────────────────────────────────────────────────────────────

/**
 * The prompt a user would paste into Claude to call this agent.
 *
 * Built from the agent's own service metadata rather than scraped from the "Use
 * now" dialog: we already have the data, so the exact text on screen is known and
 * correct. Mirrors OKX's own "Use now" wording, then adds the brief.
 *
 * The marketplace text alone routes the call but says nothing about what to ask
 * for, so the receiving agent's first move is a clarifying question. `demoRequest`
 * carries those specifics, which is what turns the recording from "two agents
 * negotiating" into "the service running".
 */
function buildPrompt(agent: AgentProfile, demoRequest?: string, serviceId?: string): string {
  const svc = findService(agent, serviceId);
  const lines = [`I'd like to use the service provided by Agent ${agent.agentId}:`];
  if (svc) {
    lines.push(`Service title: ${svc.name}`);
    if (svc.type) lines.push(`Service type: ${svc.type}`);
    if (svc.endpoint) lines.push(`Endpoint: ${svc.endpoint}`);
  }
  lines.push("Please use OKX Agent Payments Protocol to send a request to this endpoint");
  if (demoRequest) lines.push("", demoRequest);
  // Claude Desktop can read a 402 challenge but cannot sign one; the okx-pay
  // MCP server is what settles it. Naming the tool keeps the recorded run from
  // stalling on "I am unable to make payments".
  lines.push(
    "",
    "Settle the payment with the okx-pay tool pay_and_call, then show me what came back.",
  );
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
 * Refuse to record unless cliclick can actually drive the keyboard.
 *
 * Without Accessibility privileges cliclick still exits 0 — it just prints a
 * warning and does nothing. That combination is the dangerous one: every
 * keystroke silently no-ops while ffmpeg keeps rolling, so the "Claude segment"
 * becomes an unscripted grab of whatever the operator happened to have on
 * screen. A failed keystroke must cost us the segment, never leak the desktop.
 */
async function keystrokesAvailable(): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFileP(config.cliclickBin, ["-V"], { timeout: 8000 });
    if (/Accessibility privileges not enabled/i.test(stdout + stderr)) {
      console.error(
        "live capture: cliclick lacks Accessibility privileges — skipping the Claude segment. " +
          "Grant it in System Settings › Privacy & Security › Accessibility.",
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("live capture: cliclick unusable:", err instanceof Error ? err.message.split("\n")[0] : err);
    return false;
  }
}

/**
 * Delay between the events of one chord, in milliseconds.
 *
 * Without it cliclick fires key-down, text and key-up too fast for the target
 * app to see them as one chord, and the modifier is dropped: Cmd+N arrives as a
 * bare "n" typed into whatever field had focus. Observed directly — a run meant
 * to open a new chat instead typed "n" into an existing conversation and sent
 * the prompt there.
 */
const CHORD_DELAY_MS = "60";

/** Send one cmd-chorded keystroke via cliclick (CGEvent — no Apple Events). */
async function pressCmd(letter: string): Promise<void> {
  await execFileP(config.cliclickBin, ["-w", CHORD_DELAY_MS, "kd:cmd", `t:${letter}`, "ku:cmd"], {
    timeout: 8000,
  });
}

/** Press Escape — dismisses any open modal (Settings, dialogs) harmlessly. */
async function pressEsc(): Promise<void> {
  await execFileP(config.cliclickBin, ["kp:esc"], { timeout: 8000 });
}

/**
 * Send the prompt with Cmd+Return.
 *
 * Plain Return only sends a single-line composer. The pasted prompt is several
 * lines, and in that state Return inserts another newline and the message just
 * sits there — which is exactly how the first run recorded three minutes of an
 * unsent prompt. Cmd+Return sends regardless of shape.
 */
async function pressSend(): Promise<void> {
  await execFileP(config.cliclickBin, ["-w", CHORD_DELAY_MS, "kd:cmd", "kp:return", "ku:cmd"], {
    timeout: 8000,
  });
}

// ─── Reading the result without reading the screen ───────────────────────────

/**
 * The receipt okx-pay writes for every call it settles.
 *
 * The delivery is on screen, but a recording is pixels — pulling a URL back out
 * of it would mean OCR. We do not have to: okx-pay is our own MCP server, so
 * when Claude pays through it, the result passes through our code first and is
 * written to disk. This reads that, which is exact where OCR would be a guess.
 */
interface CallReceipt {
  at: string;
  paid: boolean;
  amountUsd?: number;
  wallet?: string;
  endpoint?: string;
  result?: unknown;
}

function readReceipt(): CallReceipt | null {
  try {
    const raw = fs.readFileSync(path.join(config.okxPayReceiptDir, "last-call.json"), "utf-8");
    return JSON.parse(raw) as CallReceipt;
  } catch {
    return null;
  }
}

/** Wait for a receipt written after `since`. Returns null if none arrives. */
async function waitForReceipt(since: number, timeoutMs: number): Promise<CallReceipt | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = readReceipt();
    if (receipt && Date.parse(receipt.at) > since) return receipt;
    await wait(2000);
  }
  return null;
}

/**
 * Seconds the agent said its work would take, if it said.
 *
 * Settlement is not delivery. These agents answer the moment they are paid,
 * with a job id and an estimate, and produce the artifact afterwards — so the
 * link in that first reply is a promise, not a result.
 */
function etaSeconds(receipt: CallReceipt): number {
  const seen = JSON.stringify(receipt.result ?? {});
  const match = seen.match(/\\?"etaSeconds\\?"\s*:\s*(\d+)/);
  const n = match ? Number(match[1]) : 0;
  return Number.isFinite(n) ? Math.min(n, 240) : 0;
}

/**
 * Telling a finished delivery from a placeholder.
 *
 * Word matching alone is too blunt — BoredComic's finished reader page mentions
 * that images "expire" after a day, which a naive check reads as an error. The
 * reliable signal is shape: a placeholder is a sentence, a delivery is a page.
 * BoredComic's own pages are 114 bytes versus 5,980.
 */
const MIN_DELIVERY_BYTES = 1200;
const NOT_READY = /not found|no such|still (generating|processing)|please wait/i;

/**
 * Wait until the delivery is actually servable.
 *
 * Opening the link the instant the payment settles films the agent's "not
 * found" page, which is worse than filming nothing: it shows a paid call that
 * appears to have produced nothing.
 */
async function waitForDelivery(url: string, etaSec: number, timeoutMs: number): Promise<boolean> {
  if (etaSec > 0) await wait(etaSec * 1000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        const body = await res.text();
        if (body.length >= MIN_DELIVERY_BYTES && !NOT_READY.test(body.slice(0, 2000))) return true;
      }
    } catch {
      /* transient — keep polling until the deadline */
    }
    await wait(8000);
  }
  return false;
}

/**
 * First http(s) URL anywhere in the delivery.
 *
 * Agents on this marketplace answer with a link far more often than with the
 * artifact itself — a reader page, a report, a PDF. Whatever the shape of the
 * response, the link is the thing worth filming, so it is worth digging for
 * rather than requiring a known field name.
 */
function deliveryUrl(receipt: CallReceipt): string | null {
  const seen = JSON.stringify(receipt.result ?? {});
  const match = seen.match(/https?:\/\/[^"\\\s]+/);
  if (!match) return null;
  const url = match[0].replace(/[.,)]+$/, "");
  return /^https?:\/\/[^/]+/.test(url) ? url : null;
}

// ─── Window geometry (Quartz, read-only, no permission) ──────────────────────

/**
 * Logical width of the Claude sidebar, and the share of the window height above
 * the composer. Both are cropped away before the clip is used (see the crop
 * below), leaving the composer strip and nothing else.
 *
 * The sidebar lists the operator's own conversations; the area above the
 * composer carries their name, recent sessions, and — on the home screen —
 * their usage statistics. Cropping to the composer makes those structurally
 * impossible to film rather than merely unlikely. The sidebar is a fixed point
 * width rather than a fraction so resizing the window cannot start revealing it.
 */
const SIDEBAR_PT = 330;
const HEADER_FRACTION = 0.6;

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

/** Seconds of the Claude clip kept at real speed at the head and the tail. */
const RAMP_HEAD_SEC = 6;
const RAMP_TAIL_SEC = 4;
/** Longest the compressed middle may last. */
const RAMP_MIDDLE_SEC = 4;

async function durationSec(file: string): Promise<number> {
  try {
    const { stdout } = await execFileP(
      config.ffprobeBin,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { timeout: 20000 },
    );
    const n = Number(stdout.trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

const FIT = `scale=${CAPTURE_WIDTH}:${CAPTURE_HEIGHT}:force_original_aspect_ratio=decrease,pad=${CAPTURE_WIDTH}:${CAPTURE_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

interface Clip {
  path: string;
  /** Window rect to crop to, for screen grabs. */
  crop?: { w: number; h: number; x: number; y: number } | null;
  /** Compress the middle of this clip — for the wait while the agent works. */
  ramp?: boolean;
}

/**
 * Normalise one clip to the mockup's 16:10, optionally timelapsing its middle.
 *
 * The wait between sending a request and the agent answering is dead screen
 * time — real, but nobody needs to watch it at 1x. The head (the request going
 * out) and the tail (the answer arriving) stay at real speed because those are
 * the parts that carry the proof; only the middle is compressed.
 */
async function normalizeClip(clip: Clip, outPath: string): Promise<boolean> {
  const chain = clip.crop
    ? `crop=${clip.crop.w}:${clip.crop.h}:${clip.crop.x}:${clip.crop.y},${FIT}`
    : FIT;

  let filter = `[0:v]${chain}[out]`;
  if (clip.ramp) {
    const total = await durationSec(clip.path);
    const spare = total - RAMP_HEAD_SEC - RAMP_TAIL_SEC;
    if (spare > RAMP_MIDDLE_SEC) {
      const midStart = RAMP_HEAD_SEC;
      const midEnd = total - RAMP_TAIL_SEC;
      const factor = spare / RAMP_MIDDLE_SEC;
      filter =
        `[0:v]${chain},split=3[c0][c1][c2];` +
        `[c0]trim=0:${midStart.toFixed(3)},setpts=PTS-STARTPTS[h];` +
        `[c1]trim=${midStart.toFixed(3)}:${midEnd.toFixed(3)},setpts=(PTS-STARTPTS)/${factor.toFixed(4)}[m];` +
        `[c2]trim=${midEnd.toFixed(3)}:${total.toFixed(3)},setpts=PTS-STARTPTS[t];` +
        `[h][m][t]concat=n=3:v=1[out]`;
    }
  }

  try {
    await execFileP(
      config.ffmpegBin,
      ["-y", "-i", clip.path, "-filter_complex", filter, "-map", "[out]", "-r", "30", "-pix_fmt", "yuv420p", outPath],
      { timeout: 180000, maxBuffer: 16 * 1024 * 1024 },
    );
    return fs.existsSync(outPath) && fs.statSync(outPath).size > 10_000;
  } catch (err) {
    console.error("could not normalise a live clip:", err instanceof Error ? err.message.split("\n")[0] : err);
    return false;
  }
}

/**
 * Stitch the beats into one live segment.
 *
 * Each clip is normalised to a common size first and then concatenated by the
 * demuxer, rather than assembled in one filter graph: a single clip failing to
 * normalise then costs us that beat instead of the whole segment.
 */
async function stitch(clips: Clip[], outDir: string, outPath: string): Promise<boolean> {
  const parts: string[] = [];
  for (const [i, clip] of clips.entries()) {
    if (!fs.existsSync(clip.path)) continue;
    const part = path.join(outDir, `part-${i}.mp4`);
    if (await normalizeClip(clip, part)) parts.push(part);
  }
  if (parts.length === 0) return false;

  const listPath = path.join(outDir, "parts.txt");
  fs.writeFileSync(listPath, parts.map((p) => `file '${p}'`).join("\n"), "utf-8");
  try {
    await execFileP(
      config.ffmpegBin,
      ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath],
      { timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
    );
    return fs.existsSync(outPath) && fs.statSync(outPath).size > 10_000;
  } catch (err) {
    console.error("could not concatenate the live segments:", err instanceof Error ? err.message.split("\n")[0] : err);
    return false;
  } finally {
    for (const p of [...parts, listPath]) fs.rmSync(p, { force: true });
  }
}

/**
 * Film one page in its own Playwright recording.
 *
 * Playwright records the page content rather than the screen, so nothing but
 * the viewport can ever be in frame — the same reason part 1 uses it.
 */
async function recordPage(
  url: string,
  outDir: string,
  outPath: string,
  steps: CaptureResult["steps"],
): Promise<boolean> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return false;
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT },
    recordVideo: { dir: outDir, size: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT } },
  });
  const page = await context.newPage();
  const video = page.video();
  let ok = false;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    await wait(1500);

    // Scroll BEFORE waiting for the artwork, not after. The panels are injected
    // by script with loading="lazy", so an image below the fold never starts
    // downloading until it is scrolled into view — waiting first deadlocks
    // until the timeout and films an empty frame where the comic should be,
    // which reads as a service that delivered nothing.
    await page.mouse.wheel(0, 420);

    // Evaluated in the page, so it is written as a string: the backend has no
    // DOM lib for TypeScript to check a closure against.
    await page
      .waitForFunction(
        "Array.from(document.images).some(i => i.complete && i.naturalWidth > 200)",
        undefined,
        { timeout: 30000 },
      )
      .catch(() => {});
    await wait(3500); // hold on the finished artifact
    ok = true;
    steps.push({ step: "open the delivery", ok: true, note: url });
  } catch (err) {
    const note = err instanceof Error ? err.message.split("\n")[0] : String(err);
    steps.push({ step: "open the delivery", ok: false, note });
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  try {
    const tmp = await video?.path();
    if (tmp && fs.existsSync(tmp)) fs.renameSync(tmp, outPath);
  } catch {
    /* checked below */
  }
  return ok && fs.existsSync(outPath) && fs.statSync(outPath).size > 10_000;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function captureLiveProof(
  jobId: string,
  agent: AgentProfile,
  demoRequest?: string,
  serviceId?: string,
): Promise<CaptureResult | null> {
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

  const prompt = buildPrompt(agent, demoRequest, serviceId);
  const browserPath = path.join(outDir, "browser.webm");
  const claudePath = path.join(outDir, "claude.mp4");
  const resultPath = path.join(outDir, "result.webm");
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
  let receipt: CallReceipt | null = null;
  let crop: { w: number; h: number; x: number; y: number } | null = null;
  const sentAt = Date.now();
  try {
    // Preflight: no working keyboard, no segment. Checked before ffmpeg starts
    // so a privilege gap can never turn into unscripted desktop footage.
    if (!(await keystrokesAvailable())) throw new Error("keystrokes unavailable");

    await copyToClipboard(prompt);
    // `open -a` brings the app forward without an Apple Event.
    await execFileP("open", ["-a", config.claudeAppName]).catch(() => {});
    await wait(2500);

    // Neutralise window state BEFORE recording starts: a lingering modal
    // (Settings was open on the last run, exposing billing data on camera)
    // swallows Cmd+N, and Escape is harmless in a plain chat.
    await pressEsc();
    await wait(500);
    await pressEsc();
    await wait(500);

    // Open the new chat BEFORE the camera rolls: on tape, the transition would
    // show the previous conversation for the frames it takes to clear.
    await pressCmd("n");
    await wait(1200);

    const geom = await claudeGeometry();
    const screenIndex = await resolveScreenIndex();
    const rec = startScreenRecording(claudePath, screenIndex);
    await wait(800); // ffmpeg warm-up before the action

    try {
      // Select first, so the paste REPLACES whatever draft the composer was
      // holding. Without this a leftover draft is prepended to the prompt and
      // gets sent along with it — one run opened with three stray lines from an
      // unrelated test.
      await pressCmd("a");
      await wait(400);
      await pressCmd("v");
      await wait(2200); // let the pasted prompt be readable before it is sent
      await pressSend();
      await wait(1200); // the send itself, and nothing after it
    } catch (err) {
      // The recording is already rolling and the scripted actions did not
      // happen, so whatever is on tape is unvetted. Stop and destroy it.
      await rec.stop().catch(() => {});
      fs.rmSync(claudePath, { force: true });
      throw err;
    }

    // Stop the camera at the send. Claude Desktop runs the request as a
    // background session and stays on its home screen, which carries the
    // operator's usage statistics — filming the wait would put those on tape
    // and show nothing of the work. The wait itself still happens, just
    // off-camera; the receipt is what reports the outcome.
    await rec.stop();
    receipt = await waitForReceipt(sentAt, config.liveCallTimeoutMs);
    steps.push({ step: "send the prompt", ok: fs.existsSync(claudePath) });
    steps.push({
      step: "agent settled a paid call",
      ok: !!receipt?.paid,
      note: receipt
        ? `$${receipt.amountUsd?.toFixed(2) ?? "?"} to ${receipt.endpoint ?? "the agent"}`
        : "no receipt arrived before the timeout",
    });

    // Scale the logical window bounds to physical capture pixels for the crop.
    const dims = rec.dims();
    if (geom && dims && geom.logicalW > 0) {
      const ratio = dims.w / geom.logicalW;
      // Frame the composer, not the whole window. The sidebar lists the
      // operator's own conversations and the area above the composer carries
      // their name and recent sessions — none of that belongs in a buyer's
      // video, and no keyboard shortcut reliably hides it. Cropping is
      // stateless, so it cannot silently stop working the way a toggle can.
      const insetX = Math.min(SIDEBAR_PT, geom.w * 0.5);
      const insetY = geom.h * HEADER_FRACTION;
      crop = {
        x: Math.max(0, Math.round((geom.x + insetX) * ratio)),
        y: Math.max(0, Math.round((geom.y + insetY) * ratio)),
        w: Math.min(dims.w, Math.round((geom.w - insetX) * ratio)),
        h: Math.min(dims.h, Math.round((geom.h - insetY) * ratio)),
      };
    }
    claudeRecorded = fs.existsSync(claudePath) && fs.statSync(claudePath).size > 10_000;
  } catch (err) {
    console.error("Claude capture failed, delivering the browser segment only:", err);
  }

  // ── Part 3: the delivered artifact, opened in the browser ──
  //
  // Almost every agent here answers with a link — a reader page, a report, a
  // PDF — so the run is only shown to have worked once that link is on screen.
  // Filmed by Playwright like part 1, which keeps it leak-free.
  let resultRecorded = false;
  const url = receipt ? deliveryUrl(receipt) : null;
  if (url && receipt) {
    const ready = await waitForDelivery(url, etaSeconds(receipt), config.deliveryTimeoutMs);
    steps.push({ step: "wait for the delivery", ok: ready, note: ready ? url : "still not servable" });
    if (ready) resultRecorded = await recordPage(url, outDir, resultPath, steps);
  } else if (receipt) {
    steps.push({ step: "open the delivery", ok: false, note: "the response carried no link to open" });
  }

  // ── Stitch what we got. Any beat may be missing; the rest still cut. ──
  const clips: Clip[] = [{ path: browserPath }];
  if (claudeRecorded) clips.push({ path: claudePath, crop, ramp: true });
  if (resultRecorded) clips.push({ path: resultPath });

  const file = clips.length > 1 && (await stitch(clips, outDir, outPath)) ? "live.mp4" : "browser.webm";

  // Playwright names its raw recordings page@<hash>.webm and leaves them behind
  // once the real clips have been renamed out. They are byte-for-byte dead
  // weight in a directory that is served over HTTP.
  try {
    for (const name of fs.readdirSync(outDir)) {
      if (/^page@[0-9a-f]+\.webm$/i.test(name)) fs.rmSync(path.join(outDir, name), { force: true });
    }
  } catch {
    /* leftovers are untidy, not fatal */
  }

  const proof =
    receipt?.paid && typeof receipt.amountUsd === "number"
      ? { amountUsd: receipt.amountUsd, asset: "USD₮0", network: "X Layer", wallet: receipt.wallet }
      : undefined;

  return { file, steps, proof };
}
