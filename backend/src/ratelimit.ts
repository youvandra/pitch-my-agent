import type { Request, Response, NextFunction } from "express";

// Naive per-IP limiter. Paid calls are gated by payment, so this protects the
// free surface — which is not actually free to serve.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

/**
 * `preview_spec` costs real money to answer: it reads the marketplace, fetches
 * and analyses an avatar, and asks a language model to write a full spec. It is
 * free to the caller by design — you should be able to read the script before
 * paying for the render — but that makes it the one endpoint where an
 * unthrottled loop drains someone else's credits rather than just CPU.
 */
const EXPENSIVE_TOOLS = new Set(["preview_spec"]);
const MAX_EXPENSIVE_PER_WINDOW = 6;

const hits = new Map<string, { n: number; expensive: number; resetAt: number }>();

function toolName(req: Request): string {
  const body = req.body as { method?: string; params?: { name?: string } } | undefined;
  return body?.method === "tools/call" ? body?.params?.name ?? "" : "";
}

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const costly = EXPENSIVE_TOOLS.has(toolName(req));
  let rec = hits.get(ip);

  if (!rec || now >= rec.resetAt) {
    rec = { n: 0, expensive: 0, resetAt: now + WINDOW_MS };
    hits.set(ip, rec);
  }

  if (rec.n >= MAX_PER_WINDOW) {
    res.status(429).json({ error: `rate limit: ${MAX_PER_WINDOW} requests/min` });
    return;
  }
  if (costly && rec.expensive >= MAX_EXPENSIVE_PER_WINDOW) {
    res.status(429).json({
      error: `rate limit: ${MAX_EXPENSIVE_PER_WINDOW} preview_spec calls/min — it runs a full model pass`,
    });
    return;
  }

  rec.n += 1;
  if (costly) rec.expensive += 1;
  next();
}

// Drop expired buckets so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) if (now >= rec.resetAt) hits.delete(ip);
}, WINDOW_MS).unref();
