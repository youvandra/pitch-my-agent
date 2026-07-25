// x402 payment gate — mirrors the BoredComic ASP, which is the reference that
// actually passed OKX listing review. Same middleware shape, same 402 challenge,
// same free-discovery carve-out.
import type { Request, Response, NextFunction } from "express";
import { paymentMiddleware } from "@okxweb3/x402-express";
import { x402ResourceServer } from "@okxweb3/x402-express";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { config } from "./config.js";
import { fetchAgent } from "./okx.js";
import { tierMismatch } from "./pricing.js";
import type { TierId } from "./types.js";

const NETWORK = "eip155:196";
const USDT0_XLAYER = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const USDT0_DECIMALS = 6;

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

export const x402Enabled = (): boolean =>
  config.x402Mode !== "off" && !!config.x402PayTo;

const paidCache = new Map<string, Handler>();

function buildPaidMiddleware(routeKey: string, description: string, priceUsd: string): Handler {
  const facilitator = new OKXFacilitatorClient({
    apiKey: config.xlayerApiKey,
    secretKey: config.xlayerSecretKey,
    passphrase: config.xlayerPassphrase,
    syncSettle: true,
  });
  const resourceServer = new x402ResourceServer(facilitator).register(
    NETWORK,
    new ExactEvmScheme(),
  );
  return paymentMiddleware(
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
    resourceServer,
  ) as unknown as Handler;
}

export function paidRoute(routeKey: string, description: string, priceUsd: string): Handler {
  return (req, res, next) => {
    if (!x402Enabled()) return next();

    const hasProof =
      req.headers["payment-signature"] ||
      req.headers["x-payment"] ||
      req.headers["x402-authorization"] ||
      req.headers["x402-payment"];

    if (hasProof) {
      let mw = paidCache.get(routeKey);
      if (!mw) {
        mw = buildPaidMiddleware(routeKey, description, priceUsd);
        paidCache.set(routeKey, mw);
      }
      return void mw(req, res, next);
    }
    return send402Challenge(req, res, description, priceUsd);
  };
}

// Read-only / polling tools stay free so a caller can discover the service and
// poll a running job without paying. Only generation is metered.
const FREE_TOOLS = new Set(["get_quota", "get_quote", "get_job", "preview_spec"]);

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

export function send402Challenge(
  req: Request,
  res: Response,
  description: string,
  priceUsd: string,
): void {
  const amount = Math.round(Number(priceUsd) * 10 ** USDT0_DECIMALS).toString();
  const challenge = {
    x402Version: 2,
    resource: {
      url: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
      description,
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: NETWORK,
        amount,
        asset: USDT0_XLAYER,
        payTo: config.x402PayTo,
        // Must match the window the OKX facilitator accepts for EIP-3009
        // authorizations on X Layer. A longer window makes the buyer sign a
        // validBefore the facilitator rejects, so verification fails with an
        // empty 402 before settling.
        maxTimeoutSeconds: 300,
        extra: { name: "USD₮0", version: "1" },
      },
    ],
  };
  res.setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(challenge)).toString("base64"));
  res.status(402).json(challenge);
}

type ToolArgs = { agentId?: unknown; serviceId?: unknown; style?: unknown; jobId?: unknown };

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
 * MCP preflight middleware: validates a tools/call body before the payment gate.
 *
 * As well as malformed input, this rejects a service the tier cannot afford to
 * call. That check needs the target agent's fees, so it is a network round trip
 * — worth it, because the alternative is charging for a live-proof pitch and
 * then delivering one without the live segment that defines it.
 */
export function mcpPreflight(tier: TierId) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const body = req.body as
      | { method?: string; id?: unknown; params?: { name?: string; arguments?: ToolArgs } }
      | undefined;
    if (body?.method !== "tools/call") return next();

    const reject = (message: string): void => {
      res.status(400).json({
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: -32602, message: `Rejected before payment: ${message}` },
      });
    };

    const err = preflightError(body?.params?.name ?? "", body?.params?.arguments);
    if (err) return reject(err);

    const args = body?.params?.arguments;
    if (body?.params?.name === "generate_pitch" && args?.agentId != null) {
      try {
        const agent = await fetchAgent(String(args.agentId));
        const serviceId = typeof args.serviceId === "string" ? args.serviceId : undefined;
        const mismatch = tierMismatch(agent, tier, serviceId);
        if (mismatch) return reject(mismatch);
      } catch (lookupErr) {
        // A lookup failure is ours, not the caller's — let the request through
        // rather than refusing a job that may be perfectly payable. The pipeline
        // retries the same lookup and reports honestly if it fails again.
        console.warn(
          "tier preflight could not read the agent:",
          lookupErr instanceof Error ? lookupErr.message.split("\n")[0] : lookupErr,
        );
      }
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
    free: ["initialize", "tools/list", "get_quota", "get_job", "preview_spec"],
    note:
      "Generation returns a jobId immediately and renders in the background — the " +
      "facilitator's authorization window is far shorter than a full render. Poll " +
      "the free get_job tool for the finished video. A failed render answers >=400, " +
      "so it is never settled.",
  };
}
