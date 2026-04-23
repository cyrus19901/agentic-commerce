import { Router, Request, Response } from 'express';
import { randomBytes, createHash } from 'crypto';
import rateLimit from 'express-rate-limit';
import type { DB } from '@agentic-commerce/database';
import type { PolicyService, AuditService, PaymentOrchestrator } from '@agentic-commerce/core';
import type { ProviderRegistry } from '@agentic-commerce/integrations';
import { requireScope, generateApiKey, hashApiKey, isTestKey } from './middleware/api-key-auth';
import { validate } from './middleware/validate';
import { sendWebhookCallback } from './middleware/webhook-signer';
import { mockProviderResponse } from './middleware/sandbox';
import { x402Paywall, getX402Context } from './middleware/x402-handler';
import { openapiSpec } from './openapi';
import { policyTemplates } from './policy-templates';
import * as S from './schemas/v1';

export function createV1Router(deps: {
  db: DB;
  policyService: PolicyService;
  auditService: AuditService;
  paymentOrchestrator: PaymentOrchestrator;
  providerRegistry: ProviderRegistry;
}): Router {
  const router = Router();
  const { db, policyService, auditService, paymentOrchestrator, providerRegistry } = deps;

  const paymentLimiter = rateLimit({
    windowMs: 60_000,
    max: parseInt(process.env.RATE_LIMIT_PAYMENTS || '30', 10),
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Payment rate limit exceeded' } },
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Payments
  // ══════════════════════════════════════════════════════════════════════════

  // x402-native payment endpoint.
  // Without PAYMENT-SIGNATURE header → probe provider → 402 + real price quote
  // With PAYMENT-SIGNATURE header → verify → execute → settle → 200
  router.post('/payments/execute',
    requireScope('payments:write'),
    paymentLimiter,
    validate({ body: S.PaymentExecuteBody }),
    x402Paywall(async (req) => {
      const apiKey = (req.headers['x-api-key'] as string) || '';
      const isSandbox = req.body?.sandbox === true || isTestKey(apiKey);
      if (isSandbox) return null;

      const provider = req.body?.provider;
      const action = req.body?.action;
      const params = req.body?.params || {};

      const priceQuote = await providerRegistry.getProviderPriceQuote(provider, action, params);

      return {
        amountUsdc: priceQuote.totalUsdc,
        description: `${provider}/${action} via Gordon`,
        payTo: priceQuote.payTo,
        supportedNetworks: priceQuote.supportedNetworks,
        priceQuote,
      };
    }),
    async (req: Request, res: Response) => {
      try {
        const org = req.org!;
        const { provider, action, params, max_payment_usdc, callback_url, sandbox } = req.body;
        const apiKey = (req.headers['x-api-key'] as string) || '';
        const isSandbox = sandbox === true || isTestKey(apiKey);

        if (isSandbox) {
          const mock = mockProviderResponse(provider, action, params || {});
          const sandboxResult = {
            paymentId: `pay_sandbox_${Date.now()}`,
            status: 'completed' as const,
            correlationId: `cor_sandbox_${Date.now()}`,
            provider, action,
            sandbox: true,
            data: mock.data,
            baseTxHash: mock.baseTxHash,
            paymentAmountUsdc: 0.01,
            agentWallet: mock.agentWallet,
          };
          res.json(sandboxResult);
          return;
        }

        const x402 = getX402Context(req);

        // If x402 verified, use the new executeWithProof path
        if (x402?.verified) {
          const result = await paymentOrchestrator.executeWithProof(org.orgId, {
            provider, action,
            params: params || {},
            maxPaymentUsdc: max_payment_usdc,
            callbackUrl: callback_url,
          });

          if (callback_url) {
            const whSecret = await getWebhookSecret(db, org.orgId);
            if (whSecret) {
              sendWebhookCallback(callback_url, result as any, whSecret).catch(err =>
                console.error('[Webhook] Callback failed:', err),
              );
            }
          }

          const status = result.status === 'completed' ? 200 : result.status === 'rejected' ? 403 : 500;
          res.status(status).json(result);
          return;
        }

        // Fallback: legacy mode (API-key auth only, no x402 headers)
        const result = await paymentOrchestrator.execute(org.orgId, {
          provider, action,
          params: params || {},
          maxPaymentUsdc: max_payment_usdc,
          callbackUrl: callback_url,
        });

        if (callback_url) {
          const whSecret = await getWebhookSecret(db, org.orgId);
          if (whSecret) {
            sendWebhookCallback(callback_url, result as any, whSecret).catch(err =>
              console.error('[Webhook] Callback failed:', err),
            );
          }
        }

        const status = result.status === 'completed' ? 200 : result.status === 'rejected' ? 403 : 500;
        res.status(status).json(result);
      } catch (err: any) {
        console.error('[v1/payments/execute] Error:', err);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  // Quote endpoint — returns price and policy check without executing
  router.post('/payments/quote',
    requireScope('payments:read'),
    validate({ body: S.PaymentExecuteBody }),
    async (req: Request, res: Response) => {
      try {
        const { provider, action, params } = req.body;
        const quote = await paymentOrchestrator.quote(req.org!.orgId, {
          provider, action, params: params || {},
        });
        res.json(quote);
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.get('/payments',
    requireScope('payments:read'),
    validate({ query: S.PaginationQuery }),
    async (req: Request, res: Response) => {
      try {
        const { limit, offset, status } = req.query;
        const result = await paymentOrchestrator.listPayments(req.org!.orgId, {
          limit: limit ? Number(limit) : undefined,
          offset: offset ? Number(offset) : undefined,
          status: status as string,
        });
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.get('/payments/:id',
    requireScope('payments:read'),
    async (req: Request, res: Response) => {
      try {
        const payment = await paymentOrchestrator.getPayment(req.params.id, req.org!.orgId);
        if (!payment) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found' } }); return; }
        res.json(payment);
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.get('/payments/:id/trace',
    requireScope('payments:read', 'audit:read'),
    async (req: Request, res: Response) => {
      try {
        const payment = await paymentOrchestrator.getPayment(req.params.id, req.org!.orgId);
        if (!payment) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found' } }); return; }
        const trace = await auditService.getTransactionTrace(payment.correlationId);
        res.json({ paymentId: payment.id, correlationId: payment.correlationId, trace });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.get('/payments/:id/verify',
    requireScope('payments:read'),
    async (req: Request, res: Response) => {
      try {
        const payment = await paymentOrchestrator.getPayment(req.params.id, req.org!.orgId);
        if (!payment) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found' } }); return; }
        if (!payment.baseTxHash) {
          res.json({ paymentId: payment.id, verified: false, error: 'No on-chain transaction to verify' });
          return;
        }
        const verification = await paymentOrchestrator.verifyTransaction(payment.baseTxHash, {
          amount: payment.paymentAmountUsdc,
        });
        res.json({ paymentId: payment.id, baseTxHash: payment.baseTxHash, ...verification });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Policies
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/policies',
    requireScope('policies:read'),
    async (req: Request, res: Response) => {
      try {
        const policies = await db.getPoliciesByOrg(req.org!.orgId);
        if (policies.length === 0) {
          const globalPolicies = await db.getAllPolicies();
          res.json({ policies: globalPolicies, source: 'global' });
          return;
        }
        res.json({ policies, source: 'org' });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.post('/policies',
    requireScope('policies:write'),
    validate({ body: S.PolicyCreateBody }),
    async (req: Request, res: Response) => {
      try {
        const org = req.org!;
        const { name, type, enabled, priority, conditions, rules } = req.body;
        const id = `policy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const policy = {
          id, name, type,
          enabled: enabled ?? true,
          priority: priority ?? 50,
          conditions: conditions || {},
          rules: rules || {},
          transactionTypes: conditions?.transactionType || ['agent-to-merchant'],
        };
        await db.createPolicy(policy, org.orgId);
        auditService.log({ orgId: org.orgId, eventType: 'policy.created', actor: org.orgId, actorType: 'system', resource: 'policy', resourceId: id, action: 'create', outcome: 'success', details: { name, type } });
        res.status(201).json(policy);
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.put('/policies/:id',
    requireScope('policies:write'),
    validate({ body: S.PolicyUpdateBody }),
    async (req: Request, res: Response) => {
      try {
        const existing = await db.getPolicyById(req.params.id);
        if (!existing) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Policy not found' } }); return; }
        const updated = { ...existing, ...req.body, id: existing.id };
        await db.updatePolicy(updated);
        auditService.log({ orgId: req.org!.orgId, eventType: 'policy.updated', actor: req.org!.orgId, actorType: 'system', resource: 'policy', resourceId: existing.id, action: 'update', outcome: 'success', details: { changes: Object.keys(req.body) } });
        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.delete('/policies/:id',
    requireScope('policies:write'),
    async (req: Request, res: Response) => {
      try {
        await db.deletePolicy(req.params.id);
        auditService.log({ orgId: req.org!.orgId, eventType: 'policy.deleted', actor: req.org!.orgId, actorType: 'system', resource: 'policy', resourceId: req.params.id, action: 'delete', outcome: 'success', details: {} });
        res.json({ deleted: true });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.post('/policies/check',
    requireScope('policies:read'),
    validate({ body: S.PolicyCheckBody }),
    async (req: Request, res: Response) => {
      try {
        const { price, merchant, category, transactionType, serviceType } = req.body;
        const result = await policyService.checkPolicyOnlyForOrg(req.org!.orgId, {
          userId: req.org!.orgId, productId: 'dry-run',
          price: price || 0, merchant: merchant || 'unknown',
          category, transactionType: transactionType || 'agent-to-agent', serviceType,
        });
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Audit
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/audit',
    requireScope('audit:read'),
    validate({ query: S.AuditQuery }),
    async (req: Request, res: Response) => {
      try {
        const { event_type, actor, resource, outcome, since, until, limit, offset, correlation_id } = req.query;
        const result = await auditService.query({
          orgId: req.org!.orgId,
          eventType: event_type as any, actor: actor as string,
          resource: resource as string, outcome: outcome as string,
          since: since as string, until: until as string,
          limit: limit ? Number(limit) : undefined, offset: offset ? Number(offset) : undefined,
          correlationId: correlation_id as string,
        });
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.get('/audit/stats',
    requireScope('audit:read'),
    async (req: Request, res: Response) => {
      try {
        const stats = await auditService.getStats(req.org!.orgId);
        res.json(stats);
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.get('/audit/:id',
    requireScope('audit:read'),
    async (req: Request, res: Response) => {
      try {
        const entry = await auditService.getEntry(req.params.id);
        if (!entry) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Audit entry not found' } }); return; }
        res.json(entry);
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Treasury
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/treasury',
    requireScope('treasury:read'),
    async (req: Request, res: Response) => {
      try {
        const account = await db.createOrGetOrgTreasuryAccount(req.org!.orgId);
        res.json(account);
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.get('/treasury/ledger',
    requireScope('treasury:read'),
    validate({ query: S.TreasuryLedgerQuery }),
    async (req: Request, res: Response) => {
      try {
        const orgId = req.org!.orgId;
        const limit = Number(req.query.limit || 50);
        const offset = Number(req.query.offset || 0);
        const entryType = req.query.entry_type as string | undefined;

        const treasury = await db.createOrGetOrgTreasuryAccount(orgId);
        let where = 'WHERE le.treasury_account_id = $1';
        const params: any[] = [treasury.id];

        if (entryType) {
          where += ` AND le.entry_type = $${params.length + 1}`;
          params.push(entryType);
        }

        const countRes = await db.pool.query(`SELECT COUNT(*) FROM org_treasury_ledger_entries le ${where}`, params);
        const total = Number(countRes.rows[0].count);

        params.push(limit, offset);
        const { rows } = await db.pool.query(
          `SELECT le.* FROM org_treasury_ledger_entries le ${where} ORDER BY le.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        );

        res.json({ entries: rows, total, limit, offset });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.post('/treasury/deposit',
    requireScope('admin'),
    validate({ body: S.TreasuryDepositBody }),
    async (req: Request, res: Response) => {
      try {
        const { amount, reference, tx_hash } = req.body;
        const orgId = req.org!.orgId;

        const result = await db.topUpOrgTreasury({
          orgId, amount, currency: 'USDC',
          referenceType: 'manual-deposit',
          referenceId: reference,
          idempotencyKey: `deposit_${orgId}_${Date.now()}`,
          metadata: tx_hash ? { onChainTxHash: tx_hash } : undefined,
        });

        auditService.log({
          orgId, eventType: 'wallet.funded', actor: orgId, actorType: 'system',
          resource: 'treasury', resourceId: result.treasuryAccountId,
          action: 'deposit', outcome: 'success',
          details: { amount, reference, tx_hash },
        });

        res.json({ success: true, ...result });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.get('/treasury/reconcile',
    requireScope('admin'),
    async (req: Request, res: Response) => {
      try {
        const treasury = await db.createOrGetOrgTreasuryAccount(req.org!.orgId);
        const { rows: pending } = await db.pool.query(
          `SELECT COUNT(*), COALESCE(SUM(payment_amount_usdc), 0) as total_spent
           FROM payment_requests WHERE org_id = $1 AND status = 'completed'`,
          [req.org!.orgId],
        );
        res.json({
          treasury,
          payments: { completedCount: Number(pending[0]?.count || 0), totalSpent: Number(pending[0]?.total_spent || 0) },
          note: 'For full on-chain reconciliation, verify each payment baseTxHash via GET /payments/:id/verify',
        });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Providers
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/providers',
    requireScope('providers:read'),
    async (req: Request, res: Response) => {
      try {
        const providers = await providerRegistry.listProviders();
        res.json({ providers });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.get('/providers/:id',
    requireScope('providers:read'),
    async (req: Request, res: Response) => {
      try {
        const provider = await providerRegistry.getProvider(req.params.id);
        if (!provider) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Provider not found' } }); return; }
        res.json(provider);
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Organization Management
  // ══════════════════════════════════════════════════════════════════════════

  router.post('/orgs',
    requireScope('admin'),
    validate({ body: S.OrgCreateBody }),
    async (req: Request, res: Response) => {
      try {
        const { name, slug } = req.body;
        const orgId = `org-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const webhookSecret = randomBytes(32).toString('hex');
        const now = new Date();

        await db.pool.query(
          `INSERT INTO organizations (id, name, slug, status, webhook_secret, created_at, updated_at)
           VALUES ($1, $2, $3, 'active', $4, $5, $6)`,
          [orgId, name, slug, webhookSecret, now, now],
        );

        await db.createOrGetOrgTreasuryAccount(orgId);

        const rawKey = generateApiKey();
        const keyHash = hashApiKey(rawKey);
        const keyId = `apikey-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        await db.pool.query(
          `INSERT INTO api_keys (id, org_id, key_hash, key_prefix, name, scopes, rate_limit, enabled, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
          [keyId, orgId, keyHash, rawKey.slice(0, 10), 'Default Key', '["*"]', 100, now],
        );

        auditService.log({ orgId, eventType: 'user.created', actor: req.org!.orgId, actorType: 'system', resource: 'organization', resourceId: orgId, action: 'create', outcome: 'success', details: { name, slug } });

        res.status(201).json({
          organization: { id: orgId, name, slug, status: 'active' },
          api_key: { id: keyId, key: rawKey, prefix: rawKey.slice(0, 10) },
          webhook_secret: webhookSecret,
        });
      } catch (err: any) {
        if (err.constraint === 'organizations_slug_key') {
          res.status(409).json({ error: { code: 'VALIDATION_ERROR', message: 'Organization slug already exists' } });
          return;
        }
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.get('/orgs/me', async (req: Request, res: Response) => {
    try {
      const { rows } = await db.pool.query(
        'SELECT id, name, slug, status, created_at, updated_at FROM organizations WHERE id = $1',
        [req.org!.orgId],
      );
      if (!rows[0]) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Organization not found' } }); return; }
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  router.put('/orgs/me',
    requireScope('admin'),
    validate({ body: S.OrgUpdateBody }),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.body;
        if (name) {
          await db.pool.query('UPDATE organizations SET name = $1, updated_at = $2 WHERE id = $3', [name, new Date(), req.org!.orgId]);
        }
        const { rows } = await db.pool.query('SELECT id, name, slug, status, created_at, updated_at FROM organizations WHERE id = $1', [req.org!.orgId]);
        res.json(rows[0]);
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  // ── API Key Lifecycle ──────────────────────────────────────────────────────

  router.post('/orgs/me/api-keys',
    requireScope('admin'),
    validate({ body: S.ApiKeyCreateBody }),
    async (req: Request, res: Response) => {
      try {
        const { name, scopes, expires_at } = req.body;
        const rawKey = generateApiKey();
        const keyHash = hashApiKey(rawKey);
        const keyId = `apikey-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const now = new Date();

        await db.pool.query(
          `INSERT INTO api_keys (id, org_id, key_hash, key_prefix, name, scopes, rate_limit, enabled, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)`,
          [keyId, req.org!.orgId, keyHash, rawKey.slice(0, 10), name, JSON.stringify(scopes), 100, expires_at ? new Date(expires_at) : null, now],
        );

        auditService.log({ orgId: req.org!.orgId, eventType: 'wallet.created', actor: req.org!.orgId, actorType: 'system', resource: 'api_key', resourceId: keyId, action: 'create', outcome: 'success', details: { name, scopes } });

        res.status(201).json({ id: keyId, key: rawKey, prefix: rawKey.slice(0, 10), name, scopes, expires_at: expires_at || null });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.get('/orgs/me/api-keys',
    requireScope('admin'),
    async (req: Request, res: Response) => {
      try {
        const { rows } = await db.pool.query(
          `SELECT id, key_prefix, name, scopes, rate_limit, enabled, last_used_at, expires_at, created_at
           FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC`,
          [req.org!.orgId],
        );
        res.json({ keys: rows.map(r => ({ ...r, scopes: JSON.parse(r.scopes || '["*"]') })) });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.delete('/orgs/me/api-keys/:id',
    requireScope('admin'),
    async (req: Request, res: Response) => {
      try {
        const result = await db.pool.query(
          'UPDATE api_keys SET enabled = false WHERE id = $1 AND org_id = $2 RETURNING id',
          [req.params.id, req.org!.orgId],
        );
        if (!result.rows[0]) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }); return; }
        auditService.log({ orgId: req.org!.orgId, eventType: 'policy.deleted', actor: req.org!.orgId, actorType: 'system', resource: 'api_key', resourceId: req.params.id, action: 'revoke', outcome: 'success', details: {} });
        res.json({ revoked: true, id: req.params.id });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.post('/orgs/me/api-keys/:id/rotate',
    requireScope('admin'),
    async (req: Request, res: Response) => {
      try {
        const { rows: existing } = await db.pool.query(
          'SELECT id, name, scopes, rate_limit, expires_at FROM api_keys WHERE id = $1 AND org_id = $2 AND enabled = true',
          [req.params.id, req.org!.orgId],
        );
        if (!existing[0]) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API key not found or already revoked' } }); return; }

        await db.pool.query('UPDATE api_keys SET enabled = false WHERE id = $1', [req.params.id]);

        const rawKey = generateApiKey();
        const keyHash = hashApiKey(rawKey);
        const newId = `apikey-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const old = existing[0];

        await db.pool.query(
          `INSERT INTO api_keys (id, org_id, key_hash, key_prefix, name, scopes, rate_limit, enabled, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)`,
          [newId, req.org!.orgId, keyHash, rawKey.slice(0, 10), old.name, old.scopes, old.rate_limit, old.expires_at, new Date()],
        );

        res.json({ rotated: true, old_key_id: req.params.id, new_key: { id: newId, key: rawKey, prefix: rawKey.slice(0, 10), name: old.name } });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  // ── Webhook Secret ─────────────────────────────────────────────────────────

  router.get('/orgs/me/webhook-secret',
    requireScope('admin'),
    async (req: Request, res: Response) => {
      try {
        const secret = await getWebhookSecret(db, req.org!.orgId);
        res.json({ webhook_secret: secret || null });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.post('/orgs/me/webhook-secret/rotate',
    requireScope('admin'),
    async (req: Request, res: Response) => {
      try {
        const newSecret = randomBytes(32).toString('hex');
        await db.pool.query('UPDATE organizations SET webhook_secret = $1, updated_at = $2 WHERE id = $3', [newSecret, new Date(), req.org!.orgId]);
        res.json({ webhook_secret: newSecret });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Policy Templates
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/policy-templates',
    requireScope('policies:read'),
    (req: Request, res: Response) => {
      const category = req.query.category as string | undefined;
      const filtered = category
        ? policyTemplates.filter(t => t.category === category)
        : policyTemplates;
      res.json({
        templates: filtered,
        total: filtered.length,
        categories: [...new Set(policyTemplates.map(t => t.category))],
      });
    },
  );

  router.post('/policy-templates/:id/apply',
    requireScope('policies:write'),
    async (req: Request, res: Response) => {
      try {
        const template = policyTemplates.find(t => t.id === req.params.id);
        if (!template) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }); return; }

        const policyId = `policy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const overrides = req.body || {};
        const policy = {
          id: policyId,
          name: overrides.name || template.name,
          type: template.type as any,
          enabled: overrides.enabled ?? true,
          priority: overrides.priority ?? 50,
          conditions: { ...template.conditions, ...overrides.conditions },
          rules: { ...template.rules, ...overrides.rules },
          transactionTypes: (template.conditions?.transactionType as string[]) || ['agent-to-agent'],
        };

        await db.createPolicy(policy as any, req.org!.orgId);
        res.status(201).json(policy);
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Webhooks Management
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/webhooks/events', requireScope('admin'), (_req: Request, res: Response) => {
    res.json({
      events: [
        'payment.initiated', 'payment.policy_checked', 'payment.completed',
        'payment.failed', 'payment.verification_failed',
        'policy.created', 'policy.updated', 'policy.deleted',
        'treasury.deposit', 'treasury.low_balance',
        'api_key.created', 'api_key.rotated', 'api_key.revoked',
      ],
    });
  });

  router.get('/webhooks/deliveries',
    requireScope('admin'),
    async (req: Request, res: Response) => {
      try {
        const limit = Number(req.query.limit || 50);
        const offset = Number(req.query.offset || 0);
        const { rows } = await db.pool.query(
          `SELECT ae.id, ae.event_type, ae.created_at AS timestamp, ae.details
           FROM audit_entries ae
           WHERE ae.org_id = $1 AND ae.action = 'webhook_delivery'
           ORDER BY ae.created_at DESC LIMIT $2 OFFSET $3`,
          [req.org!.orgId, limit, offset],
        );
        res.json({ deliveries: rows, total: rows.length });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Usage & Metering
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/usage',
    requireScope('payments:read', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const orgId = req.org!.orgId;
        const period = (req.query.period as string) || '30d';
        const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
        const since = new Date(Date.now() - days * 86400000);

        const { rows: totals } = await db.pool.query(
          `SELECT COUNT(*) AS total_payments,
                  COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                  COUNT(*) FILTER (WHERE status = 'failed') AS failed,
                  COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
                  COALESCE(SUM(payment_amount_usdc) FILTER (WHERE status = 'completed'), 0) AS total_usdc
           FROM payment_requests WHERE org_id = $1 AND created_at >= $2`,
          [orgId, since],
        );

        const { rows: daily } = await db.pool.query(
          `SELECT DATE(created_at) AS date, COUNT(*) AS count,
                  COALESCE(SUM(payment_amount_usdc), 0) AS usdc
           FROM payment_requests WHERE org_id = $1 AND created_at >= $2
           GROUP BY DATE(created_at) ORDER BY date`,
          [orgId, since],
        );

        const { rows: byProvider } = await db.pool.query(
          `SELECT provider_id AS provider, COUNT(*) AS count,
                  COALESCE(SUM(payment_amount_usdc), 0) AS usdc
           FROM payment_requests WHERE org_id = $1 AND created_at >= $2
           GROUP BY provider_id`,
          [orgId, since],
        );

        res.json({
          period, since: since.toISOString(),
          summary: totals[0],
          daily: daily.map(r => ({ date: r.date, count: Number(r.count), usdc: Number(r.usdc) })),
          byProvider: byProvider.map(r => ({ provider: r.provider, count: Number(r.count), usdc: Number(r.usdc) })),
        });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Analytics
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/analytics/overview',
    requireScope('audit:read', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const orgId = req.org!.orgId;
        const days = Number(req.query.days || 30);
        const since = new Date(Date.now() - days * 86400000);

        const { rows: volumeByDay } = await db.pool.query(
          `SELECT DATE(created_at) AS date, COUNT(*) AS count,
                  COALESCE(SUM(payment_amount_usdc), 0) AS usdc
           FROM payment_requests WHERE org_id = $1 AND created_at >= $2
           GROUP BY DATE(created_at) ORDER BY date`,
          [orgId, since],
        );

        const { rows: statusBreakdown } = await db.pool.query(
          `SELECT status, COUNT(*) AS count
           FROM payment_requests WHERE org_id = $1 AND created_at >= $2
           GROUP BY status`,
          [orgId, since],
        );

        const { rows: policyRejections } = await db.pool.query(
          `SELECT COALESCE((details::jsonb)->>'reason', event_type) AS reason, COUNT(*) AS count
           FROM audit_entries
           WHERE org_id = $1 AND event_type = 'policy.violated' AND created_at >= $2
           GROUP BY COALESCE((details::jsonb)->>'reason', event_type) ORDER BY count DESC LIMIT 10`,
          [orgId, since],
        );

        res.json({
          period: `${days}d`, since: since.toISOString(),
          volumeByDay: volumeByDay.map(r => ({ date: r.date, count: Number(r.count), usdc: Number(r.usdc) })),
          statusBreakdown: statusBreakdown.map(r => ({ status: r.status, count: Number(r.count) })),
          topPolicyRejections: policyRejections.map(r => ({ reason: r.reason, count: Number(r.count) })),
        });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.get('/analytics/providers',
    requireScope('audit:read', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const orgId = req.org!.orgId;
        const days = Number(req.query.days || 30);
        const since = new Date(Date.now() - days * 86400000);

        const { rows } = await db.pool.query(
          `SELECT provider_id AS provider, status, COUNT(*) AS count,
                  COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - created_at))), 0) AS avg_duration_s,
                  COALESCE(SUM(payment_amount_usdc), 0) AS total_usdc
           FROM payment_requests WHERE org_id = $1 AND created_at >= $2
           GROUP BY provider_id, status ORDER BY provider_id`,
          [orgId, since],
        );

        const providers: Record<string, any> = {};
        for (const r of rows) {
          if (!providers[r.provider]) providers[r.provider] = { provider: r.provider, statuses: {}, totalUsdc: 0, avgDurationS: 0 };
          providers[r.provider].statuses[r.status] = Number(r.count);
          providers[r.provider].totalUsdc += Number(r.total_usdc);
          providers[r.provider].avgDurationS = Number(r.avg_duration_s);
        }

        res.json({ providers: Object.values(providers) });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.get('/analytics/policies',
    requireScope('audit:read', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const orgId = req.org!.orgId;
        const days = Number(req.query.days || 30);
        const since = new Date(Date.now() - days * 86400000);

        const { rows: checks } = await db.pool.query(
          `SELECT outcome, COUNT(*) AS count
           FROM audit_entries
           WHERE org_id = $1 AND event_type IN ('policy.checked', 'policy.violated') AND created_at >= $2
           GROUP BY outcome`,
          [orgId, since],
        );

        const total = checks.reduce((sum, r) => sum + Number(r.count), 0);
        const passed = Number(checks.find(r => r.outcome === 'success')?.count || 0);
        const rejected = Number(checks.find(r => r.outcome === 'failure')?.count || 0);

        res.json({
          period: `${days}d`,
          totalChecks: total,
          passed,
          rejected,
          passRate: total > 0 ? ((passed / total) * 100).toFixed(1) + '%' : 'N/A',
        });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Provider Marketplace
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/marketplace/browse',
    requireScope('providers:read'),
    async (req: Request, res: Response) => {
      try {
        const q = String(req.query.q || '').trim().toLowerCase();
        const category = String(req.query.category || '').trim().toLowerCase();
        const limit = Math.max(1, Math.min(100, Number(req.query.limit || 30)));
        const offset = Math.max(0, Number(req.query.offset || 0));
        const sourceRaw = String(req.query.source || req.query.sources || '').trim();
        const sourceAllow = new Set(
          sourceRaw
            .split(/[\s,]+/)
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        );
        const minTrustRaw = req.query.minTrust;
        const minTrust =
          minTrustRaw !== undefined && minTrustRaw !== null && String(minTrustRaw).trim() !== ''
            ? Number(minTrustRaw)
            : NaN;
        const hasPrice =
          String(req.query.hasPrice || '').trim() === '1' ||
          String(req.query.hasPrice || '').toLowerCase() === 'true';

        const [directRows, scoutRows, orthogonalRows] = await Promise.all([
          fetchX402DirectCatalog(),
          fetchX402ScoutCatalog(),
          fetchOrthogonalCatalog(),
        ]);

        const merged = dedupeMarketplaceEntries([...directRows, ...scoutRows, ...orthogonalRows]);
        let pool = merged;
        if (sourceAllow.size > 0) {
          pool = merged.filter((item) => sourceAllow.has(String(item.source || '').toLowerCase()));
        }
        const queryTokens = q.split(/\s+/).map((t) => t.trim()).filter(Boolean);
        const ranked = pool
          .map((item) => {
            const haystack = `${item.name} ${item.description} ${item.category} ${item.url}`.toLowerCase();
            const tokenHits = queryTokens.length
              ? queryTokens.filter((token) => haystack.includes(token)).length
              : 0;
            const phraseHit = q ? haystack.includes(q) : false;
            return { item, tokenHits, phraseHit };
          })
          .filter(({ item, tokenHits, phraseHit }) => {
            if (q && tokenHits === 0 && !phraseHit) return false;
            if (category && item.category.toLowerCase() !== category) return false;
            if (hasPrice && item.priceUsd == null) return false;
            if (Number.isFinite(minTrust)) {
              if (item.trustScore == null || item.trustScore < minTrust) return false;
            }
            return true;
          })
          .sort((a, b) => {
            if (a.phraseHit !== b.phraseHit) return a.phraseHit ? -1 : 1;
            return b.tokenHits - a.tokenHits;
          });

        const filtered = ranked.map((r) => r.item);
        const paged = filtered.slice(offset, offset + limit);
        res.json({
          services: paged,
          total: filtered.length,
          limit,
          offset,
          sources: {
            x402direct: directRows.length,
            x402scout: scoutRows.length,
            orthogonal: orthogonalRows.length,
          },
        });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.get('/marketplace/probe',
    requireScope('providers:read'),
    async (req: Request, res: Response) => {
      try {
        const targetUrl = String(req.query.url || '').trim();
        const preferredMethod = String(req.query.method || '').trim().toUpperCase();
        if (!targetUrl) {
          res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'url is required' } });
          return;
        }
        const probe = await probeX402Endpoint(targetUrl, preferredMethod || undefined);
        res.json(probe);
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.post('/marketplace/register',
    requireScope('admin'),
    async (req: Request, res: Response) => {
      try {
        const originalUrl = String(req.body?.url || '').trim();
        let targetUrl = originalUrl;
        const name = String(req.body?.name || '').trim();
        const category = String(req.body?.category || '').trim();
        const preferredMethod = String(req.body?.method || '').trim().toUpperCase();
        const requireStrict = req.body?.requireStrict !== false && req.body?.require_strict !== false;

        if (!targetUrl) {
          res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'url is required' } });
          return;
        }

        let probe = await probeX402Endpoint(targetUrl, preferredMethod || undefined);
        let resolvedFromDiscovery: string | null = null;
        if (!probe.x402Compatible) {
          const discovered = await resolveDiscoveryResourceForUrl(targetUrl);
          if (discovered && discovered !== targetUrl) {
            const probe2 = await probeX402Endpoint(discovered, preferredMethod || undefined);
            if (probe2.x402Compatible) {
              targetUrl = discovered;
              probe = probe2;
              resolvedFromDiscovery = discovered;
            }
          }
        }
        if (!probe.x402Compatible) {
          const probeTimedOut = probe?.status === 0 && probe?.errorType === 'timeout';
          res.status(400).json({
            error: {
              code: probeTimedOut ? 'PROBE_TIMEOUT' : 'VALIDATION_ERROR',
              message: probeTimedOut
                ? 'Endpoint probe timed out before x402 handshake'
                : 'Endpoint is not x402 compatible',
            },
            probe,
            ...(resolvedFromDiscovery ? { resolvedFromDiscovery } : {}),
          });
          return;
        }

        const trust = await evaluateProviderTrust(targetUrl, probe.method || preferredMethod || 'GET', probe.sampleBody, probe);
        if (requireStrict && !trust.passed) {
          res.status(400).json({
            error: { code: 'TRUST_GATE_FAILED', message: `Provider failed strict trust gate: ${trust.reason || trust.stage}` },
            probe,
            trust,
          });
          return;
        }

        const providerId = buildProviderId(name || targetUrl);
        const providerName = name || new URL(targetUrl).hostname;
        const networks = probe.rawAccepts.map((a: any) => String(a.network || '')).filter(Boolean);
        const action = 'request';
        const pricing = { [action]: probe.priceUsdc || 0.001 };

        const metadata = {
          x402Native: true,
          category: category || 'utility',
          description: req.body?.description || `Auto-registered from marketplace: ${targetUrl}`,
          endpoints: { [action]: targetUrl },
          method: probe.method || preferredMethod || 'GET',
          sampleRequestBody: probe.sampleBody || undefined,
          discoverySource: req.body?.source || 'marketplace',
          sourceUrl: originalUrl,
          resolvedFromDiscovery: resolvedFromDiscovery || undefined,
          probeSnapshot: probe,
          trustGate: trust,
          trustMode: requireStrict ? 'strict' : 'best-effort',
          registeredAt: new Date().toISOString(),
        };

        const now = new Date();
        await db.pool.query(
          `INSERT INTO providers (id, name, type, endpoint, actions, pricing, enabled, wallet_address, supported_networks, metadata, created_at, updated_at)
           VALUES ($1, $2, 'x402', $3, $4, $5, $6, $7, $8, $9, $10, $10)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             type = EXCLUDED.type,
             endpoint = EXCLUDED.endpoint,
             actions = EXCLUDED.actions,
             pricing = EXCLUDED.pricing,
             enabled = EXCLUDED.enabled,
             wallet_address = EXCLUDED.wallet_address,
             supported_networks = EXCLUDED.supported_networks,
             metadata = EXCLUDED.metadata,
             updated_at = EXCLUDED.updated_at`,
          [
            providerId,
            providerName,
            targetUrl,
            JSON.stringify([action]),
            JSON.stringify(pricing),
            trust.passed,
            probe.payTo,
            JSON.stringify(networks),
            JSON.stringify(metadata),
            now,
          ],
        );

        const provider = await providerRegistry.getProvider(providerId);
        res.status(201).json({ provider, probe, trust, resolvedFromDiscovery, sourceUrl: originalUrl });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.post('/providers/register',
    requireScope('admin'),
    async (req: Request, res: Response) => {
      try {
        const {
          id,
          name,
          type,
          endpoint,
          actions,
          base_cost_usdc,
          config,
          pricing,
          wallet_address,
          supported_networks,
          metadata,
        } = req.body;
        if (!id || !name || !type) {
          res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'id, name, and type are required' } });
          return;
        }

        const now = new Date();
        const finalPricing = JSON.stringify(
          pricing && typeof pricing === 'object'
            ? pricing
            : { base_cost_usdc: base_cost_usdc || 0.01 },
        );
        const finalMetadata = JSON.stringify(metadata || config || {});
        const finalSupportedNetworks = JSON.stringify(Array.isArray(supported_networks) ? supported_networks : []);
        const finalWalletAddress = wallet_address || '';
        await db.pool.query(
          `INSERT INTO providers (id, name, type, endpoint, actions, pricing, enabled, wallet_address, supported_networks, metadata, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10, $10)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             type = EXCLUDED.type,
             endpoint = EXCLUDED.endpoint,
             actions = EXCLUDED.actions,
             pricing = EXCLUDED.pricing,
             enabled = true,
             wallet_address = EXCLUDED.wallet_address,
             supported_networks = EXCLUDED.supported_networks,
             metadata = EXCLUDED.metadata,
             updated_at = EXCLUDED.updated_at`,
          [id, name, type, endpoint || '', JSON.stringify(actions || ['scrape']), finalPricing, finalWalletAddress, finalSupportedNetworks, finalMetadata, now],
        );

        const provider = await providerRegistry.getProvider(id);
        res.status(201).json(provider ?? { id, name, type, endpoint, actions, enabled: true });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  router.get('/providers/health',
    requireScope('providers:read'),
    async (req: Request, res: Response) => {
      try {
        const providers = await providerRegistry.listProviders();
        const health: Record<string, any> = {};
        for (const p of providers) {
          health[p.id] = { id: p.id, name: p.name, enabled: p.enabled, status: p.enabled ? 'healthy' : 'disabled' };
        }
        res.json({ providers: health });
      } catch (err: any) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Health & OpenAPI
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', version: 'v1', timestamp: new Date().toISOString() });
  });

  router.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(openapiSpec);
  });

  return router;
}

async function getWebhookSecret(db: DB, orgId: string): Promise<string | null> {
  const { rows } = await db.pool.query('SELECT webhook_secret FROM organizations WHERE id = $1', [orgId]);
  return rows[0]?.webhook_secret || null;
}

type MarketplaceService = {
  url: string;
  registerUrl?: string;
  name: string;
  description: string;
  category: string;
  network: string;
  price: string;
  priceUsd: number | null;
  trustScore: number | null;
  source: 'x402.direct' | 'x402scout' | 'orthogonal';
};

async function fetchX402DirectCatalog(): Promise<MarketplaceService[]> {
  try {
    const resp = await fetch('https://x402.direct/api/services', { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return [];
    const body: any = await resp.json();
    const services = extractServiceRows(body);
    return services.map((s: any) => ({
      url: String(s.url || s.website || s.homepage || s.endpoint || s.resourceUrl || ''),
      registerUrl: String(s.endpoint || s.resourceUrl || s.url || ''),
      name: String(s.name || s.title || s.provider || safeHostname(s.url || s.endpoint || s.resourceUrl) || 'Unnamed service'),
      description: String(s.description || ''),
      category: String(s.category || 'utility'),
      network: String(s.network || s.chain || s.networkId || ''),
      price: String(s.price || s.priceLabel || s.amount || ''),
      priceUsd: numberOrNull(normalizePriceUsd(s.priceUsd || s.price_usd)),
      trustScore: numberOrNull(s.trustScore || s.trust_score || s.scoutScore),
      source: 'x402.direct' as const,
    })).filter((s: MarketplaceService) => Boolean(s.url));
  } catch {
    return [];
  }
}

async function fetchX402ScoutCatalog(): Promise<MarketplaceService[]> {
  try {
    const resp = await fetch('https://www.x402scout.com/catalog', { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return [];
    const body: any = await resp.json();
    const services = extractServiceRows(body);
    return services.map((s: any) => ({
      url: String(s.url || s.website || s.homepage || s.endpoint || s.resourceUrl || ''),
      registerUrl: String(s.endpoint || s.resourceUrl || s.url || ''),
      name: String(s.name || s.title || s.provider || safeHostname(s.url || s.endpoint || s.resourceUrl) || 'Unnamed service'),
      description: String(s.description || ''),
      category: String(s.category || 'utility'),
      network: String(s.network || s.chain || s.networkId || ''),
      price: String(s.price || s.priceLabel || s.amount || ''),
      priceUsd: numberOrNull(normalizePriceUsd(s.priceUsd || s.price_usd)),
      trustScore: numberOrNull(s.trustScore || s.trust_score || s.scoutScore),
      source: 'x402scout' as const,
    })).filter((s: MarketplaceService) => Boolean(s.url));
  } catch {
    return [];
  }
}

async function fetchOrthogonalCatalog(): Promise<MarketplaceService[]> {
  try {
    const apiKey = String(process.env.ORTHOGONAL_API_KEY || '').trim();
    if (!apiKey) return [];
    const resp = await fetch('https://api.orthogonal.com/v1/list-endpoints', {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return [];
    const body: any = await resp.json().catch(() => ({}));
    const endpoints = extractOrthogonalEndpoints(body);
    return endpoints
      .map((e: any) => normalizeOrthogonalEndpoint(e))
      .filter((s: MarketplaceService | null): s is MarketplaceService => Boolean(s));
  } catch {
    return [];
  }
}

function extractOrthogonalEndpoints(body: any): any[] {
  if (Array.isArray(body?.endpoints)) return body.endpoints;
  if (Array.isArray(body?.data?.endpoints)) return body.data.endpoints;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.results)) {
    return body.results.flatMap((api: any) =>
      Array.isArray(api?.endpoints)
        ? api.endpoints.map((ep: any) => ({ ...ep, api, slug: api?.slug, apiName: api?.name }))
        : [],
    );
  }
  if (Array.isArray(body?.apis)) {
    return body.apis.flatMap((api: any) =>
      Array.isArray(api?.endpoints)
        ? api.endpoints.map((ep: any) => ({ ...ep, api, slug: api?.slug, apiName: api?.name }))
        : [],
    );
  }
  return [];
}

function normalizeOrthogonalEndpoint(endpoint: any): MarketplaceService | null {
  const apiSlug = String(endpoint?.slug || endpoint?.api?.slug || endpoint?.apiSlug || endpoint?.api || '').trim();
  const path = String(endpoint?.path || endpoint?.endpoint || '').trim();
  if (!apiSlug || !path) return null;

  const priceUsd = numberOrNull(normalizePriceUsd(endpoint?.price || endpoint?.priceUsd || endpoint?.price_usd));
  const explicitPayableUrl = String(endpoint?.payableUrl || endpoint?.payable_url || '').trim();
  const payableBaseUrl = String(endpoint?.api?.payableBaseUrl || endpoint?.payableBaseUrl || '').trim();
  const pathNormalized = path.startsWith('/') ? path : `/${path}`;
  const fallbackUrl = payableBaseUrl
    ? `${payableBaseUrl}${pathNormalized}`
    : `https://x402.orth.sh/${apiSlug}${pathNormalized}`;
  const url = explicitPayableUrl || fallbackUrl;
  if (!url) return null;
  return {
    url,
    registerUrl: url,
    name: String(endpoint?.apiName || endpoint?.name || endpoint?.api?.name || apiSlug || 'Orthogonal API'),
    description: String(endpoint?.description || `Orthogonal endpoint ${apiSlug}${path}`),
    category: String(endpoint?.category || 'utility'),
    network: 'base',
    price: priceUsd != null ? `$${priceUsd}` : '',
    priceUsd,
    trustScore: null,
    source: 'orthogonal',
  };
}

function extractServiceRows(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.services)) return body.services;
  if (Array.isArray(body?.endpoints)) return body.endpoints;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

function dedupeMarketplaceEntries(entries: MarketplaceService[]): MarketplaceService[] {
  const byUrl = new Map<string, MarketplaceService>();
  for (const entry of entries) {
    const key = String(entry.registerUrl || entry.url).trim().toLowerCase();
    if (!key) continue;
    if (!byUrl.has(key)) byUrl.set(key, entry);
  }
  return [...byUrl.values()];
}

async function probeX402Endpoint(url: string, preferredMethod?: string): Promise<any> {
  const methods = preferredMethod
    ? [preferredMethod]
    : ['GET', 'POST'];

  const probeBase = {
    url,
    x402Compatible: false,
    priceAtomic: null as string | null,
    priceUsdc: null as number | null,
    payTo: null as string | null,
    network: null as string | null,
    asset: null as string | null,
    extra: null as any,
    rawAccepts: [] as any[],
    method: null as string | null,
    sampleBody: null as any,
    errorType: null as string | null,
  };

  let lastStatus = 0;
  let lastError: string | null = null;
  for (const method of methods) {
    const candidateBodies: any[] = method === 'POST'
      ? [{}, { query: 'hello' }, { url: 'https://example.com' }, { prompt: 'hello' }]
      : [null];

    for (const sampleBody of candidateBodies) {
      try {
        const resp = await fetch(url, {
          method,
          headers: method === 'POST' ? { 'Content-Type': 'application/json', 'User-Agent': 'gordon-marketplace-probe/1.0' } : { 'User-Agent': 'gordon-marketplace-probe/1.0' },
          body: method === 'POST' ? JSON.stringify(sampleBody) : undefined,
          signal: AbortSignal.timeout(10_000),
        });
        lastStatus = resp.status;

        if (resp.status !== 402) continue;

        const body: any = await resp.json().catch(() => ({}));
        const accepts = Array.isArray(body?.accepts) ? body.accepts : [];
        const first = accepts[0] || {};
        const atomic = first.maxAmountRequired || first.amount || null;
        return {
          ...probeBase,
          status: 402,
          x402Compatible: accepts.length > 0,
          priceAtomic: atomic,
          priceUsdc: atomic ? Number(atomic) / 1_000_000 : null,
          payTo: first.payTo || null,
          network: first.network || null,
          asset: first.asset || null,
          extra: first.extra || null,
          rawAccepts: accepts,
          method,
          sampleBody: method === 'POST' ? sampleBody : null,
        };
      } catch (err: any) {
        const msg = String(err?.message || 'probe_failed');
        lastError = msg;
        const timeoutLike = msg.toLowerCase().includes('abort') || msg.toLowerCase().includes('timeout');
        (probeBase as any).errorType = timeoutLike ? 'timeout' : 'network_error';
      }
    }
  }

  return { ...probeBase, status: lastStatus || 0, error: lastError };
}

async function evaluateProviderTrust(url: string, method: string, sampleBody: any, probe: any): Promise<any> {
  const fail = (stage: string, reason: string, extra: Record<string, unknown> = {}) => ({
    passed: false,
    stage,
    reason,
    ...extra,
  });

  if (!probe?.x402Compatible) return fail('probe', 'not_x402_compatible');
  const allAccepts: any[] = probe?.rawAccepts || [];
  if (!allAccepts.length) return fail('probe', 'missing_accepts');

  // Prefer non-CDP accepts first (direct on-chain, easier to test without CDP account)
  // then fall back to CDP-facilitated
  const sortedAccepts = [...allAccepts].sort((a, b) => {
    const aCdp = String(a.extra?.facilitator || '').includes('cdp.coinbase.com') ? 1 : 0;
    const bCdp = String(b.extra?.facilitator || '').includes('cdp.coinbase.com') ? 1 : 0;
    return aCdp - bCdp;
  });

  const maxAtomic = Number(process.env.MARKETPLACE_TRUST_MAX_ATOMIC || '100000');

  const { normalizeHexPrivateKey, CHAIN_REGISTRY, toCaip2, isSolanaNetwork, isEvmNetwork } = require('@agentic-commerce/shared');
  const evmPk = normalizeHexPrivateKey(process.env.DEMO_BUYER_PRIVATE_KEY || process.env.FIRECRAWL_AGENT_PRIVATE_KEY);

  // Parse platform Solana payer key (base58 or JSON array)
  let solanaPayer: any = null;
  const solanaPayerRaw = process.env.SOLANA_PAYER_SECRET_KEY;
  if (solanaPayerRaw) {
    try {
      const { Keypair } = require('@solana/web3.js');
      if (solanaPayerRaw.startsWith('[')) {
        solanaPayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(solanaPayerRaw)));
      } else {
        // base58 encoded secret key
        const bs58: any = require('bs58');
        const decode = bs58.default?.decode ?? bs58.decode;
        solanaPayer = Keypair.fromSecretKey(decode(solanaPayerRaw));
      }
    } catch {
      // Solana payer not available — Solana accepts will be skipped
    }
  }

  if (!evmPk && !solanaPayer) return fail('wallet', 'missing_payer_key');

  // Try each accepted payment method until one succeeds
  let lastAttempt: Record<string, unknown> = {};
  for (const accept of sortedAccepts) {
    const priceAtomic = Number(accept.maxAmountRequired || accept.amount || 0);
    if (!Number.isFinite(priceAtomic) || priceAtomic <= 0) continue;
    if (priceAtomic > maxAtomic) continue;

    const caip2 = toCaip2(accept.network || 'base');
    const chainCfg = CHAIN_REGISTRY[caip2];

    const isSolana = isSolanaNetwork(caip2);
    const isEvm = isEvmNetwork(caip2);

    if (!chainCfg || (!isEvm && !isSolana)) {
      lastAttempt = { reason: `unsupported_network:${caip2}`, network: caip2 };
      continue;
    }
    if (isEvm && !evmPk) {
      lastAttempt = { reason: 'missing_evm_payer_key', network: caip2 };
      continue;
    }
    if (isSolana && !solanaPayer) {
      lastAttempt = { reason: 'missing_solana_payer_key', network: caip2 };
      continue;
    }

    const isCdpFacilitated = String(accept.extra?.facilitator || '').includes('cdp.coinbase.com');
    lastAttempt = { network: caip2, priceAtomic, priceUsdc: priceAtomic / 1_000_000, isCdpFacilitated, isSolana };

    let paymentHeader = '';

    if (isSolana) {
      // ── Solana payment header ──────────────────────────────────────────────
      // Build a signed SPL USDC transfer transaction as the payment header.
      try {
        const { Connection, PublicKey, Transaction } = require('@solana/web3.js');
        const { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

        const rpcUrl = process.env.SOLANA_RPC_MAINNET || chainCfg.rpcUrl;
        const conn = new Connection(rpcUrl, 'confirmed');

        const payerPubkey = solanaPayer.publicKey;
        const recipientPubkey = new PublicKey(String(accept.payTo || '').trim());
        const mintPubkey = new PublicKey(chainCfg.usdcMint || chainCfg.usdcAddress);

        const [fromAta, toAta] = await Promise.all([
          getAssociatedTokenAddress(mintPubkey, payerPubkey),
          getAssociatedTokenAddress(mintPubkey, recipientPubkey),
        ]);

        const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
        const tx = new Transaction({ recentBlockhash: blockhash, feePayer: payerPubkey });
        tx.add(createTransferInstruction(fromAta, toAta, payerPubkey, BigInt(priceAtomic), [], TOKEN_PROGRAM_ID));
        tx.sign(solanaPayer);

        paymentHeader = Buffer.from(tx.serialize()).toString('base64');
        lastAttempt = { ...lastAttempt, solanaBlockhash: blockhash, lastValidBlockHeight };
      } catch (err: any) {
        lastAttempt = { ...lastAttempt, reason: `solana_payment_header_failed:${err.message}` };
        continue;
      }
    } else {
      // ── EVM payment header (x402/client) ──────────────────────────────────
    const viem: any = require('viem');
    const viemAccounts: any = require('viem/accounts');
    const viemChains: any = require('viem/chains');
    const chainMap: Record<number, any> = { 8453: viemChains.base, 84532: viemChains.baseSepolia, 137: viemChains.polygon, 42161: viemChains.arbitrum };
    const walletClient = viem.createWalletClient({
      account: viemAccounts.privateKeyToAccount(evmPk),
      chain: chainMap[chainCfg.chainId] || viemChains.base,
      transport: viem.http(chainCfg.rpcUrl),
    });

    const x402Client: { createPaymentHeader: (w: any, v: number, r: any) => Promise<string> } = require('x402/client');
    const x402Types: { PaymentRequirementsSchema: { parse: (x: unknown) => any } } = require('x402/types');
    const networkToX402: Record<string, string> = {
      'eip155:8453': 'base',
      'eip155:84532': 'base-sepolia',
      'eip155:137': 'polygon',
      'eip155:42161': 'arbitrum',
    };
    const normalizedReq = {
      ...accept,
      scheme: 'exact',
      network: networkToX402[caip2] || accept.network || 'base',
      payTo: String(accept.payTo || '').trim(),
      maxAmountRequired: String(accept.maxAmountRequired || accept.amount || ''),
      resource: typeof accept.resource === 'string' ? accept.resource : url,
      description: accept.description || 'x402-protected resource',
      mimeType: accept.mimeType || 'application/json',
    };

    try {
      const parsed = x402Types.PaymentRequirementsSchema.parse(normalizedReq);
      paymentHeader = await x402Client.createPaymentHeader(walletClient, Number(probe?.x402Version || 1), parsed);
    } catch (err: any) {
      lastAttempt = { ...lastAttempt, reason: `create_payment_header_failed:${err.message}` };
      continue;
    }
    }

    const isPost = String(method || 'GET').toUpperCase() === 'POST';
    const outputSchema = accept?.outputSchema?.input || {};
    const schemaQueryParams = outputSchema?.queryParams || {};

    let paidUrl = url;
    if (!isPost) {
      const query = new URLSearchParams();
      for (const [key, field] of Object.entries(schemaQueryParams as Record<string, any>)) {
        if (field?.required) {
          if (key === 'url') query.set(key, 'https://example.com');
          else if (key === 'query') query.set(key, 'example');
          else query.set(key, 'test');
        }
      }
      const qs = query.toString();
      if (qs) paidUrl += (paidUrl.includes('?') ? '&' : '?') + qs;
    }

    let postBody: Record<string, any> = (sampleBody && typeof sampleBody === 'object') ? { ...sampleBody } : {};
    if (isPost) {
      const bodySchema = outputSchema?.body || {};
      const requiredBodyFields: string[] = Array.isArray(bodySchema?.required) ? bodySchema.required : [];
      for (const field of requiredBodyFields) {
        if (postBody[field] != null) continue;
        if (field === 'url') postBody[field] = 'https://example.com';
        else if (field === 'query') postBody[field] = 'example';
        else if (field.toLowerCase().includes('markdown') || field.toLowerCase().includes('html')) postBody[field] = false;
        else postBody[field] = 'test';
      }
    }

    const body = isPost ? JSON.stringify(postBody) : undefined;
    let fetchResp: Awaited<ReturnType<typeof fetch>>;
    try {
      fetchResp = await fetch(paidUrl, {
        method: isPost ? 'POST' : 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'gordon-trust-gate/1.0',
          'X-PAYMENT': paymentHeader,
          'PAYMENT-SIGNATURE': paymentHeader,
          ...(isPost ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err: any) {
      lastAttempt = { ...lastAttempt, reason: `fetch_failed:${err.message}` };
      continue;
    }

    const paidText = await fetchResp.text();
    const receipt = fetchResp.headers.get('payment-response') || fetchResp.headers.get('x-payment-response');
    const hasContent = paidText.trim().length > 20 && !/^\s*\{?\s*"error"/i.test(paidText.trim());

    // Detect likely insufficient-funds pattern: still 402 after a valid payment header
    const likelyInsufficientFunds = fetchResp.status === 402 &&
      /insufficient|balance|funds|allowance/i.test(paidText);

    const passed = fetchResp.status === 200 && Boolean(receipt) && hasContent;
    if (passed) {
      return {
        passed: true,
        stage: 'strict_pass',
        network: caip2,
        isCdpFacilitated,
        unpaidStatus: probe.status || 402,
        paidStatus: fetchResp.status,
        hasPaymentResponseHeader: Boolean(receipt),
        contentLength: paidText.length,
        priceAtomic,
        priceUsdc: priceAtomic / 1_000_000,
      };
    }

    lastAttempt = {
      ...lastAttempt,
      network: caip2,
      isCdpFacilitated,
      unpaidStatus: probe.status || 402,
      paidStatus: fetchResp.status,
      hasPaymentResponseHeader: Boolean(receipt),
      contentLength: paidText.length,
      reason: likelyInsufficientFunds
        ? 'insufficient_funds'
        : isCdpFacilitated
          ? `cdp_payment_rejected:${fetchResp.status}`
          : `paid_status_${fetchResp.status}`,
    };
  }

  // All payment options exhausted
  return {
    passed: false,
    stage: 'paid_retry',
    attemptsExhausted: sortedAccepts.length,
    ...lastAttempt,
  };
}

function numberOrNull(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizePriceUsd(value: any): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function buildProviderId(input: string): string {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const digest = createHash('sha256').update(input).digest('hex').slice(0, 6);
  return `${normalized.slice(0, 32) || 'provider'}-${digest}`;
}

function safeHostname(urlLike: any): string {
  try {
    if (!urlLike) return '';
    return new URL(String(urlLike)).hostname;
  } catch {
    return '';
  }
}

async function resolveDiscoveryResourceForUrl(inputUrl: string): Promise<string | null> {
  let host = '';
  try {
    host = new URL(inputUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;

  const discoveryUrl = process.env.X402_DISCOVERY_URL || 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
  const base = host.replace(/^www\./, '');
  const apiHost = base.startsWith('api.') ? base : `api.${base}`;

  try {
    const res = await fetch(`${discoveryUrl}?limit=300&offset=0`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body: any = await res.json().catch(() => ({}));
    const items: any[] = Array.isArray(body?.items) ? body.items : Array.isArray(body?.resources) ? body.resources : [];
    const candidates = items
      .map((it) => String(it?.resource || ''))
      .filter(Boolean)
      .filter((u) => {
        try {
          const h = new URL(u).hostname.toLowerCase();
          return h === base || h === apiHost || h.endsWith(`.${base}`) || h.endsWith(`.${apiHost}`);
        } catch {
          return false;
        }
      });
    return candidates[0] || null;
  } catch {
    return null;
  }
}
