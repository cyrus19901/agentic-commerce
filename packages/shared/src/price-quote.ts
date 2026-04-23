/**
 * Price Quote — represents a real-time, provider-driven price breakdown.
 *
 * When Gordon probes a provider's x402 endpoint (or uses their pricing API),
 * the response is parsed into a ProviderPriceQuote. Gordon then wraps it
 * with its own margin to produce the final PriceQuote shown to the buyer.
 */

export interface ProviderPriceQuote {
  /** Provider identifier */
  providerId: string;
  /** Action being priced (e.g. "scrape", "search") */
  action: string;
  /** Provider's price in USDC (human-readable, e.g. 0.01) */
  providerCostUsdc: number;
  /** Provider's price in atomic units (e.g. "10000" for 0.01 USDC) */
  providerCostAtomic: string;
  /** Provider's wallet address (payTo) — where the money goes */
  payTo: string;
  /** Networks the provider supports for settlement */
  supportedNetworks: string[];
  /** The raw 402 response from the provider (if available) */
  raw402?: unknown;
  /** Whether this came from a live provider probe vs DB fallback */
  source: 'probe' | 'db_fallback' | 'env_fallback';
  /** Timestamp of the quote */
  quotedAt: number;
  /** How long the quote is valid (ms). Defaults to 60s. */
  ttlMs: number;
}

export interface PriceQuote extends ProviderPriceQuote {
  /** Gordon's platform fee in USDC */
  gordonFeeUsdc: number;
  /** Total price the buyer pays (providerCostUsdc + gordonFeeUsdc) */
  totalUsdc: number;
  /** Total in atomic units */
  totalAtomic: string;
  /** Fee as a percentage (e.g. 10 for 10%) */
  feePercent: number;
}

/**
 * Default Gordon fee percentage applied on top of provider cost.
 * Can be overridden per-org or per-provider.
 */
export const DEFAULT_GORDON_FEE_PERCENT = 10;

/**
 * Build a full PriceQuote from a provider quote + optional fee override.
 */
export function buildPriceQuote(
  providerQuote: ProviderPriceQuote,
  feePercent: number = DEFAULT_GORDON_FEE_PERCENT,
): PriceQuote {
  const gordonFeeUsdc = parseFloat((providerQuote.providerCostUsdc * (feePercent / 100)).toFixed(6));
  const totalUsdc = parseFloat((providerQuote.providerCostUsdc + gordonFeeUsdc).toFixed(6));
  const totalAtomic = Math.round(totalUsdc * 1_000_000).toString();

  return {
    ...providerQuote,
    gordonFeeUsdc,
    totalUsdc,
    totalAtomic,
    feePercent,
  };
}

/**
 * Create a fallback ProviderPriceQuote from DB/env data (no live probe).
 */
export function fallbackProviderQuote(
  providerId: string,
  action: string,
  costUsdc: number,
  payTo: string,
  supportedNetworks: string[],
  source: 'db_fallback' | 'env_fallback' = 'db_fallback',
): ProviderPriceQuote {
  return {
    providerId,
    action,
    providerCostUsdc: costUsdc,
    providerCostAtomic: Math.round(costUsdc * 1_000_000).toString(),
    payTo,
    supportedNetworks,
    source,
    quotedAt: Date.now(),
    ttlMs: 60_000,
  };
}
