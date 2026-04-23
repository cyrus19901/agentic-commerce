# API Reference

Base URL: `http://localhost:3001/api/v1`

All endpoints require an `X-API-Key` header unless otherwise noted.

## Authentication

```bash
curl -H 'X-API-Key: ak_live_YOUR_KEY_HERE' http://localhost:3001/api/v1/health
```

Sandbox mode is activated automatically with `ak_test_` prefixed keys, or by passing `"sandbox": true` in the payment execute body.

---

## Payments

### POST /payments/execute

Execute a payment through the platform. Runs policy checks, holds treasury funds, dispatches to the provider agent, verifies the on-chain transaction, and settles.

**Scope:** `payments:write`

**Request:**

```json
{
  "provider": "zyte",
  "action": "scrape",
  "params": { "url": "https://example.com" },
  "max_payment_usdc": 0.10,
  "callback_url": "https://your-server.com/webhook",
  "sandbox": false
}
```

**Response (200):**

```json
{
  "paymentId": "pay_1776322533815_mx7sncw",
  "status": "completed",
  "correlationId": "cor_abc123...",
  "provider": "zyte",
  "action": "scrape",
  "baseTxHash": "0x7f960c...",
  "paymentAmountUsdc": 0.01,
  "agentWallet": "0x067d...",
  "data": { "content": "..." }
}
```

**Error (403 - Policy Rejected):**

```json
{
  "paymentId": "pay_...",
  "status": "rejected",
  "error": "Monthly Budget Limit exceeded"
}
```

### GET /payments

List payments for the authenticated organization.

**Scope:** `payments:read`

**Query params:** `limit` (int, max 200), `offset` (int), `status` (string)

### GET /payments/:id

Get a single payment by ID.

**Scope:** `payments:read`

### GET /payments/:id/trace

Get the full audit trace for a payment (all correlated events).

**Scope:** `payments:read` or `audit:read`

### GET /payments/:id/verify

Re-verify the on-chain Base transaction for a completed payment.

**Scope:** `payments:read`

**Response:**

```json
{
  "paymentId": "pay_...",
  "baseTxHash": "0x...",
  "verified": true,
  "blockNumber": 44766597,
  "gasUsed": "37435",
  "transferAmount": "0.010000",
  "transferTo": "0x067d..."
}
```

---

## Policies

### GET /policies

List all policies for the organization (falls back to global if none defined).

**Scope:** `policies:read`

### POST /policies

Create a new policy.

**Scope:** `policies:write`

**Request:**

```json
{
  "name": "Max $50 per transaction",
  "type": "transaction",
  "enabled": true,
  "priority": 100,
  "conditions": { "transactionType": ["agent-to-agent"] },
  "rules": { "maxAmount": 50 }
}
```

**Policy types:** `budget`, `transaction`, `merchant`, `category`, `time`, `agent`, `purpose`, `composite`

### PUT /policies/:id

Update an existing policy (partial update).

**Scope:** `policies:write`

### DELETE /policies/:id

Delete a policy.

**Scope:** `policies:write`

### POST /policies/check

Dry-run a policy check without executing a payment.

**Scope:** `policies:read`

---

## Audit

### GET /audit

Query audit entries with filters.

**Scope:** `audit:read`

**Query params:** `event_type`, `actor`, `resource`, `outcome`, `since` (ISO datetime), `until`, `limit`, `offset`, `correlation_id`

### GET /audit/stats

Aggregated audit statistics for the organization.

**Scope:** `audit:read`

### GET /audit/:id

Get a single audit entry.

**Scope:** `audit:read`

---

## Treasury

### GET /treasury

Get the organization's treasury balance summary.

**Scope:** `treasury:read`

### GET /treasury/ledger

Paginated ledger of all treasury movements (deposits, holds, releases, debits).

**Scope:** `treasury:read`

**Query params:** `limit`, `offset`, `entry_type`

### POST /treasury/deposit

Record a manual deposit into the organization's treasury.

**Scope:** `admin`

**Request:**

```json
{
  "amount": 100.00,
  "reference": "wire-transfer-001",
  "tx_hash": "0x..."
}
```

### GET /treasury/reconcile

Compare off-chain treasury balance against on-chain payment records.

**Scope:** `admin`

---

## Providers

### GET /providers

List available X402 service providers.

**Scope:** `providers:read`

### GET /providers/:id

Get details for a specific provider.

**Scope:** `providers:read`

---

## Organization

### POST /orgs

Create a new organization. Returns the org, a default API key, and a webhook secret.

**Scope:** `admin`

**Request:**

```json
{ "name": "My Company", "slug": "my-company" }
```

### GET /orgs/me

Get details of the current organization.

### PUT /orgs/me

Update organization settings.

**Scope:** `admin`

### POST /orgs/me/api-keys

Create a new API key.

**Scope:** `admin`

**Request:**

```json
{
  "name": "Production Key",
  "scopes": ["payments:write", "payments:read", "audit:read"],
  "expires_at": "2027-01-01T00:00:00Z"
}
```

### GET /orgs/me/api-keys

List all API keys (prefix only, raw key is never returned after creation).

**Scope:** `admin`

### DELETE /orgs/me/api-keys/:id

Revoke (disable) an API key.

**Scope:** `admin`

### POST /orgs/me/api-keys/:id/rotate

Rotate an API key: disables the old one and creates a new key with the same scopes.

**Scope:** `admin`

### GET /orgs/me/webhook-secret

Retrieve the organization's webhook signing secret.

**Scope:** `admin`

### POST /orgs/me/webhook-secret/rotate

Regenerate the webhook secret.

**Scope:** `admin`

---

## Health

### GET /health

Liveness check. Returns `{ "status": "ok", "version": "v1" }`.

No authentication required.

---

## Error Format

All errors follow this structure:

```json
{
  "error": {
    "code": "POLICY_REJECTED",
    "message": "Payment blocked by policy: Monthly Budget Limit",
    "details": {},
    "request_id": "req_abc123"
  }
}
```

**Error codes:** `VALIDATION_ERROR`, `AUTHENTICATION_REQUIRED`, `INVALID_API_KEY`, `API_KEY_DISABLED`, `API_KEY_EXPIRED`, `ORG_INACTIVE`, `INSUFFICIENT_SCOPE`, `POLICY_REJECTED`, `INSUFFICIENT_FUNDS`, `PROVIDER_ERROR`, `TX_VERIFICATION_FAILED`, `NOT_FOUND`, `RATE_LIMIT_EXCEEDED`, `INTERNAL_ERROR`

---

## Webhooks

When a `callback_url` is provided on payment execute, the platform sends a POST with:

- `X-Signature-256: sha256=<hmac>` — HMAC-SHA256 of the body using your org's webhook secret
- `X-Webhook-Timestamp` — Unix timestamp
- Body: the full payment result JSON

Verify: `HMAC-SHA256(webhook_secret, raw_body) === signature`
