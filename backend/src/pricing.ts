// Per-agent pricing.
//
// A flat price cannot be honest for the live-proof tier. That tier pays the
// target agent's own fee to produce real footage of its service running, and
// those fees are set by other people: $0.50 on one agent, $3 on the next. A
// fixed $4 either loses money on the expensive ones or overcharges everyone for
// the cheap ones.
//
// So the price is quoted per request: our own work is a fixed base, the demoed
// service's fee is passed through at cost, and `get_quote` (free) lets a caller
// see every option before paying. The same function computes the number quoted
// and the number charged, so the two can never disagree.
import { config } from "./config.js";
import type { AgentProfile, AgentService, TierId } from "./types.js";

export interface ServiceQuote {
  serviceId?: string;
  serviceName: string;
  /** The agent's own listed fee for this service, in USD. */
  serviceFeeUsd: number;
  /** What we pay that agent to record its service running. 0 on the animated tier. */
  passthroughUsd: number;
  /** Our own work: research, script, palette, narration, render. */
  baseUsd: number;
  totalUsd: number;
  /**
   * Set when the service costs more than `maxPassthroughUsd`. The pitch is still
   * produced and the price stays at base — the live segment then shows the
   * marketplace listing and the delivered artifact, without a paid call.
   */
  liveCallSkipped?: string;
}

const money = (n: number): number => Math.round(n * 100) / 100;

const feeUsd = (svc: AgentService): number => {
  const n = Number(svc.fee);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The service a pitch demos when the caller did not pick one: the cheapest. */
export function defaultService(agent: AgentProfile): AgentService | undefined {
  if (agent.services.length === 0) return undefined;
  return [...agent.services].sort((a, b) => feeUsd(a) - feeUsd(b))[0];
}

export function findService(agent: AgentProfile, serviceId?: string): AgentService | undefined {
  if (!serviceId) return defaultService(agent);
  return (
    agent.services.find((s) => s.serviceId === serviceId) ??
    agent.services.find((s) => s.name === serviceId)
  );
}

/**
 * Price one pitch. Deterministic: the quote a caller reads and the amount the
 * 402 challenge asks for come from this same call.
 */
export function quote(agent: AgentProfile, tier: TierId, serviceId?: string): ServiceQuote {
  const base = Number(tier === "live-proof" ? config.priceLiveProofUsd : config.priceAnimatedUsd);
  const svc = findService(agent, serviceId);
  const fee = svc ? feeUsd(svc) : 0;

  // The animated tier never calls the agent, so it never pays one.
  if (tier !== "live-proof" || !svc) {
    return {
      serviceId: svc?.serviceId,
      serviceName: svc?.name ?? "—",
      serviceFeeUsd: fee,
      passthroughUsd: 0,
      baseUsd: base,
      totalUsd: money(base),
    };
  }

  const cap = Number(config.maxPassthroughUsd);
  if (fee > cap) {
    return {
      serviceId: svc.serviceId,
      serviceName: svc.name,
      serviceFeeUsd: fee,
      passthroughUsd: 0,
      baseUsd: base,
      totalUsd: money(base),
      liveCallSkipped:
        `"${svc.name}" costs $${fee.toFixed(2)}, above the $${cap.toFixed(2)} per-pitch cap. ` +
        `The pitch is still produced and priced at $${money(base).toFixed(2)}, but the live segment ` +
        `shows the marketplace listing rather than a paid call. Pick a cheaper service to include one.`,
    };
  }

  return {
    serviceId: svc.serviceId,
    serviceName: svc.name,
    serviceFeeUsd: fee,
    passthroughUsd: fee,
    baseUsd: base,
    totalUsd: money(base + fee),
  };
}

/** Every service the caller could pick, priced. Backs the free `get_quote` tool. */
export function quoteAll(agent: AgentProfile, tier: TierId): ServiceQuote[] {
  if (agent.services.length === 0) return [quote(agent, tier)];
  return agent.services.map((s) => quote(agent, tier, s.serviceId ?? s.name));
}
