import type { DB } from '@agentic-commerce/database';
import type { FirecrawlX402Agent, X402AgentResult } from './firecrawl-x402-agent.js';
import type { ZyteX402Agent, ZyteX402Result } from './zyte-x402-agent.js';
import {
  type ProviderPriceQuote,
  type PriceQuote,
  buildPriceQuote,
  fallbackProviderQuote,
  DEFAULT_GORDON_FEE_PERCENT,
  normalizeHexPrivateKey,
} from '@agentic-commerce/shared';

export interface Provider {
  id: string;
  name: string;
  type: 'x402' | 'api_key' | 'hybrid' | 'browser' | 'search';
  endpoint: string;
  actions: string[];
  pricing: Record<string, number>;
  enabled: boolean;
  walletAddress: string;
  supportedNetworks: string[];
  metadata?: Record<string, unknown>;
}

export interface ProviderPaymentConfig {
  payTo: string;
  amountUsdc: number;
  supportedNetworks: string[];
}

export interface ProviderDispatchResult {
  success: boolean;
  data?: unknown;
  baseTxHash?: string;
  paymentAmount?: string;
  agentWallet?: string;
  error?: string;
}

/**
 * Parsed result from probing a provider's x402 endpoint.
 */
interface ProbeResult {
  providerCostUsdc: number;
  providerCostAtomic: string;
  payTo: string;
  supportedNetworks: string[];
  raw402: unknown;
}

const PROBE_ENDPOINTS: Record<string, Record<string, string>> = {
  firecrawl: {
    // Firecrawl x402 currently exposes /search for both query and URL-based scrape flows.
    // Using /scrape here causes 404 and breaks live 402 price probing.
    scrape: process.env.FIRECRAWL_X402_SCRAPE_ENDPOINT || process.env.FIRECRAWL_X402_ENDPOINT || 'https://api.firecrawl.dev/v2/x402/search',
    search: process.env.FIRECRAWL_X402_ENDPOINT || 'https://api.firecrawl.dev/v2/x402/search',
  },
  zyte: {
    scrape: 'https://api-x402.zyte.com/v1/extract',
  },
  robtex: {
    dns: 'https://x402.robtex.com/api/v1/dns/forward/{query}',
    ip: 'https://x402.robtex.com/api/v1/ip/info/{query}',
  },
  'x402-direct': {
    search: 'https://x402.direct/api/search?q={query}',
  },
};

export class ProviderRegistry {
  private firecrawlAgent: FirecrawlX402Agent | null = null;
  private zyteAgent: ZyteX402Agent | null = null;

  constructor(private db: DB) {}

  setFirecrawlAgent(agent: FirecrawlX402Agent): void {
    this.firecrawlAgent = agent;
  }

  setZyteAgent(agent: ZyteX402Agent): void {
    this.zyteAgent = agent;
  }

  private getGordonFeeWallet(): string {
    const direct = String(
      process.env.GORDON_FEE_WALLET ||
      process.env.GORDON_FEE_RECIPIENT ||
      process.env.PLATFORM_WALLET ||
      '',
    ).trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(direct)) return direct;

