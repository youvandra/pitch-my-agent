// Agent metadata lookup via the onchainos CLI.
//
// Deliberately NOT scraping okx.ai/agent/{id} HTML: the CLI returns structured
// JSON (name, description, avatar, services, fees, endpoints) and does not break
// when the marketplace redesigns.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import type { AgentProfile, AgentService } from "./types.js";

const run = promisify(execFile);

const CLI_TIMEOUT_MS = 30_000;

async function onchainos(args: string[]): Promise<unknown> {
  const { stdout } = await run(config.onchainosBin, args, {
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as { ok?: boolean; error?: string; data?: unknown };
  if (parsed.ok === false) throw new Error(parsed.error || "onchainos returned ok:false");
  return parsed.data;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Fetch an agent's public profile and the services it sells.
 *
 * `service-list` already embeds the agent info, so one call covers both. The
 * services carry the exact name/fee/endpoint shown on the marketplace listing —
 * which is what the video's pricing scene should quote.
 */
export async function fetchAgent(agentId: string): Promise<AgentProfile> {
  const data = (await onchainos(["agent", "service-list", "--agent-id", String(agentId)])) as
    | Array<{ agentInfo?: Record<string, unknown>; list?: Array<Record<string, unknown>> }>
    | undefined;

  const entry = Array.isArray(data) ? data[0] : undefined;
  if (!entry?.agentInfo) throw new Error(`Agent ${agentId} not found on the marketplace.`);

  const info = entry.agentInfo;
  const services: AgentService[] = (entry.list ?? []).map((s) => ({
    serviceId: str(s.serviceId) || undefined,
    name: str(s.serviceName) || str(s.name) || "Service",
    description: str(s.serviceDescription),
    type: str(s.serviceType) || "A2MCP",
    fee: str(s.fee),
    endpoint: str(s.endpoint),
  }));

  return {
    agentId: String(agentId),
    name: str(info.name) || `Agent #${agentId}`,
    description: str(info.profileDescription),
    avatarUrl: str(info.profilePicture),
    role: str(info.roleLabel) || (info.role === 2 ? "ASP" : "User"),
    status: str(info.statusLabel) || undefined,
    services,
  };
}
