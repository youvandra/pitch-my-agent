// Live-proof capture: a real recording of the marketplace being used.
//
// This is the whole argument of the live-proof tier. An animated video can claim
// anything; footage of the actual marketplace, with the actual agent, is the part
// a buyer cannot fake.
//
// Recording is done by Playwright's own `recordVideo`, which films the page
// content directly — not the macOS screen. That was a deliberate switch away
// from an ffmpeg screen grab, which kept catching the rest of the desktop (other
// windows, the menu bar, the permission dialog) and depended on an avfoundation
// device index that shifts between runs. Page-only capture is clean by
// construction: nothing but the browser viewport can ever end up in the frame,
// and it needs no screen-recording permission. The composition frames the
// footage in a laptop mockup, so the missing browser chrome is drawn in post.
//
// Selector reality: the search control on okx.ai is a button labelled "Search
// agent or task", which is verified. Everything past the search overlay (result
// rows, the agent page, the "Use now" control) is NOT verified — the agent pages
// redirect when opened directly, so the markup could not be inspected ahead of
// time. Every step is attempted independently, failures are logged with a
// screenshot, and the run continues: partial footage is still usable, and the
// first real run shows exactly which step needs tuning.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const MARKETPLACE_URL = "https://okx.ai";

// 16:10, the shape of the laptop mockup the footage is framed in.
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 800;

export interface CaptureResult {
  /** Filename inside the job directory. */
  file: string;
  steps: Array<{ step: string; ok: boolean; note?: string }>;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Drive the marketplace on screen and film the browser page.
 *
 * Scope is deliberately short: land on okx.ai, search for the agent, open it, and
 * hit "Use now", then bring Claude to the front. Actually completing a paid call
 * needs the okx-pay MCP wrapper, which does not exist yet — filming a checkout
 * that cannot complete would be worse than filming nothing. The Claude hand-off
 * is a real app, not a browser page, so it is triggered but not part of the clip.
 */
export async function captureLiveProof(
  jobId: string,
  _agentId: string,
  agentName: string,
): Promise<CaptureResult | null> {
  if (!config.liveCaptureEnabled) return null;

  const outDir = path.join(config.outputDir, jobId);
  fs.mkdirSync(outDir, { recursive: true });
  const file = "live.webm";
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

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT },
    recordVideo: { dir: outDir, size: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT } },
  });

  // Keep the whole flow in ONE page so it is ONE continuous video: recordVideo
  // is per-page, and the agent opens in a new tab, so that tab's navigation is
  // pulled back into this page instead of being filmed separately and lost.
  const page = await context.newPage();
  const video = page.video();

  const shot = async (label: string): Promise<void> => {
    try {
      await page.screenshot({ path: path.join(outDir, `capture-fail-${label}.png`) });
    } catch {
      // A screenshot is a debugging nicety; never let it mask the real error.
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
      // The overlay's input is unverified, so accept any focused textbox.
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
    }, 2800);

    // Bring Claude to the front — the hand-off. It is a real app, not a page, so
    // it is triggered but never recorded; the clip ends on the marketplace.
    await attempt("open Claude", async () => {
      spawn("open", ["-a", config.claudeAppName]);
    }, 1500);
  } finally {
    // The video is only finalised once the context closes.
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  // Playwright writes the video under a generated name; move it to a stable one.
  try {
    const tmpPath = await video?.path();
    const outPath = path.join(outDir, file);
    if (tmpPath && fs.existsSync(tmpPath)) {
      fs.renameSync(tmpPath, outPath);
    }
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 10_000) {
      console.error("live capture produced no usable footage");
      return null;
    }
  } catch (err) {
    console.error("could not finalise the live recording:", err);
    return null;
  }

  return { file, steps };
}
