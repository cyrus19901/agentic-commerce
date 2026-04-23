import { randomUUID } from 'crypto';
import type { DB } from '@agentic-commerce/database';
import type { PolicyService } from './policy-service.js';
import type { AuditService } from './audit-service.js';
import type { ProviderRegistry, BaseTxVerifier } from '@agentic-commerce/integrations';

export interface PaymentExecuteRequest {
  provider: string;
  action: string;
  params: Record<string, unknown>;
  maxPaymentUsdc?: number;
  callbackUrl?: string;
  sandbox?: boolean;
}

export interface PaymentQuoteResult {
  paymentId: string;
  correlationId: string;
  provider: string;
  action: string;
  estimatedCostUsdc: number;
  priceBreakdown?: {
    providerCost: number;
    gordonFee: number;
    feePercent: number;
    total: number;
    currency: string;
    source: string;
  };
  policyResult: unknown;
  allowed: boolean;
  error?: string;
}

export interface ServiceResult {
  content: string;
  contentType: string;
  url?: string;
  statusCode?: number;
  summary?: string;
  raw?: unknown;
}

export interface PaymentExecuteResult {
  paymentId: string;
  status: 'completed' | 'failed' | 'rejected' | 'verification_failed';
  correlationId: string;
  provider: string;
  action: string;
  data?: unknown;
  serviceResult?: ServiceResult;
  baseTxHash?: string;
  paymentAmountUsdc?: number;
  agentWallet?: string;
  policyResult?: unknown;
  txVerification?: unknown;
  error?: string;
  x402Settlement?: {
    success: boolean;
    txHash?: string;
    network?: string;
    payer?: string;
    error?: string;
  };
}

export class PaymentOrchestrator {
  private baseTxVerifier: BaseTxVerifier | null = null;

  constructor(
    private db: DB,
    private policyService: PolicyService,
    private auditService: AuditService,
    private providerRegistry: ProviderRegistry,
  ) {}

  setBaseTxVerifier(verifier: BaseTxVerifier): void {
    this.baseTxVerifier = verifier;
  }

  async verifyTransaction(txHash: string, expected?: { from?: string; amount?: number }): Promise<any> {
    if (!this.baseTxVerifier) return { verified: false, error: 'TX verifier not configured' };
    return this.baseTxVerifier.verify(txHash, expected);
  }

