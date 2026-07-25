// What each tier costs.
//
// An A2MCP listing carries a fixed fee — `onchainos agent update --service`
// requires it — so the price is a constant per endpoint, and this module exists
// only to keep that constant in one place alongside the endpoint it belongs to.
//
// One service, one price. Earlier versions had a second tier that recorded the
// marketplace, and briefly a third that paid the demoed agent — both are gone;
// what this sells is the animated pitch.
import { config } from "./config.js";
import type { TierId } from "./types.js";

export interface TierPricing {
  endpoint: string;
  priceUsd: number;
}

export const TIER_PRICING: Record<TierId, TierPricing> = {
  animated: { endpoint: "/pitch/animated", priceUsd: Number(config.priceAnimatedUsd) },
};
