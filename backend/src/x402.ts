// x402 payment gate — mirrors the BoredComic ASP, which is the reference that
// actually passed OKX listing review. Same middleware shape, same 402 challenge,
// same free-discovery carve-out.
import type { Request, Response, NextFunction } from "express";
import { paymentMiddleware } from "@okxweb3/x402-express";
import { x402ResourceServer } from "@okxweb3/x402-express";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { config } from "./config.js";
import { fetchAgent, UnpitchableAgentError } from "./okx.js";


const NETWORK = "eip155:196";
const USDT0_XLAYER = "0x779ded0c9e1022225f8e0630b35a9b54be713736";

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

export const x402Enabled = (): boolean =>
  config.x402Mode !== "off" && !!config.x402PayTo;

/**
 * One resource server for the whole process — the facilitator sync is per
 * resource server, not per route, so every paid path must share it.
 */
let resourceServer: InstanceType<typeof x402ResourceServer> | null = null;

function getResourceServer(): InstanceType<typeof x402ResourceServer> {
  if (!resourceServer) {
    const facilitator = new OKXFacilitatorClient({
      apiKey: config.xlayerApiKey,
      secretKey: config.xlayerSecretKey,
      passphrase: config.xlayerPassphrase,
      syncSettle: true,
    });
    resourceServer = new x402ResourceServer(facilitator).register(
      NETWORK,
      new ExactEvmScheme(),
    );
  }
  return resourceServer;
}

/**
 * Sync with the OKX facilitator at boot rather than on the first paid request,
 * so the facilitator sees this resource server as an integrated seller before
 * any listing probe arrives, and bad X Layer credentials fail at deploy time.
 */
export async function warmFacilitator(): Promise<void> {
  if (!x402Enabled()) return;
  await getResourceServer().initialize();
}

const paidCache = new Map<string, Handler>();

/**
 * x402 gate for one route, served entirely by the official OKX SDK.
 *
 * The SDK builds the 402 itself, from requirements negotiated with the
 * facilitator — including the `error` field and any declared extensions that a
 * hand-rolled challenge cannot reproduce. Never bypass it for unpaid requests:
 * an endpoint that answers probes with its own challenge looks un-integrated to
 * the marketplace validator, which is what delisted the sibling ASPs with "not
 * integrated with the official OKX Payment SDK".
 *
 * `routeKey` is a bare path (no HTTP verb) so one middleware and one set of
 * requirements answers both the validator's GET probe and the real POST call.
 */
export function paidRoute(routeKey: string, description: string, priceUsd: string): Handler {
  return (req, res, next) => {
    if (!x402Enabled()) return next();

    let mw = paidCache.get(routeKey);
    if (!mw) {
      mw = paymentMiddleware(
        {
          [routeKey]: {
            accepts: {
              scheme: "exact",
              price: `$${priceUsd}`,
              network: NETWORK,
              payTo: config.x402PayTo,
            },
            description,
            mimeType: "application/json",
          },
        },
        getResourceServer(),
      ) as unknown as Handler;
      paidCache.set(routeKey, mw);
    }
    // The SDK middleware is async and routes its own failures to next(error);
    // .catch is the backstop so a rejection can never surface as an unhandled
    // promise rejection and take the process down.
    return void Promise.resolve(mw(req, res, next)).catch(next);
  };
}

// Read-only / polling tools stay free so a caller can discover the service and
// poll a running job without paying. Only generation is metered.
const FREE_TOOLS = new Set(["get_quota", "get_job", "retry_job", "preview_spec"]);

/**
 * x402 gate for an MCP endpoint. MCP protocol/discovery methods (initialize,
 * notifications/*, tools/list, ping) MUST stay free so an MCP client — including
 * the OKX listing validator — can complete the handshake and discover tools.
 * Gating the whole endpoint 402s the handshake itself, and the review times out.
 */
export function mcpPaidRoute(routeKey: string, description: string, priceUsd: string): Handler {
  const paid = paidRoute(routeKey, description, priceUsd);
  return (req, res, next) => {
    const body = req.body as { method?: string; params?: { name?: string } } | undefined;
    if (body?.method !== "tools/call") return next();
    if (FREE_TOOLS.has(body?.params?.name ?? "")) return next();
    return void paid(req, res, next);
  };
}

/**
 * Terminal handler for a validator's bare GET probe, mounted behind the SDK
 * middleware. An unpaid probe never reaches it — the SDK already sent 402.
 * Answering 402 here means a GET that does carry payment is not charged: a
 * >=400 status makes the SDK skip settlement, and a bare GET delivers nothing.
 */
export function probeFallback(_req: Request, res: Response): void {
  res.status(402).json({});
}

type ToolArgs = { agentId?: unknown; style?: unknown; jobId?: unknown };

const VALID_STYLES = new Set(["terminal", "playful", "saas"]);

/**
 * Reject clearly-bad input BEFORE payment: a deterministic failure must never be
 * charged for. Returns an error message, or null when the input is acceptable.
 */