  /**
   * Phase 1 of x402 flow: Quote — run policy check and return price.
   * Does NOT dispatch to provider or touch treasury.
   * Used when returning 402 Payment Required to the buyer.
   */
  async quote(orgId: string, request: PaymentExecuteRequest): Promise<PaymentQuoteResult> {
    const correlationId = `cor_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const provider = await this.providerRegistry.getProvider(request.provider);
    if (!provider || !provider.enabled) {
      return {
        paymentId, correlationId, provider: request.provider, action: request.action,
        estimatedCostUsdc: 0, policyResult: null, allowed: false,
        error: `Unknown or disabled provider: ${request.provider}`,
      };
    }

    const priceQuote = await this.providerRegistry.getProviderPriceQuote(
      request.provider, request.action, request.params || {},
    );

    const policyResult = await this.policyService.checkPolicyOnlyForOrg(orgId, {
      userId: orgId,
      productId: `${request.provider}:${request.action}`,
      price: priceQuote.totalUsdc,
      merchant: request.provider,
      category: 'web-scraping',
      transactionType: 'agent-to-agent',
      serviceType: request.action === 'scrape' ? 'data-scraping' : request.action,
      purpose: (request.params?.url as string) || `${request.provider}:${request.action}`,
    });

    this.auditService.log({
      orgId,
      eventType: policyResult.allowed ? 'policy.checked' : 'policy.violated',
      actor: orgId, actorType: 'system',
      resource: 'policy', resourceId: paymentId,
      action: 'quote', outcome: policyResult.allowed ? 'success' : 'failure',
      details: { policyResult, priceQuote },
      correlationId,
    });

    return {
      paymentId, correlationId,
      provider: request.provider, action: request.action,
      estimatedCostUsdc: priceQuote.totalUsdc,
      priceBreakdown: {
        providerCost: priceQuote.providerCostUsdc,
        gordonFee: priceQuote.gordonFeeUsdc,
        feePercent: priceQuote.feePercent,
        total: priceQuote.totalUsdc,
        currency: 'USDC',
        source: priceQuote.source,
      },
      policyResult,
      allowed: policyResult.allowed,
      error: policyResult.allowed ? undefined : ((policyResult as any)?.reason || 'Policy check failed'),
    };
  }

  /**
   * Phase 2 of x402 flow: Execute with proof — dispatch to provider only.
   * Treasury hold/commit is done internally; on-chain settlement is handled
   * by the x402 facilitator (called from the middleware), not the provider agent.
   */
  async executeWithProof(orgId: string, request: PaymentExecuteRequest): Promise<PaymentExecuteResult> {
    const correlationId = `cor_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    await this.db.pool.query(
      `INSERT INTO payment_requests
         (id, org_id, provider_id, action, params, max_payment_usdc, status, audit_correlation_id, callback_url, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'executing',$7,$8,$9)`,
      [
        paymentId, orgId, request.provider, request.action,
        JSON.stringify(request.params), request.maxPaymentUsdc ?? null,
        correlationId, request.callbackUrl ?? null, new Date(),
      ],
    );

    this.auditService.log({
      orgId, eventType: 'payment.initiated', actor: orgId, actorType: 'system',
      resource: 'payment', resourceId: paymentId,
      action: `${request.provider}/${request.action}`,
      outcome: 'pending', details: { provider: request.provider, action: request.action, mode: 'x402' },
      correlationId,
    });

    const priceQuote = await this.providerRegistry.getProviderPriceQuote(
      request.provider, request.action, request.params,
    );
    const estimatedCost = request.maxPaymentUsdc ?? priceQuote.totalUsdc;
    let reservationEntryId: string | undefined;

    try {
      const treasury = await this.db.createOrGetOrgTreasuryAccount(orgId);
      if (treasury.balanceAvailable < estimatedCost) {
        return this.fail(paymentId, orgId, correlationId, request,
          `Insufficient treasury balance. Need $${estimatedCost}, have $${treasury.balanceAvailable.toFixed(6)}`);
      }

      const holdResult = await this.db.pool.query(
        `UPDATE org_treasury_accounts
         SET balance_available = balance_available - $1, balance_reserved = balance_reserved + $1, updated_at = $2
         WHERE org_id = $3 AND balance_available >= $1
         RETURNING balance_available, balance_reserved`,
        [estimatedCost, new Date(), orgId],
      );
      if (!holdResult.rows[0]) return this.fail(paymentId, orgId, correlationId, request, 'Failed to reserve funds');

      reservationEntryId = `orgledger_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      await this.db.pool.query(
        `INSERT INTO org_treasury_ledger_entries
           (id, treasury_account_id, entry_type, amount, currency, reference_type, reference_id, status, created_at)
         VALUES ($1, (SELECT id FROM org_treasury_accounts WHERE org_id = $2), 'reserve', $3, 'USDC', 'payment-hold', $4, 'posted', $5)`,
        [reservationEntryId, orgId, estimatedCost, paymentId, new Date()],
      );
    } catch (err: any) {
      return this.fail(paymentId, orgId, correlationId, request, `Treasury hold failed: ${err.message}`);
    }

    const dispatchResult = await this.providerRegistry.dispatch(request.provider, request.action, request.params);

    if (!dispatchResult.success) {
      await this.releaseHold(orgId, estimatedCost, reservationEntryId, paymentId);
      return this.fail(
        paymentId, orgId, correlationId, request,
        dispatchResult.error || 'Provider dispatch failed',
        dispatchResult.data,
      );
    }

    const actualAmount = estimatedCost;
    const excess = estimatedCost - actualAmount;
    await this.db.pool.query(
      `UPDATE org_treasury_accounts
       SET balance_reserved = balance_reserved - $1, balance_available = balance_available + $2, updated_at = $3
       WHERE org_id = $4`,
      [estimatedCost, excess > 0 ? excess : 0, new Date(), orgId],
    );

    await this.db.pool.query(
      `INSERT INTO org_treasury_ledger_entries
         (id, treasury_account_id, entry_type, amount, currency, reference_type, reference_id, status, metadata, created_at)
       VALUES ($1, (SELECT id FROM org_treasury_accounts WHERE org_id = $2), 'debit', $3, 'USDC', 'x402-settlement', $4, 'posted', $5, $6)`,
      [
        `orgledger_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        orgId, actualAmount, paymentId,
        JSON.stringify({
          provider: request.provider,
          mode: 'x402-facilitator',
          priceBreakdown: {
            providerCost: priceQuote.providerCostUsdc,
            gordonFee: priceQuote.gordonFeeUsdc,
            total: priceQuote.totalUsdc,
            source: priceQuote.source,
          },
        }),
        new Date(),
      ],
    );

