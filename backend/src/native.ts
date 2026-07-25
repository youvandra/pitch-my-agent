// x402-native paid-tool handler.
//
// The OKX facilitator replays a paid call as a single PLAIN-JSON POST (Accept:
// application/json) and settles based on the response: it settles on 2xx and
// skips settlement on any >=400. The MCP StreamableHTTP transport rejects that
// plain POST (it demands text/event-stream) and answers with an SSE stream even
// when coaxed past it — so the facilitator can neither read a result nor settle.
// This handler bypasses the transport for the paid tool: it starts the job and
// returns one plain-JSON 200 body, exactly what the buyer flow expects.
import type { Request, Response } from "express";
import { runPipeline, etaSeconds, type TierSpec } from "./pipeline.js";
import { createJob } from "./store.js";
import type { GeneratePitchInput, VisualStyle, VoiceGender } from "./types.js";

export const PAID_TOOLS = new Set(["generate_pitch"]);

function rpcResult(id: unknown, payload: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id: id ?? null,
    result: {
      content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    },
  };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}

/**
 * Handle a paid `tools/call`. Input was already validated by mcpPreflight
 * (before payment) and payment was verified by the x402 middleware, so this
 * only starts the work and returns a handle.
 */
export async function handleNativePaidCall(req: Request, res: Response, tier: TierSpec): Promise<void> {
  const body = req.body as {
    id?: unknown;
    params?: { name?: string; arguments?: Record<string, unknown> };
  };
  const id = body?.id;
  const name = body?.params?.name ?? "";
  const args = body?.params?.arguments ?? {};

  if (!PAID_TOOLS.has(name)) {
    res.status(400).json(rpcError(id, -32601, `Unknown paid tool: ${name}`));
    return;
  }

  try {
    const input: GeneratePitchInput = {
      agentId: String(args.agentId),
      style: args.style as VisualStyle | undefined,
      voice: args.voice as VoiceGender | undefined,
    };
    const jobId = `pma_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    createJob({
      jobId,
      input,
      tier: tier.id,
      stage: "queued",
      startedAt: Date.now(),
    });

    // Return the handle immediately and render in the background. x402 settles on
    // this response, and the facilitator's authorization window (~300s) is much
    // shorter than a full render — holding the connection would let the payment
    // expire before settlement.
    void runPipeline(jobId, input, tier);

    res.status(200).json(
      rpcResult(id, {
        jobId,
        status: "generating",
        stage: "queued",
        tier: tier.id,
        etaSeconds: etaSeconds(),
        next: "Poll the free get_job tool with this jobId every ~15 seconds until it returns the delivery.",
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool execution failed";
    // >=400 → the x402 middleware skips settlement, so a failure is never charged.
    res.status(502).json(rpcError(id, -32000, message));
  }
}
