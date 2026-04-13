type ArchToolsConfig = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
};

export type GenericProviderConfig = {
  name: string;
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  authHeader?: string; // default: x-api-key
  executePathTemplate?: string; // default: /v1/tools/{tool}
  pricingPathTemplate?: string; // default: /api/v1/x402/pricing/{tool}
  toolMap?: Record<string, string>;
  pricingStrategy?: 'x402' | 'metadata' | 'none';
};

export function normalizeProviderConfig(raw: any): GenericProviderConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const baseUrl = String(raw.baseUrl || '').trim();
  if (!baseUrl) return null;
  return {
    name: String(raw.name || raw.kind || 'provider').toLowerCase(),
    baseUrl,
    apiKey: raw.apiKey || undefined,
    timeoutMs: raw.timeoutMs ? Number(raw.timeoutMs) : undefined,
    authHeader: raw.authHeader || undefined,
    executePathTemplate: raw.executePathTemplate || undefined,
    pricingPathTemplate: raw.pricingPathTemplate || undefined,
    toolMap: raw.toolMap && typeof raw.toolMap === 'object' ? raw.toolMap : undefined,
    pricingStrategy: raw.pricingStrategy || (raw.kind === 'archtools' ? 'x402' : 'none'),
  };
}

export function toArchToolName(serviceType: string): string {
  const map: Record<string, string> = {
    scrape: 'web-scrape',
    'data-scraping': 'web-scrape',
    'api-call': 'web-search',
    'api-calling': 'web-search',
    'data-analysis': 'ai-oracle',
    'advanced-analysis': 'research-report',
  };
  return map[serviceType] ?? serviceType;
}

function resolveProviderTool(serviceType: string, provider: GenericProviderConfig): string {
  if (provider.toolMap?.[serviceType]) return provider.toolMap[serviceType];
  if (provider.name === 'archtools') return toArchToolName(serviceType);
  return serviceType;
}

function pathFromTemplate(template: string, tool: string): string {
  return template.replace('{tool}', encodeURIComponent(tool));
}

export async function fetchProviderX402Price(
  serviceType: string,
  provider: GenericProviderConfig
): Promise<{ amountAtomic: number; amountUsd: number; tool: string; raw?: any }> {
  const baseUrl = provider.baseUrl.replace(/\/$/, '');
  const tool = resolveProviderTool(serviceType, provider);
  const pathTemplate = provider.pricingPathTemplate || '/api/v1/x402/pricing/{tool}';
  const url = `${baseUrl}${pathFromTemplate(pathTemplate, tool)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.timeoutMs ?? 10_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(`Failed pricing lookup (${response.status})`);

    // Accept either x402 format or custom keys for dynamic providers.
    const amountAtomic = Number(parsed?.price_atomic ?? parsed?.amount_atomic);
    const amountUsd = Number(parsed?.price_usdc ?? parsed?.amount_usd);
    if (!Number.isFinite(amountAtomic) || !Number.isFinite(amountUsd)) {
      throw new Error('Invalid provider pricing response');
    }
    return { amountAtomic, amountUsd, tool, raw: parsed };
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeProviderTool(
  serviceType: string,
  input: any,
  provider: GenericProviderConfig
): Promise<any> {
  const baseUrl = provider.baseUrl.replace(/\/$/, '');
  const tool = resolveProviderTool(serviceType, provider);
  const pathTemplate = provider.executePathTemplate || '/v1/tools/{tool}';
  const url = `${baseUrl}${pathFromTemplate(pathTemplate, tool)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.timeoutMs ?? 15_000);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (provider.apiKey) {
    headers[provider.authHeader || 'x-api-key'] = provider.apiKey;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(input || {}),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: any;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!response.ok) {
      return {
        ok: false,
        provider: provider.name,
        status: response.status,
        error: parsed?.error || parsed || `Provider call failed (${response.status})`,
        tool,
      };
    }
    return {
      ok: true,
      provider: provider.name,
      tool,
      data: parsed,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function b64urlDecodeJson<T = any>(value: string): T {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

export async function fetchProviderX402Requirement(
  serviceType: string,
  input: any,
  provider: GenericProviderConfig
): Promise<{
  requirement: any;
  paymentRequiredHeader?: any;
  source: 'header' | 'body';
  tool: string;
}> {
  const baseUrl = provider.baseUrl.replace(/\/$/, '');
  const tool = resolveProviderTool(serviceType, provider);
  const pathTemplate = provider.executePathTemplate || '/v1/tools/{tool}';
  const url = `${baseUrl}${pathFromTemplate(pathTemplate, tool)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.timeoutMs ?? 15_000);

  try {
    // Intentionally do NOT include provider API key for native x402 challenge discovery.
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input || {}),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsedBody: any = {};
    try {
      parsedBody = text ? JSON.parse(text) : {};
    } catch {
      parsedBody = { raw: text };
    }

    const paymentRequiredHeader =
      response.headers.get('payment-required') ||
      response.headers.get('PAYMENT-REQUIRED') ||
      response.headers.get('x-payment-required');

    if (response.status !== 402 && !paymentRequiredHeader) {
      throw new Error(`Provider did not return x402 challenge (status ${response.status})`);
    }

    if (paymentRequiredHeader) {
      try {
        return {
          requirement: b64urlDecodeJson(paymentRequiredHeader),
          paymentRequiredHeader: paymentRequiredHeader,
          source: 'header',
          tool,
        };
      } catch {
        // fall back to body if header is not b64url JSON
      }
    }

    return {
      requirement: parsedBody,
      source: 'body',
      tool,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchArchToolX402Price(
  serviceType: string,
  config: Omit<ArchToolsConfig, 'apiKey'> & { baseUrl?: string }
): Promise<{ amountAtomic: number; amountUsd: number; tool: string; raw?: any }> {
  const provider = normalizeProviderConfig({
    kind: 'archtools',
    name: 'archtools',
    baseUrl: config.baseUrl || 'https://archtools.dev',
    timeoutMs: config.timeoutMs,
    pricingStrategy: 'x402',
  });
  if (!provider) throw new Error('Invalid Arch Tools provider config');
  return fetchProviderX402Price(serviceType, provider);
}

export async function executeArchTool(
  serviceType: string,
  input: any,
  config: ArchToolsConfig
): Promise<any> {
  const provider = normalizeProviderConfig({
    kind: 'archtools',
    name: 'archtools',
    baseUrl: config.baseUrl || 'https://archtools.dev',
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    authHeader: 'x-api-key',
  });
  if (!provider) throw new Error('Invalid Arch Tools provider config');
  return executeProviderTool(serviceType, input, provider);
}