    await this.db.pool.query(
      `UPDATE payment_requests
       SET status = 'completed', provider_response = $1, payment_amount_usdc = $2, completed_at = $3
       WHERE id = $4`,
      [JSON.stringify(dispatchResult.data), actualAmount, new Date(), paymentId],
    );

    this.auditService.log({
      orgId, eventType: 'payment.x402_settled', actor: orgId, actorType: 'system',
      resource: 'payment', resourceId: paymentId, action: 'x402-settled', outcome: 'success',
      details: {
        provider: request.provider, action: request.action,
        paymentAmountUsdc: actualAmount, mode: 'x402-facilitator',
        priceBreakdown: {
          providerCost: priceQuote.providerCostUsdc,
          gordonFee: priceQuote.gordonFeeUsdc,
          feePercent: priceQuote.feePercent,
          total: priceQuote.totalUsdc,
          source: priceQuote.source,
        },
      },
      correlationId,
    });

    return {
      paymentId, status: 'completed', correlationId,
      provider: request.provider, action: request.action,
      data: dispatchResult.data,
      serviceResult: this.normalizeServiceResult(request.provider, dispatchResult.data),
      baseTxHash: dispatchResult.baseTxHash,
      paymentAmountUsdc: actualAmount,
      agentWallet: dispatchResult.agentWallet,
      policyResult: { allowed: true },
    };
  }

  async execute(orgId: string, request: PaymentExecuteRequest): Promise<PaymentExecuteResult> {
    const correlationId = `cor_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Persist the request
    await this.db.pool.query(
      `INSERT INTO payment_requests
         (id, org_id, provider_id, action, params, max_payment_usdc, status, audit_correlation_id, callback_url, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9)`,
      [
        paymentId, orgId, request.provider, request.action,
        JSON.stringify(request.params), request.maxPaymentUsdc ?? null,
        correlationId, request.callbackUrl ?? null, new Date(),
      ],
    );

    this.auditService.log({
      orgId,
      eventType: 'payment.initiated',
      actor: orgId,
      actorType: 'system',
      resource: 'payment',
      resourceId: paymentId,
      action: `${request.provider}/${request.action}`,
      outcome: 'pending',
      details: { provider: request.provider, action: request.action, params: request.params },
      correlationId,
    });

    // 1. Resolve provider
    const provider = await this.providerRegistry.getProvider(request.provider);
    if (!provider || !provider.enabled) {
      return this.fail(paymentId, orgId, correlationId, request, `Unknown or disabled provider: ${request.provider}`);
    }

    // 2. Policy check — with real-time provider pricing
    await this.updateStatus(paymentId, 'policy_check');
    const priceQuote = await this.providerRegistry.getProviderPriceQuote(
      request.provider, request.action, request.params,
    );
    const estimatedCost = priceQuote.totalUsdc;
    const policyResult = await this.policyService.checkPolicyOnlyForOrg(orgId, {
      userId: orgId,
      productId: `${request.provider}:${request.action}`,
      price: estimatedCost,
      merchant: request.provider,
      category: 'web-scraping',
      transactionType: 'agent-to-agent',
      serviceType: request.action === 'scrape' ? 'data-scraping' : request.action,
      purpose: (request.params?.url as string) || `${request.provider}:${request.action}`,
    });

    this.auditService.log({
      orgId,
      eventType: policyResult.allowed ? 'policy.checked' : 'policy.violated',
      actor: orgId,
      actorType: 'system',
      resource: 'policy',
      resourceId: paymentId,
      action: 'check',
      outcome: policyResult.allowed ? 'success' : 'failure',
      details: { policyResult },
      correlationId,
    });

    if (!policyResult.allowed) {
      return this.reject(paymentId, orgId, correlationId, request, policyResult);
    }

    // 3. Hold funds from org treasury
    await this.updateStatus(paymentId, 'executing');
    const holdAmount = request.maxPaymentUsdc ?? estimatedCost;
    let reservationEntryId: string | undefined;

    try {
      const treasury = await this.db.createOrGetOrgTreasuryAccount(orgId);
      if (treasury.balanceAvailable < holdAmount) {
        return this.fail(
          paymentId, orgId, correlationId, request,
          `Insufficient treasury balance. Need $${holdAmount}, have $${treasury.balanceAvailable.toFixed(6)}`,
        );
      }

      const holdResult = await this.db.pool.query(
        `UPDATE org_treasury_accounts
         SET balance_available = balance_available - $1, balance_reserved = balance_reserved + $1, updated_at = $2
         WHERE org_id = $3 AND balance_available >= $1
         RETURNING balance_available, balance_reserved`,
        [holdAmount, new Date(), orgId],
      );

      if (!holdResult.rows[0]) {
        return this.fail(paymentId, orgId, correlationId, request, 'Failed to reserve funds');
      }

      // Create ledger entry for the hold
      reservationEntryId = `orgledger_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      await this.db.pool.query(
        `INSERT INTO org_treasury_ledger_entries
           (id, treasury_account_id, entry_type, amount, currency, reference_type, reference_id, status, created_at)
         VALUES ($1, (SELECT id FROM org_treasury_accounts WHERE org_id = $2), 'reserve', $3, 'USDC', 'payment-hold', $4, 'posted', $5)`,
        [reservationEntryId, orgId, holdAmount, paymentId, new Date()],
      );

      this.auditService.log({
        orgId,
        eventType: 'wallet.transfer',
        actor: orgId,
        actorType: 'system',
        resource: 'treasury',
        resourceId: paymentId,
        action: 'hold',
        outcome: 'success',
        details: { amount: holdAmount, reservationEntryId },
        correlationId,
      });
    } catch (err: any) {
      return this.fail(paymentId, orgId, correlationId, request, `Treasury hold failed: ${err.message}`);
    }

    // 4. Dispatch to provider agent
    const dispatchResult = await this.providerRegistry.dispatch(
      request.provider,
      request.action,
      request.params,
    );

    if (!dispatchResult.success) {
      await this.releaseHold(orgId, holdAmount, reservationEntryId, paymentId);
      return this.fail(
        paymentId, orgId, correlationId, request,
        dispatchResult.error || 'Provider dispatch failed',
        dispatchResult.data,
      );
    }

    // 5. Verify on-chain TX if baseTxHash is present
    let txVerification: any = null;
    if (dispatchResult.baseTxHash && this.baseTxVerifier) {
      await this.updateStatus(paymentId, 'verifying');
      txVerification = await this.baseTxVerifier.verify(dispatchResult.baseTxHash, {
        from: dispatchResult.agentWallet,
      });

      this.auditService.log({
        orgId,
        eventType: txVerification.verified ? 'payment.x402_settled' : 'payment.x402_failed',
        actor: orgId, actorType: 'system',
        resource: 'payment', resourceId: paymentId,
        action: 'verify_tx',
        outcome: txVerification.verified ? 'success' : 'failure',
        details: { txHash: dispatchResult.baseTxHash, verification: txVerification },
        correlationId,
      });

      if (!txVerification.verified) {
        await this.releaseHold(orgId, holdAmount, reservationEntryId, paymentId);
        await this.db.pool.query(
          'UPDATE payment_requests SET status = $1, error = $2, completed_at = $3 WHERE id = $4',
          ['verification_failed', txVerification.error, new Date(), paymentId],
        );
        return {
          paymentId, status: 'verification_failed' as const, correlationId,
          provider: request.provider, action: request.action,
          baseTxHash: dispatchResult.baseTxHash, txVerification,
          error: `On-chain verification failed: ${txVerification.error}`,
        };
      }
    }

    // 6. Commit hold (deduct from reserved, finalize)
    const actualAmount = dispatchResult.paymentAmount
      ? parseFloat(dispatchResult.paymentAmount.replace(/[^0-9.]/g, ''))
      : holdAmount;

    // Commit: reduce reserved, and release any excess back to available
    const excess = holdAmount - actualAmount;
    await this.db.pool.query(
      `UPDATE org_treasury_accounts
       SET balance_reserved = balance_reserved - $1,
           balance_available = balance_available + $2,
           updated_at = $3
       WHERE org_id = $4`,
      [holdAmount, excess > 0 ? excess : 0, new Date(), orgId],
    );

    // Create debit ledger entry
    await this.db.pool.query(
      `INSERT INTO org_treasury_ledger_entries
         (id, treasury_account_id, entry_type, amount, currency, reference_type, reference_id, status, metadata, created_at)
       VALUES ($1, (SELECT id FROM org_treasury_accounts WHERE org_id = $2), 'debit', $3, 'USDC', 'payment-settlement', $4, 'posted', $5, $6)`,
      [
        `orgledger_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        orgId, actualAmount, paymentId,
        JSON.stringify({ baseTxHash: dispatchResult.baseTxHash, provider: request.provider }),
        new Date(),
      ],
    );

    // 6. Update payment request record
    await this.db.pool.query(
      `UPDATE payment_requests
       SET status = 'completed',
           provider_response = $1,
           base_tx_hash = $2,
           payment_amount_usdc = $3,
           policy_result = $4,
           completed_at = $5
       WHERE id = $6`,
      [
        JSON.stringify(dispatchResult.data),
        dispatchResult.baseTxHash ?? null,
        actualAmount,
        JSON.stringify(policyResult),
        new Date(),
        paymentId,
      ],
    );

    this.auditService.log({
      orgId,
      eventType: 'payment.x402_settled',
      actor: orgId,
      actorType: 'system',
      resource: 'payment',
      resourceId: paymentId,
      action: 'settled',
      outcome: 'success',
      details: {
        provider: request.provider,
        action: request.action,
        baseTxHash: dispatchResult.baseTxHash,
        paymentAmountUsdc: actualAmount,
        agentWallet: dispatchResult.agentWallet,
      },
      correlationId,
    });

    return {
      paymentId,
      status: 'completed',
      correlationId,
      provider: request.provider,
      action: request.action,
      data: dispatchResult.data,
      serviceResult: this.normalizeServiceResult(request.provider, dispatchResult.data),
      baseTxHash: dispatchResult.baseTxHash,
      paymentAmountUsdc: actualAmount,
      agentWallet: dispatchResult.agentWallet,
      policyResult,
    };
  }

  async getPayment(paymentId: string, orgId: string): Promise<any | null> {
    const { rows } = await this.db.pool.query(
      'SELECT * FROM payment_requests WHERE id = $1 AND org_id = $2',
      [paymentId, orgId],
    );
    if (!rows[0]) return null;
    return mapPaymentRequest(rows[0]);
  }

  async listPayments(orgId: string, opts: { limit?: number; offset?: number; status?: string } = {}): Promise<{ payments: any[]; total: number }> {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    let where = 'WHERE org_id = $1';
    const params: any[] = [orgId];
    if (opts.status) {
      where += ` AND status = $${params.length + 1}`;
      params.push(opts.status);
    }

    const countRes = await this.db.pool.query(`SELECT COUNT(*) FROM payment_requests ${where}`, params);
    const total = Number(countRes.rows[0].count);

    params.push(limit, offset);
    const { rows } = await this.db.pool.query(
      `SELECT * FROM payment_requests ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { payments: rows.map(mapPaymentRequest), total };
  }

  private normalizeServiceResult(provider: string, data: unknown): ServiceResult | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const d = data as Record<string, any>;

    if (provider === 'zyte') {
      const content = d.browserHtml || d.httpResponseBody || JSON.stringify(d, null, 2);
      return {
        content: typeof content === 'string' ? content : JSON.stringify(content),
        contentType: d.browserHtml ? 'text/html' : 'application/json',
        url: d.url,
        statusCode: d.statusCode,
        raw: d,
      };
    }

    if (provider === 'firecrawl') {
      const content = d.markdown || d.content || d.html || JSON.stringify(d, null, 2);
      return {
        content: typeof content === 'string' ? content : JSON.stringify(content),
        contentType: d.markdown ? 'text/markdown' : d.html ? 'text/html' : 'application/json',
        url: d.url || d.sourceUrl,
        statusCode: d.statusCode,
        raw: d,
      };
    }

    if (provider === 'robtex') {
      const records = d.records || d.result || d;
      return {
        content: JSON.stringify(records, null, 2),
        contentType: 'application/json',
        url: d.resource,
        statusCode: 200,
        summary: this.extractRobtexSummary(records),
        raw: d,
      };
    }

    if (provider === 'x402-direct') {
      return {
        content: JSON.stringify(d.results || d, null, 2),
        contentType: 'application/json',
        url: d.resource,
        statusCode: 200,
        summary: d.results ? `${d.results.length} services found` : undefined,
        raw: d,
      };
    }

    const nested =
      d?.result?.data ||
      d?.data?.result?.data ||
      d?.response?.data ||
      null;
    if (nested && typeof nested === 'object') {
      const processed =
        nested.processed_content ||
        nested.content ||
        nested.markdown ||
        nested.text;
      if (typeof processed === 'string' && processed.trim().length > 0) {
        return {
          content: processed,
          contentType: nested.markdown ? 'text/markdown' : 'text/plain',
          url: nested.url || d.url || d.resource,
          statusCode: Number(d.statusCode || nested.statusCode || 200),
          summary: `Extracted content (${processed.length} chars)`,
          raw: d,
        };
      }
    }

    return {
      content: JSON.stringify(d, null, 2),
      contentType: 'application/json',
      raw: d,
    };
  }

  private extractRobtexSummary(data: any): string {
    if (!data) return '';
    if (Array.isArray(data)) {
      const ips = data.map((r: any) => r.data || r.ip || r.a).filter(Boolean);
      return ips.length ? `Resolved: ${ips.slice(0, 5).join(', ')}` : `${data.length} records`;
    }
    if (data.ip) return `IP: ${data.ip}`;
    return '';
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async updateStatus(paymentId: string, status: string): Promise<void> {
    await this.db.pool.query('UPDATE payment_requests SET status = $1 WHERE id = $2', [status, paymentId]);
  }

  private async releaseHold(orgId: string, amount: number, reservationEntryId: string | undefined, paymentId: string): Promise<void> {
    try {
      await this.db.pool.query(
        `UPDATE org_treasury_accounts
         SET balance_available = balance_available + $1, balance_reserved = GREATEST(0, balance_reserved - $1), updated_at = $2
         WHERE org_id = $3`,
        [amount, new Date(), orgId],
      );
      if (reservationEntryId) {
        await this.db.pool.query(
          `INSERT INTO org_treasury_ledger_entries
             (id, treasury_account_id, entry_type, amount, currency, reference_type, reference_id, status, created_at)
           VALUES ($1, (SELECT id FROM org_treasury_accounts WHERE org_id = $2), 'release', $3, 'USDC', 'payment-release', $4, 'posted', $5)`,
          [
            `orgledger_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            orgId, amount, paymentId, new Date(),
          ],
        );
      }
    } catch (err: any) {
      console.error('[PaymentOrchestrator] Release hold failed:', err.message);
    }
  }

  private async fail(
    paymentId: string, orgId: string, correlationId: string,
    request: PaymentExecuteRequest, error: string,
    data?: unknown,
  ): Promise<PaymentExecuteResult> {
    await this.db.pool.query(
      'UPDATE payment_requests SET status = $1, error = $2, completed_at = $3 WHERE id = $4',
      ['failed', error, new Date(), paymentId],
    );
    this.auditService.log({
      orgId,
      eventType: 'payment.x402_failed',
      actor: orgId, actorType: 'system',
      resource: 'payment', resourceId: paymentId,
      action: `${request.provider}/${request.action}`,
      outcome: 'failure',
      details: { error, ...(data !== undefined ? { dispatchData: data } : {}) },
      correlationId,
    });
    return {
      paymentId, status: 'failed', correlationId,
      provider: request.provider, action: request.action, error,
      ...(data !== undefined ? { data } : {}),
    };
  }

  private async reject(
    paymentId: string, orgId: string, correlationId: string,
    request: PaymentExecuteRequest, policyResult: unknown,
  ): Promise<PaymentExecuteResult> {
    await this.db.pool.query(
      'UPDATE payment_requests SET status = $1, policy_result = $2, completed_at = $3 WHERE id = $4',
      ['rejected', JSON.stringify(policyResult), new Date(), paymentId],
    );
    return {
      paymentId, status: 'rejected', correlationId,
      provider: request.provider, action: request.action,
      policyResult,
      error: (policyResult as any)?.reason || 'Policy check failed',
    };
  }
}

function mapPaymentRequest(row: any): any {
  return {
    id: row.id,
    orgId: row.org_id,
    provider: row.provider_id,
    action: row.action,
    params: JSON.parse(row.params || '{}'),
    maxPaymentUsdc: row.max_payment_usdc ? Number(row.max_payment_usdc) : null,
    status: row.status,
    policyResult: row.policy_result ? JSON.parse(row.policy_result) : null,
    providerResponse: row.provider_response ? JSON.parse(row.provider_response) : null,
    baseTxHash: row.base_tx_hash,
    paymentAmountUsdc: row.payment_amount_usdc ? Number(row.payment_amount_usdc) : null,
    correlationId: row.audit_correlation_id,
    callbackUrl: row.callback_url,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
