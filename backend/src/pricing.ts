// What each tier costs.
//
// An A2MCP listing carries a fixed fee — `onchainos agent update --service`
// requires it — so the price is a constant per endpoint, and this module exists
// only to keep that constant in one place alongside the endpoint it belongs to.
//
// An earlier version priced each pitch against the demoed agent's own service
// fee, because the live tier used to buy a real call to it. It no longer does:
// the live segment films the marketplace listing, which costs nothing to record.
import { config } from "./config.js";
import type { TierId } from "./types.js";

export interface TierPricing {
  endpoint: string;
  priceUsd: number;
}

export const TIER_PRICING: Record<TierId, TierPricing> = {
  animated: { endpoint: "/pitch/animated", priceUsd: Number(config.priceAnimatedUsd) },
  "live-proof": { endpoint: "/pitch/live-proof", priceUsd: Number(config.priceLiveProofUsd) },
};
