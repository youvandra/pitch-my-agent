import type { Request, Response, NextFunction } from "express";

// Naive per-IP limiter. Rendering is expensive, so this mostly protects the
// free discovery/polling surface from being hammered; paid calls are already
// gated by payment.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

const hits = new Map<string, { n: number; resetAt: number }>();

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const rec = hits.get(ip);

  if (!rec || now >= rec.resetAt) {
    hits.set(ip, { n: 1, resetAt: now + WINDOW_MS });
    return next();
  }
  if (rec.n >= MAX_PER_WINDOW) {
    res.status(429).json({ error: `rate limit: ${MAX_PER_WINDOW} requests/min` });
    return;
  }
  rec.n += 1;
  next();
}

// Drop expired buckets so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) if (now >= rec.resetAt) hits.delete(ip);
}, WINDOW_MS).unref();
