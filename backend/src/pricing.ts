// Which tier can demo which service, and what it costs.
//
// The live tiers pay the target agent's own fee to film its service actually
// running, and those fees belong to other people: $0.50 on one service, $3 on
// the next. A single flat price either loses money on the expensive ones or
// overcharges everyone for the cheap ones.
//
// The fix is price bands rather than a per-request quote. Each tier is a
// separate marketplace listing with a fixed fee — which is what an A2MCP
// listing requires anyway — and covers target services up to a stated ceiling.
// Past the top band the pitch is refused before payment, with the reason, since
// producing it would cost us more than it earns.
import { config } from "./config.js";
import type { AgentProfile, AgentService, TierId } from "./types.js";

/** What a tier charges, and the most it can pay the demoed agent. */
export interface TierPricing {
  endpoint: string;
  priceUsd: number;
  /** Highest target-service fee this tier covers. 0 for the animated tier. */
  maxServiceFeeUsd: number;
}

export const TIER_PRICING: Record<TierId, TierPricing> = {
  animated: {
    endpoint: "/pitch/animated",
    priceUsd: Number(config.priceAnimatedUsd),
    maxServiceFeeUsd: 0,
  },
  "live-proof": {
    endpoint: "/pitch/live-proof",
    priceUsd: Number(config.priceLiveProofUsd),
    maxServiceFeeUsd: Number(config.maxServiceFeeLiveProofUsd),
  },
  "live-proof-plus": {
    endpoint: "/pitch/live-proof-plus",
    priceUsd: Number(config.priceLiveProofPlusUsd),
    maxServiceFeeUsd: Number(config.maxServiceFeeLiveProofPlusUsd),
  },
};

/** Live tiers, cheapest first — the order they should be offered in. */
const LIVE_TIERS: TierId[] = ["live-proof", "live-proof-plus"];

export const feeUsd = (svc: AgentService): number => {
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

/** Cheapest live tier whose ceiling covers this fee, or undefined if none does. */
export function tierForFee(fee: number): TierId | undefined {
  return LIVE_TIERS.find((t) => fee <= TIER_PRICING[t].maxServiceFeeUsd);
}

export interface ServiceOption {
  serviceId?: string;
  serviceName: string;
  serviceFeeUsd: number;
  /** Tier that can demo this service live, if any. */
  tier?: TierId;
  endpoint?: string;
  priceUsd?: number;
  /** Set when no live tier covers this service. */
  unsupported?: string;
}

/** Price one service against the live tiers. Backs the free `get_quote` tool. */
export function optionFor(svc: AgentService): ServiceOption {
  const fee = feeUsd(svc);
  const tier = tierForFee(fee);
  if (!tier) {
    const top = TIER_PRICING["live-proof-plus"];
    return {
      serviceId: svc.serviceId,
      serviceName: svc.name,
      serviceFeeUsd: fee,
      unsupported:
        `"${svc.name}" costs $${fee.toFixed(2)}. The highest live tier covers services up to ` +
        `$${top.maxServiceFeeUsd.toFixed(2)}, so we cannot buy a real call to it — filming this one ` +
        `would cost us more than the pitch earns. Pick a cheaper service from this agent, or use ` +
        `${TIER_PRICING.animated.endpoint} for an animated pitch with no recorded call.`,
    };
  }
  const pricing = TIER_PRICING[tier];
  return {
    serviceId: svc.serviceId,
    serviceName: svc.name,
    serviceFeeUsd: fee,
    tier,
    endpoint: pricing.endpoint,
    priceUsd: pricing.priceUsd,
  };
}

export function optionsFor(agent: AgentProfile): ServiceOption[] {
  return agent.services.map(optionFor);
}

/**
 * Reject a paid call this tier cannot honour, BEFORE payment.
 *
 * Charging for a live-proof pitch and then quietly delivering one without the
 * live segment would be taking money for the thing that defines the tier.
 * Returns an error message, or null when the tier can do the job.
 */
export function tierMismatch(
  agent: AgentProfile,
  tier: TierId,
  serviceId?: string,
): string | null {
  if (tier === "animated") return null;
  const svc = findService(agent, serviceId);
  if (!svc) return null; // No services to demo: handled as a normal degrade.

  const fee = feeUsd(svc);
  const ceiling = TIER_PRICING[tier].maxServiceFeeUsd;
  if (fee <= ceiling) return null;

  const better = tierForFee(fee);
  if (better) {
    const p = TIER_PRICING[better];
    return (
      `"${svc.name}" costs $${fee.toFixed(2)}, above the $${ceiling.toFixed(2)} this tier covers. ` +
      `Use ${p.endpoint} ($${p.priceUsd.toFixed(2)}) for this service, or pick a cheaper one.`
    );
  }
  return optionFor(svc).unsupported ?? null;
}