export function preflightError(tool: string, args: ToolArgs | undefined): string | null {
  if (tool === "generate_pitch" || tool === "preview_spec") {
    const agentId = args?.agentId;
    if (typeof agentId !== "string" && typeof agentId !== "number") {
      return "agentId is required (the target agent's marketplace id, e.g. \"6006\").";
    }
    if (!/^\d+$/.test(String(agentId))) return "agentId must be numeric, e.g. \"6006\".";
    if (args?.style !== undefined && !VALID_STYLES.has(String(args.style))) {
      return `style must be one of: ${[...VALID_STYLES].join(", ")}.`;
    }
    return null;
  }
  if (tool === "get_job") {
    if (typeof args?.jobId !== "string" || !args.jobId) return "jobId is required.";
    return null;
  }
  return null;
}

/**
 * Read a plain REST body as a generate_pitch call.
 *
 * The facilitator replays a paid request with whatever body the buyer sent. A
 * buyer who paid first and then replayed `{"agentId":"8421"}` used to get a
 * JSON-RPC parse error — `mcpPaidRoute` waves through anything whose method
 * isn't `tools/call`, so the request bypassed the payment gate entirely and hit
 * the transport, which rejected it after their money had already moved. Reading
 * the obvious shape removes that whole class: a paid body carrying an agentId
 * is a pitch request, envelope or no envelope.
 *
 * Only a body with no `method` at all is rewritten, so MCP handshake traffic
 * (initialize, tools/list, notifications/*) is untouched.
 */
export function normalizeToolCall() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object" || Array.isArray(body)) return next();
    if (typeof body.method === "string") return next();
    if (body.agentId === undefined) return next();

    const { agentId, style, voice } = body as { agentId?: unknown; style?: unknown; voice?: unknown };
    req.body = {
      jsonrpc: "2.0",
      id: body.id ?? null,
      method: "tools/call",
      params: {
        name: typeof body.tool === "string" ? body.tool : "generate_pitch",
        arguments: { agentId, ...(style !== undefined ? { style } : {}), ...(voice !== undefined ? { voice } : {}) },
      },
    };
    next();
  };
}

// Tools whose target agent must be real and sellable before anything else runs.
const AGENT_GATED_TOOLS = new Set(["generate_pitch", "preview_spec"]);

/**
 * Refuse an unrenderable target BEFORE the payment gate.
 *
 * A video is built out of the target's profile, services and prices. An agent
 * with none of those cannot produce one, so accepting payment for it bills the
 * buyer for a render that can never succeed. The same gate covers the free
 * preview and the paid render, so the preview's verdict is the render's verdict.
 */
export function targetAgentGate() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const body = req.body as
      | { method?: string; id?: unknown; params?: { name?: string; arguments?: { agentId?: unknown } } }
      | undefined;
    if (body?.method !== "tools/call") return next();
    if (!AGENT_GATED_TOOLS.has(body.params?.name ?? "")) return next();

    const agentId = body.params?.arguments?.agentId;
    // Shape problems are mcpPreflight's job; this gate only judges the target.
    if (typeof agentId !== "string" && typeof agentId !== "number") return next();

    try {
      await fetchAgent(String(agentId));
      next();
    } catch (err) {
      if (err instanceof UnpitchableAgentError) {
        res.status(400).json({
          jsonrpc: "2.0",
          id: body.id ?? null,
          error: { code: -32602, message: `Rejected before payment: ${err.message}`, data: { reason: err.reason, charged: false } },
        });
        return;
      }
      // Couldn't reach the marketplace — refuse rather than charge on a guess.
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: -32000, message: `Could not verify the target agent — not charged: ${message}`, data: { charged: false } },
      });
    }
  };
}

/** MCP preflight middleware: validates a tools/call body before the payment gate. */
export function mcpPreflight() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body as
      | { method?: string; id?: unknown; params?: { name?: string; arguments?: ToolArgs } }
      | undefined;
    if (body?.method !== "tools/call") return next();

    const err = preflightError(body?.params?.name ?? "", body?.params?.arguments);
    if (err) {
      res.status(400).json({
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: -32602, message: `Rejected before payment: ${err}` },
      });
      return;
    }
    next();
  };
}

export function x402Info(): Record<string, unknown> {
  return {
    enabled: x402Enabled(),
    x402Version: 2,
    pricing: {
      asset: USDT0_XLAYER,
      assetSymbol: "USDT0",
      network: NETWORK,
      payTo: config.x402PayTo || null,
    },
    settlement: "on-chain, settled by the OKX facilitator (@okxweb3/x402-express)",
    free: ["initialize", "tools/list", "get_quota", "get_job", "retry_job", "preview_spec"],
    note:
      "Generation returns a jobId immediately and renders in the background — the " +
      "facilitator's authorization window is far shorter than a full render. Poll " +
      "the free get_job tool for the finished video. A failed render answers >=400, " +
      "so it is never settled.",
  };
}
