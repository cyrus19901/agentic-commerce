export interface AgenticCommerceConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
  /** Optional: sign x402 payments automatically when a 402 is returned */
  x402Signer?: X402Signer;
}

/**
 * Callback the SDK invokes when a 402 Payment Required is received.
 * The implementer signs an EIP-3009 TransferWithAuthorization and
 * returns the base64 PAYMENT-SIGNATURE header value.
 */
export type X402Signer = (paymentRequired: PaymentRequiredResponse) => Promise<string>;

export interface PaymentRequiredResponse {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
    resource: { url: string; method: string; description?: string };
    extra?: { name: string; version: string };
  }>;
  error?: string;
}

export interface PaymentQuote {
  paymentId: string;
  correlationId: string;
  provider: string;
  action: string;
  estimatedCostUsdc: number;
  policyResult: unknown;
  allowed: boolean;
  error?: string;
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaymentExecuteParams {
  provider: string;
  action: string;
  params?: Record<string, unknown>;
  max_payment_usdc?: number;
  callback_url?: string;
  sandbox?: boolean;
}

export interface PaymentResult {
  paymentId: string;
  status: 'completed' | 'failed' | 'rejected' | 'verification_failed';
  correlationId: string;
  provider: string;
  action: string;
  data?: unknown;
  baseTxHash?: string;
  paymentAmountUsdc?: number;
  agentWallet?: string;
  policyResult?: unknown;
  txVerification?: unknown;
  error?: string;
  sandbox?: boolean;
}

export interface Policy {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  priority: number;
  conditions: Record<string, unknown>;
  rules: Record<string, unknown>;
}

export interface Treasury {
  id: string;
  orgId: string;
  currency: string;
  balanceAvailable: number;
  balanceReserved: number;
}

export interface ApiKeyInfo {
  id: string;
  key?: string;
  prefix: string;
  name: string;
  scopes: string[];
  expires_at: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
}

class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AgenticCommerce {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;
  private x402Signer?: X402Signer;

  constructor(config: AgenticCommerceConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 30_000;
    this.x402Signer = config.x402Signer;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        ...extraHeaders,
      };

