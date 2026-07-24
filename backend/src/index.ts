import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { buildPitchServer } from "./mcp.js";
import { mcpPaidRoute, mcpPreflight, send402Challenge, x402Info } from "./x402.js";
import { handleNativePaidCall, PAID_TOOLS } from "./native.js";
import { rateLimit } from "./ratelimit.js";
import { initStore, startCleanup, resolveOutputPath, getJob } from "./store.js";
import { TIERS, jobStatus, type TierSpec } from "./pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, "..", "..", "frontend");

const app = express();
// Behind a Cloudflare Tunnel / reverse proxy, so trust X-Forwarded-* headers.
app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));
app.use(express.static(FRONTEND_DIR));

// ─── Tiers: one endpoint = one marketplace service ──────────────────────────

interface TierRoute {
  path: string;
  tier: TierSpec;
  price: string;
  desc: string;
}

const TIER_ROUTES: TierRoute[] = [
  {
    path: "/pitch/animated",
    tier: TIERS.animated,
    price: config.priceAnimatedUsd,
    desc: "Animated Pitch — motion-graphics demo video for an OKX.ai agent",
  },
  {
    path: "/pitch/live-proof",
    tier: TIERS["live-proof"],
    price: config.priceLiveProofUsd,
    desc: "Animated + Live-Proof Pitch — the same video with a real screen recording of the agent being used",
  },
];

// ─── MCP transport plumbing ─────────────────────────────────────────────────

// A fresh server per request, so a per-request transport.close() can't tear down
// a shared instance out from under a concurrent request.
function createMcpTransportHandler(buildServer: () => ReturnType<typeof buildPitchServer>) {
  return async (req: express.Request, res: express.Response) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP error:", err);
      if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
    }
  };
}

const ACCEPT_BOTH = "application/json, text/event-stream";

// The MCP transport rebuilds the request from req.rawHeaders (the flat array),
// not the parsed req.headers object — so both must be set for the Accept
// override to reach the transport and keep a plain-JSON discovery client from
// tripping its 406 event-stream requirement.
function forceAcceptBoth(req: express.Request): void {
  req.headers.accept = ACCEPT_BOTH;
  const raw = req.rawHeaders;
  let found = false;
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i]?.toLowerCase() === "accept") {
      raw[i + 1] = ACCEPT_BOTH;
      found = true;
    }
  }
  if (!found) raw.push("Accept", ACCEPT_BOTH);
}

// Paid tool calls are served x402-native (plain JSON in, plain JSON out) so the
// facilitator can settle. Everything else — discovery and the free tools — goes
// through the MCP transport with Accept normalized.
function createTierHandler(route: TierRoute) {
  const transportHandler = createMcpTransportHandler(() => buildPitchServer(route.tier, route.price));
  return async (req: express.Request, res: express.Response) => {
    const body = req.body as { method?: string; params?: { name?: string } } | undefined;
    if (body?.method === "tools/call" && PAID_TOOLS.has(body?.params?.name ?? "")) {
      return handleNativePaidCall(req, res, route.tier);
    }
    if (!String(req.headers.accept ?? "").includes("text/event-stream")) forceAcceptBoth(req);
    return transportHandler(req, res);
  };
}

for (const route of TIER_ROUTES) {
  const handler = createTierHandler(route);

  app.post(
    route.path,
    rateLimit,
    mcpPreflight(),
    mcpPaidRoute(`POST ${route.path}`, route.desc, route.price),
    handler,
  );

  // Marketplace validators probe a paid endpoint with a bare GET and expect the
  // x402 challenge. Real MCP clients always POST.
  app.get(route.path, (req, res) => {
    send402Challenge(req, res, route.desc, route.price);
  });

  app.all(route.path, (_req, res) => {
    res.status(405).json({
      error: "Method not allowed. POST JSON-RPC with Content-Type: application/json.",
    });
  });
}

// ─── Free surface ───────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "pitch-my-agent" });
});

app.get("/x402/info", (_req, res) => {
  res.json({
    ...x402Info(),
    tiers: TIER_ROUTES.map((r) => ({
      endpoint: r.path,
      price: `$${r.price}`,
      durationSec: r.tier.durationSec,
      liveSegment: r.tier.liveSegment,
    })),
  });
});

app.get("/api/job/:jobId", (req, res) => {
  const status = jobStatus(req.params.jobId);
  if (!status) {
    res.status(404).json({ error: "unknown or expired jobId" });
    return;
  }
  res.json(status);
});

// Rendered output: video, thumbnail, gif preview.
app.get("/videos/:jobId/:file", (req, res) => {
  const filePath = resolveOutputPath(req.params.jobId, req.params.file);
  if (!filePath) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "not found" });
  });
});

// Shareable watch page for a finished pitch.
app.get("/watch/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job?.delivery) {
    res
      .status(404)
      .type("html")
      .send('<h1 style="font-family:sans-serif;text-align:center;margin-top:20vh">Pitch not found — it may have expired.</h1>');
    return;
  }
  const d = job.delivery;
  res.type("html").send(`<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${d.agentName} — Pitch My Agent</title>
<meta property="og:title" content="${d.agentName} — demo video">
<meta property="og:image" content="${d.thumbnailUrl}">
<meta property="og:type" content="video.other">
<style>
  body{margin:0;background:${d.theme.bg};color:${d.theme.text};
       font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;
       display:grid;place-items:center;min-height:100vh;padding:24px}
  main{width:100%;max-width:960px}
  h1{font-size:clamp(20px,4vw,32px);margin:0 0 4px}
  p{color:${d.theme.muted};margin:0 0 20px}
  video{width:100%;border-radius:12px;border:1px solid ${d.theme.bg2};background:#000}
  a{color:${d.theme.accent}}
</style>
<main>
  <h1>${d.agentName}</h1>
  <p>Agent #${d.agentId} · ${d.durationSec}s · ${d.resolution}</p>
  <video src="${d.videoUrl}" poster="${d.thumbnailUrl}" controls playsinline></video>
  <p style="margin-top:20px"><a href="${d.videoUrl}" download>Download mp4</a></p>
</main>`);
});

initStore();
startCleanup();

app.listen(config.port, () => {
  console.log(`Pitch My Agent server running on port ${config.port} (x402 mode=${config.x402Mode})`);
  for (const r of TIER_ROUTES) {
    console.log(`  ${r.path} — $${r.price}, ${r.tier.durationSec}s${r.tier.liveSegment ? ", live segment" : ""}`);
  }
});
