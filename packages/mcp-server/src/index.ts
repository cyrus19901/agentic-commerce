/**
 * Gordon MCP Server — Provider-Driven, Chain-Agnostic
 *
 * Exposes the Agentic Commerce platform as an MCP server with x402-priced tool calls.
 * Compatible with mcpc (https://github.com/apify/mcpc) and any MCP client.
 *
 * Tool _meta.x402 now reflects the provider's own wallet and supported networks,
 * NOT the platform treasury wallet. Pricing comes from the provider registry DB.
 *
 * Mount at /mcp on the Express app for Streamable HTTP transport.
 */

import { Router, Request, Response } from 'express';
import { CHAIN_REGISTRY, explorerTxUrl, DEFAULT_NETWORK } from '@agentic-commerce/shared';

interface ProviderPricingCache {
  payTo: string;
  amountUsdc: number;
  supportedNetworks: string[];
}

let _providerPricingCache: Record<string, ProviderPricingCache> = {};
let _cacheTime = 0;
const CACHE_TTL = 60_000;

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  _meta?: {
    x402?: {
      maxAmountRequired: string;
      network: string;
      asset: string;
      payTo: string;
      supportedNetworks?: string[];
    };
  };
}

async function refreshProviderCache(apiBaseUrl: string, apiKey: string): Promise<void> {
  if (Date.now() - _cacheTime < CACHE_TTL && Object.keys(_providerPricingCache).length > 0) return;
  try {
    const resp = await fetch(`${apiBaseUrl}/providers`, {
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    });
    if (!resp.ok) return;
    const body = await resp.json() as any;
    const providers = body.providers || [];
    const cache: Record<string, ProviderPricingCache> = {};
    for (const p of providers) {
      if (!p.walletAddress) continue;
      cache[p.id] = {
        payTo: p.walletAddress,
        amountUsdc: p.pricing?.scrape ?? 0.01,
        supportedNetworks: p.supportedNetworks?.length ? p.supportedNetworks : [DEFAULT_NETWORK],
      };
    }
    _providerPricingCache = cache;
    _cacheTime = Date.now();
  } catch { /* non-fatal */ }
}

function getProviderMeta(providerId: string, actionCost?: number): McpToolDefinition['_meta'] | undefined {
  const cached = _providerPricingCache[providerId];
  if (!cached || !cached.payTo) return undefined;

  const cost = actionCost ?? cached.amountUsdc;
  const amountAtomic = Math.round(cost * 1_000_000).toString();
  const primaryNetwork = cached.supportedNetworks[0] || DEFAULT_NETWORK;
  const chain = CHAIN_REGISTRY[primaryNetwork];

  return {
    x402: {
      maxAmountRequired: amountAtomic,
      network: primaryNetwork,
      asset: chain?.usdcAddress || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      payTo: cached.payTo,
      supportedNetworks: cached.supportedNetworks,
    },
  };
}

function getTools(): McpToolDefinition[] {
  return [
    {
      name: 'execute_payment',
      description: 'Execute a payment through a provider (scrape, search, etc.) via Gordon infrastructure with policy check, treasury, and on-chain settlement.',
      inputSchema: {
        type: 'object',
        properties: {
          provider: { type: 'string', description: 'Provider ID (e.g. "zyte", "firecrawl")' },
          action: { type: 'string', description: 'Action to perform (e.g. "scrape", "search")' },
          url: { type: 'string', description: 'Target URL for scraping' },
          query: { type: 'string', description: 'Search query (for search action)' },
          max_payment_usdc: { type: 'number', description: 'Max USDC willing to pay', default: 0.10 },
        },
        required: ['provider', 'action'],
      },
      _meta: getProviderMeta('zyte', 0.10),
    },
    {
      name: 'web_scrape',
      description: 'Scrape a web page and return its content. Uses Zyte for extraction with Gordon policy enforcement and on-chain USDC settlement.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to scrape' },
          render_js: { type: 'boolean', description: 'Whether to render JavaScript (default: true)', default: true },
        },
        required: ['url'],
      },
      _meta: getProviderMeta('zyte', 0.05),
    },
    {
      name: 'check_policy',
      description: 'Dry-run policy check without executing a payment. Returns whether the request would be allowed.',
      inputSchema: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          action: { type: 'string' },
          price: { type: 'number', description: 'Estimated cost in USDC' },
        },
        required: ['provider', 'action'],
      },
    },
    {
      name: 'list_providers',
      description: 'List all available service providers and their capabilities.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_treasury',
      description: 'Get the organization treasury balance and status.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'query_audit',
      description: 'Query the audit trail for payment and policy events.',
      inputSchema: {
        type: 'object',
        properties: {
          event_type: { type: 'string', description: 'Filter by event type' },
          limit: { type: 'number', default: 20 },
        },
      },
    },
    {
      name: 'list_policies',
      description: 'List all active policies for the organization.',
      inputSchema: { type: 'object', properties: {} },
    },
  ];
}

interface ProxyResult {
  status: number;
  body: any;
  headers: Record<string, string>;
}

/**
 * Create the MCP server Express router.
 * This implements Streamable HTTP transport for the MCP protocol.
 */
