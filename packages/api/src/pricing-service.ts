import { randomUUID } from 'crypto';
import { DB } from '@agentic-commerce/database';
import { fetchProviderX402Price, normalizeProviderConfig } from './archtools-adapter';
import { hydrateProviderSecret } from './provider-security';

export type ServiceQuote = {
  quoteId: string;
  agentId: string;
  serviceType: string;
  amountAtomic: number; // USDC atomic units (6 decimals)
  amountUsd: number; // human-readable USDC/USD value
  currency: 'USDC';
  expiresAt: string;
  source: 'static-map' | 'agent-metadata' | 'provider-x402';
  toolRef?: string;
};

const BASE_PRICES_ATOMIC: Record<string, number> = {
  scrape: 100_000, // 0.1 USDC
  'data-scraping': 100_000,
  'api-call': 100_000,
  'api-calling': 100_000,
  computation: 100_000,
  'data-analysis': 200_000,
  'advanced-analysis': 3_000_000,
  'ml-inference': 2_500_000,
  'data-pipeline': 5_000_000,
  default: 100_000,
};

export class PricingService {
  private buildQuote(input: {
    agentId: string;
    serviceType: string;
    amountAtomic: number;
    source: ServiceQuote['source'];
    toolRef?: string;
    expiresInMs?: number;
  }): ServiceQuote {
    const amountAtomic = Math.max(1, Math.floor(input.amountAtomic));
    return {
      quoteId: `quote_${randomUUID()}`,
      agentId: input.agentId,
      serviceType: input.serviceType,
      amountAtomic,
      amountUsd: amountAtomic / 1_000_000,
      currency: 'USDC',
      expiresAt: new Date(Date.now() + (input.expiresInMs ?? 60_000)).toISOString(),
      source: input.source,
      ...(input.toolRef && { toolRef: input.toolRef }),
    };
  }

  quoteService(agentId: string, serviceType: string): ServiceQuote {
    const amountAtomic = BASE_PRICES_ATOMIC[serviceType] ?? BASE_PRICES_ATOMIC.default;
    return this.buildQuote({
      agentId,
      serviceType,
      amountAtomic,
      source: 'static-map',
    });
  }

  async quoteForAgent(db: DB, agentId: string, serviceType: string): Promise<ServiceQuote> {
    const registered = await db.getRegisteredAgent(agentId);
    const providerRaw = hydrateProviderSecret(registered?.metadata?.provider);
    const provider = normalizeProviderConfig({
      ...providerRaw,
      apiKey: providerRaw?.apiKey || process.env.ARCH_TOOLS_API_KEY,
      baseUrl: providerRaw?.baseUrl || process.env.ARCH_TOOLS_BASE_URL || providerRaw?.endpoint,
    });

    // Preferred production path for dynamic providers using x402 pricing.
    if (provider && provider.pricingStrategy === 'x402') {
      const priced = await fetchProviderX402Price(serviceType, provider);
      return this.buildQuote({
        agentId,
        serviceType,
        amountAtomic: priced.amountAtomic,
        source: 'provider-x402',
        toolRef: priced.tool,
      });
    }

    // Agent metadata override path for non-Arch sellers.
    const servicePricesAtomic = providerRaw?.servicePricesAtomic || registered?.metadata?.servicePricesAtomic;
    if (servicePricesAtomic && typeof servicePricesAtomic === 'object') {
      const amountAtomic = Number(servicePricesAtomic[serviceType] ?? servicePricesAtomic.default);
      if (Number.isFinite(amountAtomic) && amountAtomic > 0) {
        return this.buildQuote({
          agentId,
          serviceType,
          amountAtomic,
          source: 'agent-metadata',
        });
      }
    }

    return this.quoteService(agentId, serviceType);
  }
}