    try {
      const viemAccounts: any = require('viem/accounts');
      const normalized = normalizeHexPrivateKey(process.env.DEMO_BUYER_PRIVATE_KEY || process.env.FIRECRAWL_AGENT_PRIVATE_KEY);
      if (!normalized) return '';
      return String(viemAccounts.privateKeyToAccount(normalized).address || '').trim();
    } catch {
      return '';
    }
  }

  async getProvider(id: string): Promise<Provider | null> {
    const { rows } = await this.db.pool.query(
      'SELECT * FROM providers WHERE id = $1',
      [id],
    );
    return rows[0] ? mapProvider(rows[0]) : null;
  }

  async listProviders(enabledOnly = true): Promise<Provider[]> {
    const sql = enabledOnly
      ? 'SELECT * FROM providers WHERE enabled = true ORDER BY name'
      : 'SELECT * FROM providers ORDER BY name';
    const { rows } = await this.db.pool.query(sql);
    return rows.map(mapProvider);
  }

  async dispatch(
    providerId: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<ProviderDispatchResult> {
    const provider = await this.getProvider(providerId);
    if (!provider) return { success: false, error: `Unknown provider: ${providerId}` };
    if (!provider.enabled) return { success: false, error: `Provider ${providerId} is disabled` };
    if (!provider.actions.includes(action)) {
      return { success: false, error: `Provider ${providerId} does not support action: ${action}` };
    }

    if (this.isX402NativeProvider(provider)) {
      return this.dispatchX402Native(provider, action, params);
    }

    switch (providerId) {
      case 'firecrawl':
        return this.dispatchFirecrawl(action, params);
      case 'zyte':
        return this.dispatchZyte(action, params);
      case 'browserbase':
        return this.dispatchBrowserbase(action, params);
      default:
        if (this.supportsDynamicHttpProvider(provider, action)) {
          return this.dispatchDynamicHttp(provider, action, params);
        }
        return { success: false, error: `No agent adapter for provider: ${providerId}` };
    }
  }

  private async dispatchFirecrawl(
    action: string,
    params: Record<string, unknown>,
  ): Promise<ProviderDispatchResult> {
    if (this.firecrawlAgent && !this.firecrawlAgent.isReady()) {
      await this.firecrawlAgent.waitUntilReady();
    }
    if (!this.firecrawlAgent?.isReady()) {
      return { success: false, error: 'Firecrawl agent is not ready' };
    }

    let result: X402AgentResult;
    if (action === 'scrape') {
      result = await this.firecrawlAgent.scrape(params.url as string);
    } else if (action === 'search') {
      result = await this.firecrawlAgent.search(
        params.query as string,
        { limit: (params.limit as number) || 5 },
      );
    } else {
      return { success: false, error: `Firecrawl does not support action: ${action}` };
    }

    return {
      success: result.success,
      data: result.data,
      baseTxHash: result.baseTxHash,
      paymentAmount: result.paymentAmount,
      agentWallet: result.agentWallet,
      error: result.error,
    };
  }

  private async dispatchZyte(
    action: string,
    params: Record<string, unknown>,
  ): Promise<ProviderDispatchResult> {
    if (this.zyteAgent && !this.zyteAgent.isReady()) {
      await this.zyteAgent.waitUntilReady();
    }
    if (!this.zyteAgent?.isReady()) {
      console.error('[ProviderRegistry] Zyte agent not ready. Agent set:', !!this.zyteAgent);
      return { success: false, error: 'Zyte agent is not ready' };
    }

    if (action !== 'scrape') {
      return { success: false, error: `Zyte does not support action: ${action}` };
    }

    const result: ZyteX402Result = await this.zyteAgent.scrape(params.url as string);
    return {
      success: result.success,
      data: result.data,
      baseTxHash: result.baseTxHash,
      paymentAmount: result.paymentAmount,
      agentWallet: result.agentWallet,
      error: result.error,
    };
  }

  private async dispatchBrowserbase(
    action: string,
    params: Record<string, unknown>,
  ): Promise<ProviderDispatchResult> {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    if (!apiKey || !projectId) {
      return {
        success: false,
        error: 'Browserbase credentials missing (set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID)',
      };
    }

    try {
      if (action === 'browse' || action === 'screenshot') {
        const sessionResp = await fetch('https://api.browserbase.com/v1/sessions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-bb-api-key': apiKey,
          },
          body: JSON.stringify({
            projectId,
            keepAlive: false,
            ...(params?.url ? { context: { startUrl: String(params.url) } } : {}),
          }),
          signal: AbortSignal.timeout(20_000),
        });

        const data: any = await sessionResp.json().catch(() => ({}));
        if (!sessionResp.ok) {
          return {
            success: false,
            error: `Browserbase API error (${sessionResp.status}): ${JSON.stringify(data).slice(0, 240)}`,
          };
        }

        return {
          success: true,
          data: {
            provider: 'browserbase',
            action,
            sessionId: data.id || data.sessionId,
            connectUrl: data.connectUrl || data.wsEndpoint || null,
            requestedUrl: params?.url || null,
            note: 'Browserbase session created successfully',
            raw: data,
          },
        };
      }

      return { success: false, error: `Browserbase does not support action: ${action}` };
    } catch (err: any) {
      return { success: false, error: `Browserbase dispatch failed: ${err.message}` };
    }
  }

  private supportsDynamicHttpProvider(provider: Provider, action: string): boolean {
    const endpoints = (provider.metadata?.endpoints as Record<string, unknown> | undefined) || {};
    const hasActionEndpoint = typeof endpoints[action] === 'string' && endpoints[action].length > 0;
    const hasGlobalEndpoint = Boolean(provider.endpoint);
    const dynamicFlag = (provider.metadata as any)?.dynamicHttp === true;
    return dynamicFlag || hasActionEndpoint || hasGlobalEndpoint;
  }

  private async dispatchDynamicHttp(
    provider: Provider,
    action: string,
    params: Record<string, unknown>,
  ): Promise<ProviderDispatchResult> {
    const template = this.getProbeTemplate(provider, action) || provider.endpoint;
    if (!template) return { success: false, error: `No endpoint configured for ${provider.id}/${action}` };

    const query = (params.query || params.url || params.domain || params.ip || params.prompt || '') as string;
    let url = this.resolveTemplateUrl(template, query);

    const metadata = (provider.metadata || {}) as Record<string, any>;
    const method = String(metadata.method || (url.includes('{query}') || url.includes('?') ? 'GET' : 'POST')).toUpperCase();
    const requestTemplate = metadata.requestTemplate;
    const queryValue = String(params.query || params.url || params.prompt || '');
    const interpolate = (value: any): any => {
      if (typeof value === 'string') {
        return value
          .replace(/\{query\}/g, queryValue)
          .replace(/\{url\}/g, String(params.url || ''))
          .replace(/\{prompt\}/g, String(params.prompt || params.query || params.url || ''));
      }
      if (Array.isArray(value)) return value.map(interpolate);
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = interpolate(v);
        return out;
      }
      return value;
    };

    const requestBody = requestTemplate
      ? interpolate(requestTemplate)
      : (Object.keys(params || {}).length > 0 ? params : (metadata.sampleRequestBody || {}));
    const headers: Record<string, string> = { ...(metadata.headers || {}) };

    const authEnv = metadata.authEnv as string | undefined;
    const authScheme = String(metadata.authScheme || 'Bearer');
    if (authEnv && process.env[authEnv]) {
      if (authScheme.toLowerCase() === 'basic') {
        headers.Authorization = `Basic ${Buffer.from(`${process.env[authEnv]}:`).toString('base64')}`;
      } else {
        headers.Authorization = `${authScheme} ${process.env[authEnv]}`;
      }
    }

    try {
      if (method === 'GET' && Object.keys(requestBody || {}).length > 0 && !url.includes('{query}')) {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(requestBody)) {
          if (v != null) qs.set(k, String(v));
        }
        const suffix = qs.toString();
        if (suffix) url += (url.includes('?') ? '&' : '?') + suffix;
      }

      const resp = await fetch(url, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json', ...headers } : headers,
        body: method === 'POST' ? JSON.stringify(requestBody) : undefined,
        signal: AbortSignal.timeout(30_000),
      });

      const contentType = resp.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await resp.json().catch(() => ({}))
        : await resp.text();

      if (!resp.ok) {
        return {
          success: false,
          error: `Dynamic provider call failed (${resp.status}): ${typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)}`,
        };
      }

      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: `Dynamic provider dispatch failed: ${err.message}` };
    }
  }

  /**
   * Dispatch to an x402-native provider. Handles the full 402 handshake manually:
   * 1. Make request → get 402 with payment requirements
   * 2. Sign EIP-3009 TransferWithAuthorization using Gordon's funded wallet
   * 3. Retry with X-PAYMENT header → receive service result
   */
  private async dispatchX402Native(
    provider: Provider,
    action: string,
    params: Record<string, unknown>,
  ): Promise<ProviderDispatchResult> {
    const template = this.getProbeTemplate(provider, action);
    if (!template) return { success: false, error: `No endpoint for ${provider.id}/${action}` };

    const query = (params.query || params.url || params.domain || params.ip || '') as string;
    const url = this.resolveTemplateUrl(template, query);
    const preferredMethod = String((provider.metadata as any)?.method || '').toUpperCase();

    const rawPk = process.env.FIRECRAWL_AGENT_PRIVATE_KEY || process.env.DEMO_BUYER_PRIVATE_KEY;
    const privateKey = normalizeHexPrivateKey(rawPk);
    if (!privateKey) {
      return { success: false, error: 'No valid funded wallet key (set DEMO_BUYER_PRIVATE_KEY: 64 hex chars)' };
    }

    try {
      const viem: any = require('viem');
      const viemAccounts: any = require('viem/accounts');
      const viemChains: any = require('viem/chains');

      const account = viemAccounts.privateKeyToAccount(privateKey);
      const agentAddress = account.address;
      const isGet = preferredMethod
        ? preferredMethod === 'GET'
        : (url.includes('?') || provider.id === 'robtex');
      const sampleBody = ((provider.metadata as any)?.sampleRequestBody || {}) as Record<string, unknown>;
      const hasInputFieldHint = Boolean(
        (provider.metadata as any)?.probeSnapshot?.rawAccepts?.[0]?.outputSchema?.input?.bodyFields?.input,
      );
      const requestBody =
        isGet
          ? undefined
          : (() => {
              const body = Object.keys(params || {}).length
                ? { ...(params as Record<string, unknown>) }
                : { ...sampleBody };
              const inferredInput =
                body.input ??
                params.query ??
                params.url ??
                params.domain ??
                params.ip ??
                query;
              if (hasInputFieldHint && inferredInput != null && String(inferredInput).trim() !== '') {
                body.input = String(inferredInput);
              }
              return body;
            })();

      console.log(`[ProviderRegistry] x402-native dispatch: ${provider.id}/${action} → ${url}`);

      // Step 1: Initial request → expect 402
      const baseHeaders: Record<string, string> = { 'User-Agent': 'curl/8.7.1' };
      const resp1 = await fetch(url, {
        method: isGet ? 'GET' : 'POST',
        headers: isGet ? baseHeaders : { ...baseHeaders, 'Content-Type': 'application/json' },
        body: isGet ? undefined : JSON.stringify(requestBody),
        signal: AbortSignal.timeout(15_000),
      });

      if (resp1.status !== 402) {
        if (resp1.ok) {
          const data = await resp1.json();
          return { success: true, data, agentWallet: agentAddress };
        }
        const errText = await resp1.text();
        return { success: false, error: `Expected 402 but got ${resp1.status}: ${errText.slice(0, 200)}` };
      }

      // Step 2: Parse 402 — prefer PAYMENT-REQUIRED header, then JSON body (single body read)
      const text402 = await resp1.text();
      let body402: any = {};
      const prHdr = resp1.headers.get('payment-required') || resp1.headers.get('PAYMENT-REQUIRED');
      if (prHdr?.trim()) {
        try {
          body402 = JSON.parse(Buffer.from(prHdr.trim(), 'base64').toString('utf8'));
        } catch {
          try {
            body402 = JSON.parse(prHdr);
          } catch { /* ignore */ }
        }
      }
      if (!body402.accepts?.length) {
        try {
          body402 = JSON.parse(text402);
        } catch {
          return { success: false, error: '402: could not parse PAYMENT-REQUIRED header or JSON body' };
        }
      }

      const accepts =
        body402.accepts?.length ? body402.accepts : body402.accepted ? [body402.accepted] : [];
      if (!accepts.length) return { success: false, error: 'No payment options in 402 response' };

      const accept = accepts[0];
      const rawAmount = accept.maxAmountRequired ?? accept.amount;
      const payTo = String(accept.payTo ?? '').trim();
      const network = accept.network as string | undefined;
      if (!rawAmount || !payTo) {
        return { success: false, error: '402 accept missing amount/maxAmountRequired or payTo' };
      }
      const maxAmountRequired = String(rawAmount);
      const outputSchemaInput = (accept as any)?.outputSchema?.input || {};
      const schemaBody = outputSchemaInput?.body || {};
      const schemaProperties = schemaBody?.properties || {};
      const schemaKeys = Object.keys(schemaProperties);
      const requiredSchemaKeys: string[] = Array.isArray(schemaBody?.required) ? schemaBody.required : [];

      // Build a schema-aware request body for paid retry.
      // Some providers reject unknown keys and require strict payload shape (e.g. only `url`).
      let paidRequestBody: Record<string, unknown> | undefined = requestBody as Record<string, unknown> | undefined;
      if (!isGet) {
        if (schemaKeys.length > 0) {
          paidRequestBody = {};
          const source = (requestBody || {}) as Record<string, unknown>;
          for (const key of schemaKeys) {
            if (source[key] != null) {
              paidRequestBody[key] = source[key];
              continue;
            }
            if (key === 'url') {
              paidRequestBody[key] = source.url || source.query || source.input || source.domain || query || 'https://example.com';
            } else if (key === 'query') {
              paidRequestBody[key] = source.query || source.url || source.input || query || 'example';
            } else if (key.toLowerCase().includes('markdown') || key.toLowerCase().includes('html')) {
              paidRequestBody[key] = false;
            }
          }
          for (const requiredKey of requiredSchemaKeys) {
            if (paidRequestBody[requiredKey] != null) continue;
            if (requiredKey === 'url') paidRequestBody[requiredKey] = query || 'https://example.com';
            else if (requiredKey === 'query') paidRequestBody[requiredKey] = query || 'example';
            else paidRequestBody[requiredKey] = 'test';
          }
        } else {
          paidRequestBody = requestBody as Record<string, unknown>;
        }
      }

      // Resolve chain config
      const { toCaip2 } = require('@agentic-commerce/shared');
      const { CHAIN_REGISTRY } = require('@agentic-commerce/shared');
      const caip2 = toCaip2(network || 'base');
      const chainConfig = CHAIN_REGISTRY[caip2];
      if (!chainConfig) {
        return { success: false, error: `Unsupported network for x402-native: ${network || caip2}` };
      }
      const chainMap: Record<number, any> = { 8453: viemChains.base, 84532: viemChains.baseSepolia, 137: viemChains.polygon, 42161: viemChains.arbitrum };
      const viemChain = chainMap[chainConfig.chainId] || viemChains.base;

      const walletClient = viem.createWalletClient({
        account,
        chain: viemChain,
        transport: viem.http(process.env.BASE_RPC_URL || chainConfig.rpcUrl || 'https://mainnet.base.org'),
      });

      // Step 3: Build X-PAYMENT with Coinbase x402 client (same encoding as x402-fetch)
      const x402Client: { createPaymentHeader: (w: any, ver: number, req: any) => Promise<string> } = require('x402/client');
      const x402Types: { PaymentRequirementsSchema: { parse: (x: unknown) => any } } = require('x402/types');
      const x402Version = Number(body402.x402Version ?? 1);
      const networkToX402: Record<string, string> = {
        'eip155:8453': 'base',
        'eip155:84532': 'base-sepolia',
        'eip155:137': 'polygon',
        'eip155:42161': 'arbitrum',
      };
      const normalizedAccept = {
        ...accept,
        scheme: 'exact',
        network: networkToX402[caip2] || accept.network || 'base',
        payTo,
        maxAmountRequired,
        // Some providers omit these but x402 schema expects them.
        resource: accept.resource || url,
        description: accept.description || `${provider.id}/${action}`,
        mimeType: accept.mimeType || 'application/json',
      };
      let paymentRequirements: any;
      try {
        paymentRequirements = x402Types.PaymentRequirementsSchema.parse(normalizedAccept);
      } catch (parseErr: any) {
        return { success: false, error: `Invalid x402 accept: ${parseErr.message}` };
      }

      const paymentHeader = await x402Client.createPaymentHeader(walletClient, x402Version, paymentRequirements);
      const atomic = parseInt(maxAmountRequired, 10);
      const usdcStr = Number.isFinite(atomic) ? (atomic / 1e6).toFixed(6) : maxAmountRequired;
      console.log(`[ProviderRegistry] x402-native signed payment (${x402Version}): ${usdcStr} USDC to ${payTo.slice(0, 10)}...`);
      console.log(`[ProviderRegistry] x402-native retry URL: ${url}`);

      const paymentPreview = {
        url,
        x402Version,
        scheme: normalizedAccept.scheme,
        network: normalizedAccept.network,
        maxAmountRequired,
        payTo,
        resource: normalizedAccept.resource,
        description: normalizedAccept.description,
        agentWallet: agentAddress,
      };

      // Step 4: Retry with payment (several servers accept X-PAYMENT and/or PAYMENT-SIGNATURE)
      const retryHeaders: Record<string, string> = {
        'User-Agent': 'curl/8.7.1',
        'X-PAYMENT': paymentHeader,
        'PAYMENT-SIGNATURE': paymentHeader,
      };
      if (!isGet) retryHeaders['Content-Type'] = 'application/json';

      const hintedTimeoutMs = Number(accept.maxTimeoutSeconds || 0) * 1000;
      const configuredTimeoutMs = Number(process.env.X402_NATIVE_EXEC_TIMEOUT_MS || '90000');
      const paidExecutionTimeoutMs = Math.max(configuredTimeoutMs, hintedTimeoutMs > 0 ? hintedTimeoutMs + 5000 : 0);

      const resp2 = await fetch(url, {
        method: isGet ? 'GET' : 'POST',
        headers: retryHeaders,
        body: isGet ? undefined : JSON.stringify(paidRequestBody || {}),
        signal: AbortSignal.timeout(paidExecutionTimeoutMs),
      });

      const paymentResponse = resp2.headers.get('x-payment-response') || resp2.headers.get('payment-response') || undefined;

      if (!resp2.ok) {
        const errText = await resp2.text();
        console.error(`[ProviderRegistry] x402-native retry failed (${resp2.status}):`, errText.slice(0, 300));
        const verifyHint =
          resp2.status === 500 && /verify payment/i.test(errText)
            ? 'Tip: fund the agent wallet on Base with a little USDC; the resource quotes atomic maxAmountRequired.'
            : '';
        return {
          success: false,
          error: `x402-native failed (${resp2.status}): ${errText.slice(0, 500)}${verifyHint ? ` ${verifyHint}` : ''}`,
          agentWallet: agentAddress,
          data: {
            x402PaymentPreview: paymentPreview,
            upstreamStatus: resp2.status,
            upstreamBody: errText.slice(0, 8000),
            paymentResponseHeader: paymentResponse || null,
          },
        };
      }

      const bodyText = await resp2.text();
      let data: unknown;
      try {
        data = JSON.parse(bodyText);
      } catch {
        data = { message: bodyText };
      }
      console.log(`[ProviderRegistry] x402-native ${provider.id}/${action} SUCCESS. Payment receipt: ${paymentResponse ? 'yes' : 'none'}`);

      return {
        success: true,
        data,
        baseTxHash: paymentResponse,
        paymentAmount: (parseInt(maxAmountRequired, 10) / 1e6).toFixed(6),
        agentWallet: agentAddress,
      };
    } catch (err: any) {
      console.error(`[ProviderRegistry] x402-native ${provider.id}/${action} error:`, err.message);
      return { success: false, data: null, error: err.message };
    }
  }

  private isX402NativeProvider(provider: Provider): boolean {
    if (provider.type === 'x402') return true;
    const metadata = provider.metadata || {};
    return metadata.x402Native === true;
  }

  private getProbeTemplate(provider: Provider, action: string): string | null {
    const metadataEndpoints = provider.metadata?.endpoints as Record<string, unknown> | undefined;
    const fromMetadata = metadataEndpoints?.[action];
    if (typeof fromMetadata === 'string' && fromMetadata.length > 0) return fromMetadata;

    const fromStaticMap = PROBE_ENDPOINTS[provider.id]?.[action];
    if (fromStaticMap) return fromStaticMap;

    if (provider.endpoint) return provider.endpoint;
    return null;
  }

  private resolveTemplateUrl(template: string, query: string): string {
    if (template.includes('{query}')) {
      return template.replace('{query}', encodeURIComponent(query));
    }
    return template;
  }

  /**
   * Get the estimated cost for a provider action.
   * Reads from the provider's DB pricing field first, then falls back to env.
   */
  async getEstimatedCost(providerId: string, action: string): Promise<number | null> {
    const provider = await this.getProvider(providerId);
    if (provider?.pricing?.[action] != null) {
      return provider.pricing[action];
    }
    if (providerId === 'zyte' && action === 'scrape') {
      return Number(process.env.ZYTE_SCRAPE_COST_USDC || '0.01');
    }
    if (providerId === 'firecrawl') {
      return Number(process.env.FIRECRAWL_X402_MAX_PAYMENT || '0.10');
    }
    return null;
  }

  /**
   * Synchronous estimated cost — uses env-based fallback only (no DB).
   * For use in middleware where async is inconvenient.
   */
  getEstimatedCostSync(providerId: string, action: string): number | null {
    if (providerId === 'zyte' && action === 'scrape') {
      return Number(process.env.ZYTE_SCRAPE_COST_USDC || '0.01');
    }
    if (providerId === 'firecrawl') {
      return Number(process.env.FIRECRAWL_X402_MAX_PAYMENT || '0.10');
    }
    return null;
  }

  /**
   * Get the full payment configuration for a provider action.
   * Returns the provider's wallet address, cost, and supported networks.
   */
  async getProviderPaymentConfig(providerId: string, action: string): Promise<ProviderPaymentConfig | null> {
    const provider = await this.getProvider(providerId);
    if (!provider || !provider.enabled) return null;

    const amountUsdc = provider.pricing?.[action]
      ?? (await this.getEstimatedCost(providerId, action))
      ?? 0.01;

    return {
      payTo: provider.walletAddress,
      amountUsdc,
      supportedNetworks: provider.supportedNetworks,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Pass-Through 402 — Live Provider Probing
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Probe a provider's x402 endpoint to get the REAL price.
   *
   * Makes a request to the provider WITHOUT payment, expecting a 402 back
   * with the actual price for this specific request. Falls back to DB pricing
   * if the probe fails or the provider doesn't support x402.
   */
  private async probeProvider(
    providerId: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<ProbeResult | null> {
    const provider = await this.getProvider(providerId);
    if (!provider) return null;

    const template = this.getProbeTemplate(provider, action);
    if (!template) return null;

    try {
      const isNative = this.isX402NativeProvider(provider);
      const query = (params.query || params.url || params.domain || params.ip || 'example.com') as string;
      const url = this.resolveTemplateUrl(template, query);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);

      let resp: Response;

      if (isNative) {
        const isGet = url.includes('?') || providerId === 'robtex';
        resp = await fetch(url, {
          method: isGet ? 'GET' : 'POST',
          headers: isGet ? {} : { 'Content-Type': 'application/json' },
          body: isGet ? undefined : JSON.stringify(params),
          signal: controller.signal,
        });
      } else {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (providerId === 'firecrawl' && process.env.FIRECRAWL_API_KEY) {
          headers['Authorization'] = `Bearer ${process.env.FIRECRAWL_API_KEY}`;
        }
        if (providerId === 'zyte' && process.env.ZYTE_API_KEY) {
          headers['Authorization'] = 'Basic ' + Buffer.from(process.env.ZYTE_API_KEY + ':').toString('base64');
        }

        const body = providerId === 'firecrawl'
          ? { query: params.url || params.query || '', limit: 1 }
          : { url: params.url || '', browserHtml: true };

        resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      }

      clearTimeout(timer);

      if (resp.status === 402) {
        return this.parse402Response(resp);
      }

      console.log(`[ProviderRegistry] Probe ${providerId}/${action}: got ${resp.status} (expected 402)`);
      return null;
    } catch (err: any) {
      console.warn(`[ProviderRegistry] Probe ${providerId}/${action} failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Parse a raw 402 response from a provider into structured data.
   */
  private async parse402Response(resp: Response): Promise<ProbeResult | null> {
    try {
      const paymentRequiredHeader =
        resp.headers.get('payment-required') || resp.headers.get('PAYMENT-REQUIRED') || resp.headers.get('x-payment');
      let parsed: any = null;

      if (paymentRequiredHeader) {
        try {
          parsed = JSON.parse(Buffer.from(paymentRequiredHeader.trim(), 'base64').toString('utf8'));
        } catch {
          try {
            parsed = JSON.parse(paymentRequiredHeader);
          } catch { /* ignore */ }
        }
      }

      if (!parsed) {
        const bodyText = await resp.text();
        try { parsed = JSON.parse(bodyText); } catch { return null; }
      }

      const accepts =
        parsed.accepts?.length ? parsed.accepts
          : parsed.paymentRequirements?.length ? parsed.paymentRequirements
            : parsed.accepted ? [parsed.accepted]
              : [];
      if (!Array.isArray(accepts) || accepts.length === 0) return null;

      const first = accepts[0];
      const amountAtomic = String(first.maxAmountRequired || first.amount || '0');
      const costUsdc = parseInt(amountAtomic, 10) / 1_000_000;

      const normalizeNetwork = (n: string): string => {
        if (!n) return '';
        if (n.startsWith('eip155:')) return n;
        const aliases: Record<string, string> = {
          base: 'eip155:8453', 'base-mainnet': 'eip155:8453', 'base-sepolia': 'eip155:84532',
          ethereum: 'eip155:1', polygon: 'eip155:137', arbitrum: 'eip155:42161',
        };
        return aliases[n.toLowerCase()] || n;
      };

      return {
        providerCostUsdc: costUsdc,
        providerCostAtomic: amountAtomic,
        payTo: (first.payTo || '').trim(),
        supportedNetworks: accepts.map((a: any) => normalizeNetwork(a.network)).filter(Boolean),
        raw402: parsed,
      };
    } catch (err: any) {
      console.warn('[ProviderRegistry] Failed to parse 402 response:', err.message);
      return null;
    }
  }

  /**
   * Get a real-time price quote from the provider.
   *
   * Flow:
   *   1. Probe the provider's x402 endpoint with the actual request params
   *   2. If the provider returns a 402 → use the real price
   *   3. If the probe fails → fall back to DB pricing
   *   4. Wrap with Gordon's fee → return full PriceQuote
   */
  async getProviderPriceQuote(
    providerId: string,
    action: string,
    params: Record<string, unknown>,
    feePercent?: number,
  ): Promise<PriceQuote> {
    const provider = await this.getProvider(providerId);
    // Demo/showcase mode: disable Gordon upcharge unless explicitly enabled.
    const disableUpcharge = String(process.env.GORDON_DISABLE_UPCHARGE || 'true').toLowerCase() === 'true';
    const fee = disableUpcharge
      ? 0
      : (feePercent ?? Number(process.env.GORDON_FEE_PERCENT || DEFAULT_GORDON_FEE_PERCENT));

    // Try live probe first
    const probeResult = await this.probeProvider(providerId, action, params);

    if (probeResult && probeResult.providerCostUsdc > 0) {
      console.log(`[ProviderRegistry] Live probe ${providerId}/${action}: $${probeResult.providerCostUsdc} USDC from provider`);

      const providerQuote: ProviderPriceQuote = {
        providerId,
        action,
        providerCostUsdc: probeResult.providerCostUsdc,
        providerCostAtomic: probeResult.providerCostAtomic,
        payTo: this.getGordonFeeWallet() || probeResult.payTo || provider?.walletAddress || '',
        supportedNetworks: probeResult.supportedNetworks.length > 0
          ? probeResult.supportedNetworks
          : (provider?.supportedNetworks || []),
        raw402: probeResult.raw402,
        source: 'probe',
        quotedAt: Date.now(),
        ttlMs: 60_000,
      };

      return buildPriceQuote(providerQuote, fee);
    }

    // Fallback to DB/env pricing
    const costUsdc = provider?.pricing?.[action]
      ?? (await this.getEstimatedCost(providerId, action))
      ?? 0.01;

    console.log(`[ProviderRegistry] Fallback pricing ${providerId}/${action}: $${costUsdc} USDC (DB/env)`);

    const fallback = fallbackProviderQuote(
      providerId,
      action,
      costUsdc,
      this.getGordonFeeWallet() || provider?.walletAddress || process.env.PLATFORM_WALLET || '',
      provider?.supportedNetworks || [],
      provider?.pricing?.[action] != null ? 'db_fallback' : 'env_fallback',
    );

    return buildPriceQuote(fallback, fee);
  }
}

function mapProvider(row: any): Provider {
  let supportedNetworks: string[] = [];
  if (row.supported_networks) {
    try {
      supportedNetworks = typeof row.supported_networks === 'string'
        ? JSON.parse(row.supported_networks)
        : row.supported_networks;
    } catch { /* ignore */ }
  }

  const metadata = row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : undefined;

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    endpoint: row.endpoint,
    actions: typeof row.actions === 'string' ? JSON.parse(row.actions) : (row.actions || []),
    pricing: typeof row.pricing === 'string' ? JSON.parse(row.pricing) : (row.pricing || {}),
    enabled: row.enabled,
    walletAddress: row.wallet_address || '',
    supportedNetworks,
    metadata,
  };
}