export function createMcpRouter(deps: {
  apiBaseUrl: string;
  defaultApiKey: string;
}): Router {
  const router = Router();
  const { apiBaseUrl, defaultApiKey } = deps;

  async function proxyToApi(
    path: string,
    method: string,
    body?: unknown,
    apiKey?: string,
    extraHeaders?: Record<string, string>,
  ): Promise<ProxyResult> {
    const headers: Record<string, string> = {
      'X-API-Key': apiKey || defaultApiKey,
      'Content-Type': 'application/json',
      ...extraHeaders,
    };

    const resp = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseHeaders: Record<string, string> = {};
    for (const key of ['payment-required', 'payment-response']) {
      const val = resp.headers.get(key);
      if (val) responseHeaders[key] = val;
    }

    const respBody = await resp.json();
    return { status: resp.status, body: respBody, headers: responseHeaders };
  }

  router.post('/', async (req: Request, res: Response) => {
    const { method, id, params } = req.body || {};
    const apiKey = (req.headers['x-api-key'] as string) || defaultApiKey;

    if (method === 'initialize') {
      await refreshProviderCache(apiBaseUrl, apiKey);
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: 'gordon-agentic-commerce',
            version: '1.0.0',
          },
          instructions: 'Gordon Agentic Commerce — facilitation-as-a-service for agentic payments. ' +
            'Use execute_payment or web_scrape to pay for services through x402 protocol. ' +
            'Payments settle on-chain via USDC on the provider\'s preferred chain (Base, Polygon, Arbitrum).',
        },
      });
      return;
    }

    if (method === 'notifications/initialized') {
      res.json({ jsonrpc: '2.0', id, result: {} });
      return;
    }

    if (method === 'tools/list') {
      await refreshProviderCache(apiBaseUrl, apiKey);
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: getTools(),
        },
      });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};
      const meta = params?._meta || {};

      const paymentHeader = meta?.x402?.paymentHeader
        || (req.headers['payment-signature'] as string)
        || undefined;

      try {
        const result = await handleToolCall(toolName, args, apiKey, paymentHeader);

        const toolResult: any = {
          content: [{ type: 'text', text: JSON.stringify(result.body, null, 2) }],
        };

        if (result.body?.x402Settlement) {
          const settlement = result.body.x402Settlement;
          const txUrl = settlement.txHash
            ? explorerTxUrl(settlement.network || DEFAULT_NETWORK, settlement.txHash)
            : null;
          toolResult._meta = {
            x402: {
              settled: settlement.success || false,
              txHash: settlement.txHash || null,
              network: settlement.network || DEFAULT_NETWORK,
              payer: settlement.payer || null,
              explorerUrl: txUrl,
            },
          };
        }

        if (result.status === 402 && result.headers['payment-required']) {
          toolResult._meta = {
            ...toolResult._meta,
            x402PaymentRequired: result.headers['payment-required'],
          };
        }

        if (result.body?.priceBreakdown) {
          toolResult._meta = {
            ...toolResult._meta,
            priceBreakdown: result.body.priceBreakdown,
          };
        }

        res.json({
          jsonrpc: '2.0',
          id,
          result: toolResult,
        });
      } catch (err: any) {
        res.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: err.message },
        });
      }
      return;
    }

    if (method === 'ping') {
      res.json({ jsonrpc: '2.0', id, result: {} });
      return;
    }

    res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  });

  async function handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
    apiKey: string,
    paymentHeader?: string,
  ): Promise<ProxyResult> {
    const extraHeaders: Record<string, string> = {};
    if (paymentHeader) {
      extraHeaders['PAYMENT-SIGNATURE'] = paymentHeader;
    }

    switch (toolName) {
      case 'execute_payment': {
        return proxyToApi('/payments/execute', 'POST', {
          provider: args.provider,
          action: args.action,
          params: {
            url: args.url,
            query: args.query,
            ...(args.params as Record<string, unknown> || {}),
          },
          max_payment_usdc: args.max_payment_usdc || 0.10,
        }, apiKey, extraHeaders);
      }

      case 'web_scrape': {
        return proxyToApi('/payments/execute', 'POST', {
          provider: 'zyte',
          action: 'scrape',
          params: {
            url: args.url,
            render_js: args.render_js !== false,
          },
          max_payment_usdc: 0.05,
        }, apiKey, extraHeaders);
      }

      case 'check_policy': {
        return proxyToApi('/policies/check', 'POST', {
          price: args.price || 0.01,
          merchant: args.provider || 'unknown',
          transactionType: 'agent-to-agent',
          serviceType: args.action || 'scrape',
        }, apiKey);
      }

      case 'list_providers':
        return proxyToApi('/providers', 'GET', undefined, apiKey);

      case 'get_treasury':
        return proxyToApi('/treasury', 'GET', undefined, apiKey);

      case 'query_audit': {
        const queryParams = new URLSearchParams();
        if (args.event_type) queryParams.set('event_type', args.event_type as string);
        if (args.limit) queryParams.set('limit', String(args.limit));
        const qs = queryParams.toString() ? `?${queryParams.toString()}` : '';
        return proxyToApi(`/audit${qs}`, 'GET', undefined, apiKey);
      }

      case 'list_policies':
        return proxyToApi('/policies', 'GET', undefined, apiKey);

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  return router;
}
