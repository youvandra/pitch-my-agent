// MCP server — the agent-facing surface.
//
// Discovery (initialize / tools/list) and the read-only tools are free so any
// client, including the OKX listing validator, can connect and inspect the
// service before spending anything.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.js";
import { fetchAgent } from "./okx.js";
import { buildPalette } from "./palette.js";
import { buildSpec } from "./spec.js";
import { jobStatus, TIERS, type TierSpec } from "./pipeline.js";
import { x402Info } from "./x402.js";
import type { VisualStyle } from "./types.js";

const AGENT_ID = z
  .string()
  .regex(/^\d+$/, "must be a numeric marketplace agent id, e.g. \"6006\"")
  .describe("The target agent's OKX.ai marketplace id, e.g. \"6006\".");

const STYLE = z
  .enum(["terminal", "playful", "saas"])
  .optional()
  .describe("Visual theme. The target agent's own brand colors are layered on top.");

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const SERVER_INSTRUCTIONS = `Pitch My Agent — turns any agent on the OKX.ai marketplace into a ready-to-use demo video.

WHAT IT DOES:
Give it an agent id. It reads that agent's public profile and services, derives a palette from its logo, writes the script, renders an mp4, and hands back a hosted video URL.

BEFORE YOU CALL generate_pitch:
- Ask your user whether they want a MALE or FEMALE narrator. It is the most noticeable choice in the result, and changing it means paying for another render. Pass it as the "voice" argument.
- Narration and on-screen copy are always in English — the audience is the OKX.ai marketplace.

WHICH TOOL:
- Want the finished video? -> generate_pitch (paid). Returns a jobId immediately; rendering runs in the background.
- Want to see the script/colors first, for free? -> preview_spec. Same pipeline minus the render.
- Waiting on a render? -> get_job (FREE). Poll roughly every 15 seconds.
- Budgeting? -> get_quota (FREE).

HOW BILLING WORKS:
- generate_pitch answers fast with a jobId because a full render takes minutes — far longer than the payment authorization window. That is why you poll instead of waiting on the connection.
- Malformed input is rejected BEFORE payment, and a failed render answers with an error status, so you are not charged for a video you never received.

WHAT YOU GET BACK:
When get_job reports status "done" it returns the delivery: videoUrl (a downloadable 1080p mp4), thumbnailUrl (poster image), durationSec, resolution, the brand palette used, and the full spec the video was built from. Hand videoUrl to your user — it is a direct link they can play or download.`;

/** Free tools: discovery, preview, polling, pricing. */
function registerFreeTools(server: McpServer): void {
  const READ_ONLY = { readOnlyHint: true } as const;

  server.registerTool(
    "preview_spec",
    {
      title: "Preview pitch script",
      annotations: READ_ONLY,
      description:
        "FREE. Build the full video plan for an agent — tagline, scene copy, service cards, and " +
        "the brand palette derived from its logo — without rendering. Use this to check the script " +
        "and colors before paying for a render.",
      inputSchema: { agentId: AGENT_ID, style: STYLE },
    },
    async ({ agentId, style }) => {
      const visualStyle: VisualStyle = style ?? "terminal";
      const agent = await fetchAgent(agentId);
      const theme = await buildPalette(agent.agentId, agent.avatarUrl, visualStyle);
      const spec = await buildSpec(agent, visualStyle, theme, TIERS.animated.durationSec);
      return json({ agent: { id: agent.agentId, name: agent.name, services: agent.services.length }, spec });
    },
  );

  server.registerTool(
    "get_job",
    {
      title: "Get job status",
      annotations: READ_ONLY,
      description:
        "FREE. Check a render started by generate_pitch. While running it reports the current stage; " +
        "when finished it returns the full delivery (videoUrl, thumbnailUrl, duration, theme, spec). " +
        "Poll roughly every 15 seconds. Never counts against payment.",
      inputSchema: { jobId: z.string().describe("The jobId returned by generate_pitch.") },
    },
    async ({ jobId }) => {
      const status = jobStatus(jobId);
      return json(status ?? { error: "unknown or expired jobId" });
    },
  );

  server.registerTool(
    "get_quota",
    {
      title: "Get pricing",
      annotations: READ_ONLY,
      description: "FREE. Current x402 pricing, tiers, and what is billed. Never charged.",
      inputSchema: {},
    },
    async () =>
      json({
        ...x402Info(),
        tiers: {
          animated: {
            endpoint: "/pitch/animated",
            price: `$${config.priceAnimatedUsd}`,
            includes: "motion-graphics pitch with narration, captions and music",
          },
          "live-proof": {
            endpoint: "/pitch/live-proof",
            price: `$${config.priceLiveProofUsd}`,
            includes:
              "everything in Animated Pitch, plus a real screen recording of this agent " +
              "being opened and used on the OKX.ai marketplace, spliced into the middle",
          },
        },
      }),
  );
}

/**
 * Server for a paid tier endpoint. The paid tool is declared here so it shows up
 * in tools/list, but it is executed by the x402-native handler (see native.ts) —
 * the facilitator replays paid calls as plain JSON, which the MCP transport
 * cannot answer in a settleable form.
 */
export function buildPitchServer(tier: TierSpec, priceUsd: string): McpServer {
  const server = new McpServer(
    { name: "Pitch My Agent", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "generate_pitch",
    {
      title: "Generate demo video",
      description:
        `Generate a ${tier.durationSec}s demo video for an agent on the OKX.ai marketplace ($${priceUsd}). ` +
        `Reads the agent's profile and services, derives its brand palette from its logo, writes the script, ` +
        `and renders a 1080p mp4` +
        (tier.liveSegment ? " with a recorded live segment of the agent actually being called." : ".") +
        ` Returns a jobId immediately — poll the free get_job tool for the finished video.`,
      inputSchema: {
        agentId: AGENT_ID,
        style: STYLE,
        voice: z
          .enum(["male", "female", "neutral"])
          .optional()
          .describe(
            "Narrator voice. ASK YOUR USER whether they want a male or female narrator before " +
              "calling this — it is the most noticeable choice in the finished video and cannot be " +
              "changed without re-rendering (and re-paying). Narration is always in English. " +
              "Omit only if the user has no preference.",
          ),
        ...(tier.liveSegment
          ? {
              includeLiveSegment: z
                .boolean()
                .optional()
                .describe("Include the recorded live-call segment (default true)."),
            }
          : {}),
      },
    },
    async () =>
      json({
        error:
          "generate_pitch must be called with an x402 payment on this endpoint; " +
          "the paid call is handled natively. See get_quota for pricing.",
      }),
  );

  registerFreeTools(server);
  return server;
}
