# Agentic Commerce Platform

Multi-tenant facilitation-as-a-service for agentic payments. Policy enforcement, X402 settlement, on-chain verification, and full audit trail.

## What It Does

Any company or developer can integrate with this platform to:

1. **Enforce policies** on agentic payments (budget limits, merchant restrictions, URL allowlists, time-based rules)
2. **Settle payments** via the X402 protocol on Base (EVM) through registered providers (Firecrawl, Zyte, etc.)
3. **Audit every transaction** with a correlated, queryable audit trail
4. **Manage treasury** with off-chain balances, holds, and on-chain reconciliation

## Architecture

```
Buyer Agent --> POST /api/v1/payments/execute
                    |
                    v
              [API Key Auth + Scope Guard]
                    |
                    v
              [Policy Engine] -- reject if rules violated
                    |
                    v
              [Treasury Hold] -- reserve funds
                    |
                    v
              [Provider Dispatch] -- Firecrawl / Zyte x402 agent
                    |
                    v
              [On-Chain TX Verify] -- Base USDC transfer confirmed
                    |
                    v
              [Settle + Audit Log] -- debit treasury, persist trace
```

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- npm 8+

### Setup

```bash
git clone <repo-url> && cd agentic-commerce
cp .env.production.example .env   # fill in your values
npm install
npm run build
npm run db:setup                  # runs migrations + seeds
npm run dev                       # starts on http://localhost:3001
```

### Your First API Call

Use the seeded demo key (or the sandbox test key):

```bash
# Live mode (real on-chain TX)
curl -X POST http://localhost:3001/api/v1/payments/execute \
  -H 'X-API-Key: ak_demo_live_test_key_2024' \
  -H 'Content-Type: application/json' \
  -d '{"provider":"zyte","action":"scrape","params":{"url":"https://example.com"}}'

# Sandbox mode (no real TX, mock data)
curl -X POST http://localhost:3001/api/v1/payments/execute \
  -H 'X-API-Key: ak_test_sandbox_key_2024' \
  -H 'Content-Type: application/json' \
  -d '{"provider":"zyte","action":"scrape","params":{"url":"https://example.com"}}'
```

## Authentication

All `/api/v1` endpoints require an API key via the `X-API-Key` header (or `Authorization: Bearer ak_...`).

| Key prefix   | Mode    | Behavior                                      |
|-------------|---------|-----------------------------------------------|
| `ak_live_`  | Live    | Real policy checks, real on-chain payments    |
| `ak_test_`  | Sandbox | Full flow simulation, mock providers, no TX   |

### Scopes

API keys can be scoped to limit access:

| Scope             | Access                                    |
|-------------------|-------------------------------------------|
| `*`               | Full access (default for first key)       |
| `payments:read`   | List and view payments                    |
| `payments:write`  | Execute payments                          |
| `policies:read`   | View policies, dry-run checks             |
| `policies:write`  | Create, update, delete policies           |
| `audit:read`      | Query audit trail                         |
| `treasury:read`   | View treasury balance and ledger          |
| `providers:read`  | List available providers                  |
| `admin`           | Org management, API key lifecycle, deposits |

## API Reference

Full API documentation: [docs/api-reference.md](docs/api-reference.md)

Interactive spec: `GET /api/v1/openapi.json`

### Endpoint Summary

| Category     | Endpoint                              | Method | Scope            |
|-------------|---------------------------------------|--------|------------------|
| **Payments** | `/api/v1/payments/execute`            | POST   | payments:write   |
|              | `/api/v1/payments`                    | GET    | payments:read    |
|              | `/api/v1/payments/:id`                | GET    | payments:read    |
|              | `/api/v1/payments/:id/trace`          | GET    | payments:read    |
|              | `/api/v1/payments/:id/verify`         | GET    | payments:read    |
| **Policies** | `/api/v1/policies`                    | GET    | policies:read    |
|              | `/api/v1/policies`                    | POST   | policies:write   |
|              | `/api/v1/policies/:id`                | PUT    | policies:write   |
|              | `/api/v1/policies/:id`                | DELETE | policies:write   |
|              | `/api/v1/policies/check`              | POST   | policies:read    |
| **Audit**    | `/api/v1/audit`                       | GET    | audit:read       |
|              | `/api/v1/audit/stats`                 | GET    | audit:read       |
|              | `/api/v1/audit/:id`                   | GET    | audit:read       |
| **Treasury** | `/api/v1/treasury`                    | GET    | treasury:read    |
|              | `/api/v1/treasury/ledger`             | GET    | treasury:read    |
|              | `/api/v1/treasury/deposit`            | POST   | admin            |
|              | `/api/v1/treasury/reconcile`          | GET    | admin            |
| **Providers**| `/api/v1/providers`                   | GET    | providers:read   |
|              | `/api/v1/providers/:id`               | GET    | providers:read   |
| **Org**      | `/api/v1/orgs`                        | POST   | admin            |
|              | `/api/v1/orgs/me`                     | GET    | (any)            |
|              | `/api/v1/orgs/me`                     | PUT    | admin            |
|              | `/api/v1/orgs/me/api-keys`            | GET    | admin            |
|              | `/api/v1/orgs/me/api-keys`            | POST   | admin            |
|              | `/api/v1/orgs/me/api-keys/:id`        | DELETE | admin            |
|              | `/api/v1/orgs/me/api-keys/:id/rotate` | POST   | admin            |
|              | `/api/v1/orgs/me/webhook-secret`      | GET    | admin            |
|              | `/api/v1/orgs/me/webhook-secret/rotate` | POST | admin            |
| **Health**   | `/api/v1/health`                      | GET    | (any)            |

## Project Structure

```
agentic-commerce/
  packages/
    shared/        # Types, constants, structured logger
    database/      # PostgreSQL access, migrations, seeds
    core/          # PolicyService, AuditService, PaymentOrchestrator
    integrations/  # Firecrawl, Zyte, Stripe, Solana, Base TX verifier
    api/           # Express server, v1 routes, middleware, schemas
    sdk/           # TypeScript client SDK
  apps/
    chat-ui/       # Chat demo UI
    dashboard/     # Admin dashboard (React)
```

## Environment Variables

See [.env.production.example](.env.production.example) for the full list.

Key variables:

| Variable              | Required | Description                            |
|-----------------------|----------|----------------------------------------|
| `DATABASE_URL`        | Yes      | PostgreSQL connection string           |
| `JWT_SECRET`          | Yes      | Secret for JWT tokens                  |
| `ALLOWED_ORIGINS`     | Prod     | Comma-separated CORS origins           |
| `FIRECRAWL_API_KEY`   | Optional | Firecrawl provider API key             |
| `ZYTE_API_KEY`        | Optional | Zyte provider API key                  |
| `FIRECRAWL_AGENT_PRIVATE_KEY` | Optional | Base wallet key for agent payments |
| `BASE_RPC_URL`        | Optional | Base network RPC endpoint              |

## License

Private - All rights reserved.