      const resp = await fetch(url.toString(), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Handle x402 Payment Required — auto-sign and retry
      if (resp.status === 402 && this.x402Signer) {
        const paymentRequired = (await resp.json()) as PaymentRequiredResponse;
        const paymentSignature = await this.x402Signer(paymentRequired);

        // Retry with PAYMENT-SIGNATURE header
        const retryController = new AbortController();
        const retryTimer = setTimeout(() => retryController.abort(), this.timeout);

        try {
          const retryResp = await fetch(url.toString(), {
            method,
            headers: { ...headers, 'PAYMENT-SIGNATURE': paymentSignature },
            body: body ? JSON.stringify(body) : undefined,
            signal: retryController.signal,
          });

          clearTimeout(retryTimer);
          const retryData: any = await retryResp.json();

          if (!retryResp.ok) {
            const err = retryData.error || {};
            throw new ApiError(retryResp.status, err.code || 'UNKNOWN', err.message || retryResp.statusText, err.details, err.request_id);
          }

          // Attach x402 payment response header info
          const paymentResponse = retryResp.headers.get('PAYMENT-RESPONSE');
          if (paymentResponse) {
            retryData._x402PaymentResponse = JSON.parse(
              Buffer.from(paymentResponse, 'base64').toString('utf8'),
            );
          }

          return retryData as T;
        } catch (retryErr) {
          clearTimeout(retryTimer);
          throw retryErr;
        }
      }

      // If 402 but no signer, throw with the payment requirements
      if (resp.status === 402) {
        const paymentRequired = await resp.json() as PaymentRequiredResponse;
        const err = new ApiError(402, 'PAYMENT_REQUIRED', 'Payment required', paymentRequired);
        (err as any).paymentRequired = paymentRequired;
        (err as any).paymentRequiredHeader = resp.headers.get('PAYMENT-REQUIRED');
        throw err;
      }

      const data: any = await resp.json();

      if (!resp.ok) {
        const err = data.error || {};
        throw new ApiError(resp.status, err.code || 'UNKNOWN', err.message || resp.statusText, err.details, err.request_id);
      }
      return data as T;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  // ── Payments ────────────────────────────────────────────────────────────

  payments = {
    execute: (params: PaymentExecuteParams): Promise<PaymentResult> =>
      this.request('POST', '/payments/execute', params),

    quote: (params: Pick<PaymentExecuteParams, 'provider' | 'action' | 'params'>): Promise<PaymentQuote> =>
      this.request('POST', '/payments/quote', params),

    list: (params?: PaginationParams & { status?: string }): Promise<{ payments: PaymentResult[]; total: number }> =>
      this.request('GET', '/payments', undefined, params as any),

    get: (id: string): Promise<PaymentResult> =>
      this.request('GET', `/payments/${id}`),

    trace: (id: string): Promise<{ paymentId: string; correlationId: string; trace: unknown[] }> =>
      this.request('GET', `/payments/${id}/trace`),

    verify: (id: string): Promise<{ paymentId: string; verified: boolean; blockNumber?: number }> =>
      this.request('GET', `/payments/${id}/verify`),
  };

  // ── Policies ────────────────────────────────────────────────────────────

  policies = {
    list: (): Promise<{ policies: Policy[]; source: string }> =>
      this.request('GET', '/policies'),

    create: (policy: Omit<Policy, 'id'>): Promise<Policy> =>
      this.request('POST', '/policies', policy),

    update: (id: string, updates: Partial<Policy>): Promise<Policy> =>
      this.request('PUT', `/policies/${id}`, updates),

    delete: (id: string): Promise<{ deleted: boolean }> =>
      this.request('DELETE', `/policies/${id}`),

    check: (params: { price?: number; merchant?: string; category?: string; transactionType?: string }): Promise<unknown> =>
      this.request('POST', '/policies/check', params),

    templates: (): Promise<{ templates: unknown[] }> =>
      this.request('GET', '/policy-templates'),
  };

  // ── Audit ───────────────────────────────────────────────────────────────

  audit = {
    query: (params?: PaginationParams & { event_type?: string; correlation_id?: string }): Promise<{ entries: unknown[]; total: number }> =>
      this.request('GET', '/audit', undefined, params as any),

    stats: (): Promise<unknown> =>
      this.request('GET', '/audit/stats'),

    get: (id: string): Promise<unknown> =>
      this.request('GET', `/audit/${id}`),
  };

  // ── Treasury ────────────────────────────────────────────────────────────

  treasury = {
    balance: (): Promise<Treasury> =>
      this.request('GET', '/treasury'),

    ledger: (params?: PaginationParams & { entry_type?: string }): Promise<{ entries: unknown[]; total: number }> =>
      this.request('GET', '/treasury/ledger', undefined, params as any),

    deposit: (amount: number, reference: string, txHash?: string): Promise<unknown> =>
      this.request('POST', '/treasury/deposit', { amount, reference, tx_hash: txHash }),

    reconcile: (): Promise<unknown> =>
      this.request('GET', '/treasury/reconcile'),
  };

  // ── Providers ───────────────────────────────────────────────────────────

  providers = {
    list: (): Promise<{ providers: unknown[] }> =>
      this.request('GET', '/providers'),

    get: (id: string): Promise<unknown> =>
      this.request('GET', `/providers/${id}`),
  };

  // ── Organization ────────────────────────────────────────────────────────

  org = {
    get: (): Promise<Organization> =>
      this.request('GET', '/orgs/me'),

    update: (name: string): Promise<Organization> =>
      this.request('PUT', '/orgs/me', { name }),

    create: (name: string, slug: string): Promise<{ organization: Organization; api_key: ApiKeyInfo; webhook_secret: string }> =>
      this.request('POST', '/orgs', { name, slug }),
  };

  // ── API Keys ────────────────────────────────────────────────────────────

  apiKeys = {
    list: (): Promise<{ keys: ApiKeyInfo[] }> =>
      this.request('GET', '/orgs/me/api-keys'),

    create: (name: string, scopes?: string[], expiresAt?: string): Promise<ApiKeyInfo> =>
      this.request('POST', '/orgs/me/api-keys', { name, scopes: scopes || ['*'], expires_at: expiresAt }),

    revoke: (id: string): Promise<{ revoked: boolean }> =>
      this.request('DELETE', `/orgs/me/api-keys/${id}`),

    rotate: (id: string): Promise<{ rotated: boolean; new_key: ApiKeyInfo }> =>
      this.request('POST', `/orgs/me/api-keys/${id}/rotate`),
  };

  // ── Webhooks ────────────────────────────────────────────────────────────

  webhooks = {
    getSecret: (): Promise<{ webhook_secret: string | null }> =>
      this.request('GET', '/orgs/me/webhook-secret'),

    rotateSecret: (): Promise<{ webhook_secret: string }> =>
      this.request('POST', '/orgs/me/webhook-secret/rotate'),
  };

  // ── Usage & Analytics ───────────────────────────────────────────────────

  usage = {
    get: (params?: { period?: string }): Promise<unknown> =>
      this.request('GET', '/usage', undefined, params as any),
  };

  analytics = {
    overview: (params?: { period?: string }): Promise<unknown> =>
      this.request('GET', '/analytics/overview', undefined, params as any),

    providerPerformance: (): Promise<unknown> =>
      this.request('GET', '/analytics/providers'),

    policyEffectiveness: (): Promise<unknown> =>
      this.request('GET', '/analytics/policies'),
  };

  // ── Health ──────────────────────────────────────────────────────────────

  health = (): Promise<{ status: string; version: string; timestamp: string }> =>
    this.request('GET', '/health');
}

export { ApiError };
export default AgenticCommerce;
