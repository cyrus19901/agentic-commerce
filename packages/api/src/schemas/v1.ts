import { z } from 'zod';

export const PaymentExecuteBody = z.object({
  provider: z.string().min(1).max(50),
  action: z.string().min(1).max(50),
  params: z.record(z.unknown()).default({}),
  max_payment_usdc: z.number().positive().max(1000).optional(),
  callback_url: z.string().url().optional(),
  sandbox: z.boolean().optional(),
});

export const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  status: z.string().optional(),
});

export const PolicyCreateBody = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['budget', 'transaction', 'merchant', 'category', 'time', 'agent', 'purpose', 'composite']),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(50),
  conditions: z.record(z.unknown()).default({}),
  rules: z.record(z.unknown()).default({}),
});

export const PolicyUpdateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(['budget', 'transaction', 'merchant', 'category', 'time', 'agent', 'purpose', 'composite']).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  conditions: z.record(z.unknown()).optional(),
  rules: z.record(z.unknown()).optional(),
});

export const PolicyCheckBody = z.object({
  price: z.number().min(0).default(0),
  merchant: z.string().default('unknown'),
  category: z.string().optional(),
  transactionType: z.string().default('agent-to-agent'),
  serviceType: z.string().optional(),
  recipientAgent: z.string().optional(),
  trustScore: z.number().optional(),
});

export const AuditQuery = z.object({
  event_type: z.string().optional(),
  actor: z.string().optional(),
  resource: z.string().optional(),
  outcome: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  correlation_id: z.string().optional(),
});

export const IdParam = z.object({
  id: z.string().min(1),
});

export const OrgCreateBody = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
});

export const OrgUpdateBody = z.object({
  name: z.string().min(1).max(200).optional(),
});

export const ApiKeyCreateBody = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).min(1).default(['*']),
  expires_at: z.string().datetime().optional(),
});

export const TreasuryDepositBody = z.object({
  amount: z.number().positive().max(1_000_000),
  reference: z.string().min(1).max(200),
  tx_hash: z.string().optional(),
});

export const TreasuryLedgerQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  entry_type: z.string().optional(),
});
