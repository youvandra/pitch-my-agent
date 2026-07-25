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

/**
 * Run the CLI, retrying transient failures.
 *
 * This lookup is the first step of a job the buyer has already paid for — the
 * x402 settlement happens when the jobId is issued — so a single hiccup
 * reaching the marketplace must not cost them the render. Observed in
 * production: the same call that failed a job succeeded 420ms later on retry.
 *
 * Only the transport is retried. `ok:false` is the marketplace answering
 * properly (no such agent, say), and repeating it would just waste time.
 */
async function onchainos(args: string[], attempts = 3): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const { stdout } = await run(config.onchainosBin, args, {
        timeout: CLI_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout) as { ok?: boolean; error?: string; data?: unknown };
      if (parsed.ok === false) throw new Error(parsed.error || "onchainos returned ok:false");
      return parsed.data;
    } catch (err) {
      lastErr = err;
      const answered = err instanceof Error && /onchainos returned ok:false/.test(err.message);
      if (answered || i === attempts - 1) break;
      console.warn(
        `onchainos ${args[1]} failed (attempt ${i + 1}/${attempts}), retrying:`,
        err instanceof Error ? err.message.split("\n")[0] : err,
      );
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw lastErr;
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
