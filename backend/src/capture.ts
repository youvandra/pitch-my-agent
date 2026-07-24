// Live-proof capture: a real screen recording of the marketplace being used.
//
// This is the whole argument of the live-proof tier. An animated video can claim
// anything; footage of the actual marketplace, with the actual agent, is the part
// a buyer cannot fake.
//
// Two processes cooperate: ffmpeg records the macOS screen via avfoundation while
// Playwright drives a real, visible Chromium window. The browser is headed on
// purpose — the point is to film a real screen, not to scrape.
//
// Selector reality: the search control on okx.ai is a button labelled "Search
// agent or task", which is verified. Everything past the search overlay (result
// rows, the agent page, the "Use now" control) is NOT verified — the agent pages
// redirect when opened directly, so the markup could not be inspected ahead of
// time. Every step is therefore independently attempted, failures are logged with
// a screenshot, and the run continues: partial footage is still usable, and the
// first real run tells us exactly which step needs tuning.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const MARKETPLACE_URL = "https://okx.ai";

export interface CaptureResult {
  /** Filename inside the job directory. */
  file: string;
  steps: Array<{ step: string; ok: boolean; note?: string }>;
}

/** Start recording the whole screen. Returns a stop function. */
function startScreenRecording(outPath: string): { stop: () => Promise<void> } {
  // `-r 30` matches the composition frame rate so the clip drops straight in.
  const args = [
    "-y",
    "-f", "avfoundation",
    "-capture_cursor", "1",
    "-framerate", "30",
    "-i", `${config.captureScreenIndex}:none`,
    "-vf", "scale=1920:-2,format=yuv420p",
    "-r", "30",
    outPath,
  ];

  const proc: ChildProcess = spawn(config.ffmpegBin, args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr?.on("data", (d) => {
    stderr += String(d);
  });

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        proc.once("close", () => {
          if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
            console.error(`screen recording produced nothing. ffmpeg said:\n${stderr.slice(-800)}`);
          }
          resolve();
        });
        // 'q' asks ffmpeg to finalise the container; killing outright would leave
        // it corrupt. But an ffmpeg blocked on the Screen Recording permission
        // dialog never reads stdin and can ignore SIGTERM, so escalate to
        // SIGKILL — a hung recorder must not wedge the whole render.
        proc.stdin?.write("q");
        proc.stdin?.end();
        setTimeout(() => proc.kill("SIGTERM"), 4000);
        setTimeout(() => proc.kill("SIGKILL"), 8000);
      }),
  };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Drive the marketplace on screen and film it.
 *
 * Scope is deliberately short: land on okx.ai, search for the agent, open it, and
 * hit "Use now", then bring Claude to the front. Actually completing a paid call
 * needs the okx-pay MCP wrapper, which does not exist yet — filming a checkout
 * that cannot complete would be worse than filming nothing.
 */
export async function captureLiveProof(
  jobId: string,
  agentId: string,
  agentName: string,
): Promise<CaptureResult | null> {
  if (!config.liveCaptureEnabled) return null;

  const outDir = path.join(config.outputDir, jobId);
  fs.mkdirSync(outDir, { recursive: true });
  const file = "live.mp4";
  const outPath = path.join(outDir, file);
  const steps: CaptureResult["steps"] = [];

  // Imported lazily so a deployment without Playwright still boots and can serve
  // the animated tier.
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("live capture skipped: playwright is not installed");
    return null;
  }

  // Kiosk / fullscreen: ffmpeg films the whole display, so the browser has to
  // own the whole display — otherwise the recording captures the desktop behind
  // it (other windows, the dock, the permission dialog). Kiosk also hides the
  // tab bar and address bar, which read as "someone's dev machine" rather than
  // "the product".
  const browser = await chromium.launch({
    headless: false,
    args: ["--kiosk", "--start-fullscreen", "--window-position=0,0"],
  });
  const recorder = startScreenRecording(outPath);

  const shot = async (page: import("playwright").Page, label: string): Promise<void> => {
    try {
      await page.screenshot({ path: path.join(outDir, `capture-fail-${label}.png`) });
    } catch {
      // A screenshot is a debugging nicety; never let it mask the real error.
    }
  };

  try {
    // viewport: null → the page fills the real (fullscreen) window instead of
    // being boxed into a fixed size the kiosk window would frame with blank space.
    const context = await browser.newContext({ viewport: null });
    // The agent opens in a new tab, so the page we act on has to be able to
    // change mid-run — `page` is reassigned to whichever tab is on screen.
    let page = await context.newPage();

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
        await shot(page, label);
        return false;
      }
    };

    await attempt("open marketplace", async () => {
      await page.goto(MARKETPLACE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    }, 2500);

    // Verified control: a button labelled "Search agent or task".
    await attempt("open search", async () => {
      await page.getByRole("button", { name: /search agent or task/i }).click({ timeout: 15000 });
    });

    await attempt("type the agent name", async () => {
      // The overlay's input is unverified, so accept any focused textbox.
      const box = page.getByRole("textbox").first();
      await box.waitFor({ state: "visible", timeout: 10000 });
      // Typed slowly: this is footage, and instant text reads as a jump cut.
      await box.type(agentName, { delay: 110 });
    }, 2200);

    await attempt("open the agent", async () => {
      // Clicking the result row opens the agent in a NEW TAB, so wait for that
      // tab and switch to it. The search result is a row, not a bare text node —
      // target the row and click it, then fall back to the text if the layout
      // differs from what was seen.
      const row = page.getByRole("row", { name: new RegExp(agentName, "i") }).first();
      const target = (await row.count()) > 0 ? row : page.getByText(agentName, { exact: false }).first();

      const [opened] = await Promise.all([
        context.waitForEvent("page", { timeout: 15000 }).catch(() => null),
        target.click({ timeout: 15000 }),
      ]);
      if (opened) {
        await opened.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
        await opened.bringToFront();
        page = opened;
      }
    }, 3000);

    await attempt("press Use now", async () => {
      await page.getByRole("button", { name: /use now/i }).first().click({ timeout: 15000 });
    }, 2800);

    // Bring Claude to the front to end on the handover shot.
    await attempt("open Claude", async () => {
      const open = spawn("open", ["-a", config.claudeAppName]);
      await new Promise<void>((resolve, reject) => {
        open.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`open exited ${code}`))));
        open.once("error", reject);
      });
    }, 3000);
  } finally {
    await browser.close().catch(() => {});
    await recorder.stop();
  }

  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 10_000) {
    console.error("live capture produced no usable footage");
    return null;
  }
  return { file, steps };
}
