// Live capture: a real recording of the agent on the OKX.ai marketplace.
//
// This is what separates the live-proof tier from the animated one. The animated
// cut is motion graphics built from the agent's metadata — accurate, but
// authored. This is the marketplace itself: the real listing, the real services,
// the real prices, filmed being used.
//
// Playwright records the page content rather than the screen, so only the
// viewport is ever in frame. No desktop is captured, no macOS permission is
// needed, and nothing outside the browser can leak into a buyer's video. An
// earlier version also drove Claude Desktop through a screen grab to film a paid
// call; it produced stronger proof and worse everything else — three separate
// silent leaks of the operator's own screen — and the marketplace listing is
// evidence enough without that risk.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { AgentProfile } from "./types.js";

const MARKETPLACE_URL = "https://okx.ai";

// 16:10, the shape of the laptop mockup the footage is framed in. Recording at
// the mockup's aspect ratio means no crop or pad is needed afterwards.
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 800;

export interface CaptureResult {
  file: string;
  steps: Array<{ step: string; ok: boolean; note?: string }>;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Film the agent being found and opened on the marketplace.
 *
 * Never throws. Every step is attempted and recorded; a step that fails leaves
 * the rest of the take intact, because a shorter honest clip is worth more than
 * no live segment at all.
 */
export async function captureLiveProof(
  jobId: string,
  agent: AgentProfile,
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

  const clipPath = path.join(outDir, "live.webm");

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

    // A slow pass down the listing and back. The services and their prices are
    // what a buyer is actually deciding on, and they sit below the fold.
    await attempt("read the services", async () => {
      for (let i = 0; i < 3; i += 1) {
        await page.mouse.wheel(0, 260);
        await wait(900);
      }
      await page.mouse.wheel(0, -780);
    }, 1400);

    await attempt("press Use now", async () => {
      await page.getByRole("button", { name: /use now/i }).first().click({ timeout: 15000 });
    }, 3200);
  } finally {
    // recordVideo is only finalised once the context closes.
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  try {
    const tmp = await video?.path();
    if (tmp && fs.existsSync(tmp)) fs.renameSync(tmp, clipPath);
  } catch {
    /* handled by the existence check below */
  }

  // Playwright leaves its raw page@<hash>.webm behind once the take has been
  // renamed out. They are dead weight in a directory served over HTTP.
  try {
    for (const name of fs.readdirSync(outDir)) {
      if (/^page@[0-9a-f]+\.webm$/i.test(name)) fs.rmSync(path.join(outDir, name), { force: true });
    }
  } catch {
    /* leftovers are untidy, not fatal */
  }

  if (!fs.existsSync(clipPath) || fs.statSync(clipPath).size < 10_000) {
    console.error("live capture: no usable footage");
    return null;
  }

  return { file: "live.webm", steps };
}
