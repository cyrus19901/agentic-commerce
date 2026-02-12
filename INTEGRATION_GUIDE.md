# Agent-to-Agent Integration Guide

This guide explains the integration of x402 protocol for agent-to-agent transactions into the Agentic Commerce platform.

## Overview

The platform now supports **two transaction types**:

1. **Agent-to-Merchant**: Traditional purchases using Stripe (existing functionality)
2. **Agent-to-Agent**: Micropayments between agents using Solana USDC with x402 protocol (new)

Both transaction types are governed by the **unified policy engine**, allowing you to set spending rules, budget limits, and approval workflows for all types of transactions.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│          Unified Policy Engine                          │
│   (Governs both merchant & agent transactions)          │
└──────────────┬──────────────────────────────────────────┘
               │
       ┌───────┴───────┐
       │               │
       ▼               ▼
┌──────────────┐  ┌──────────────┐
│ Agent-to-    │  │ Agent-to-    │
│ Merchant     │  │ Agent        │
│ (Stripe)     │  │ (x402/USDC)  │
└──────────────┘  └──────────────┘
```

## Key Components

### 1. Enhanced Database Schema

**New Fields in `Purchase` Table:**
- `transactionType`: 'agent-to-merchant' | 'agent-to-agent'
- `solanaSignature`: Solana transaction signature
- `x402Nonce`: Anti-replay nonce
- `recipientAgentId`: Agent receiving payment
- `buyerAgentId`: Agent sending payment
- `agentServiceType`: Service type (scrape, api-call, etc.)

**New Tables:**
- `RegisteredAgent`: Agent registry for discovery
- `X402Nonce`: Nonce tracking for replay protection

**Enhanced `Policy` Table:**
- `transactionTypes`: Array of transaction types this policy applies to
- `allowedRecipientAgents`: Whitelist of recipient agents
- `blockedRecipientAgents`: Blacklist of recipient agents

### 2. x402 Protocol Implementation

The x402 protocol enables HTTP 402 Payment Required flows:

```typescript
// 1. First request (no payment)
POST /api/agent/services/scrape
→ 402 Payment Required
   Header: PAYMENT-REQUIRED (base64url JSON)

// 2. Buyer makes USDC payment on Solana

// 3. Retry with payment proof
POST /api/agent/services/scrape
Header: PAYMENT-SIGNATURE (base64url JSON)
→ 200 OK with service response
   Header: PAYMENT-RESPONSE (receipt)
```

### 3. Facilitator Service

The facilitator verifies payments and enforces anti-replay protection:

- Validates Solana transactions on-chain
- Checks nonce uniqueness (prevents replay attacks)
- Verifies payment amount, mint, and recipient
- Issues cryptographic receipts

### 4. Agent Registry

Discover and register agent services:

```typescript
// Register your agent
POST /api/registry/agents
{
  "agentId": "agent://myagent.service/v1",
  "name": "My Agent Service",
  "baseUrl": "https://myagent.com",
  "services": ["scrape", "api-call"],
  "usdcTokenAccount": "YOUR_USDC_ATA"
}

// Discover agents
GET /api/registry/agents?service=scrape
```

## Policy Configuration

### Transaction Type Scoping

Policies can now target specific transaction types:

```typescript
{
  "id": "merchant-only-policy",
  "name": "Merchant Budget Limit",
  "type": "budget",
  "transactionTypes": ["agent-to-merchant"], // Only applies to merchant transactions
  "rules": {
    "maxAmount": 1000,
    "period": "monthly"
  }
}

{
  "id": "agent-only-policy",
  "name": "Agent Service Limit",
  "type": "budget",
  "transactionTypes": ["agent-to-agent"], // Only applies to agent-to-agent
  "rules": {
    "maxAmount": 100,
    "period": "monthly"
  }
}

{
  "id": "universal-policy",
  "name": "Total Spending Limit",
  "type": "budget",
  "transactionTypes": ["all"], // Applies to ALL transactions
  "rules": {
    "maxAmount": 5000,
    "period": "monthly"
  }
}
```

### Agent-Specific Rules

```typescript
{
  "id": "agent-whitelist",
  "name": "Approved Agents Only",
  "type": "agent",
  "transactionTypes": ["agent-to-agent"],
  "rules": {
    "allowedRecipientAgents": [
      "agent://trusted.scraper/v1",
      "agent://data.analyzer/v1"
    ]
  }
}

{
  "id": "service-restrictions",
  "name": "Block Risky Services",
  "type": "category",
  "transactionTypes": ["agent-to-agent"],
  "rules": {
    "blockedCategories": [
      "cryptocurrency-trading",
      "high-risk-ai"
    ]
  }
}
```

## Usage Examples

### Seller Agent (Receives Payments)

```typescript
import { createX402Requirement, b64urlEncodeJson, sha256HexUtf8 } from '@agentic-commerce/integrations';

// In your agent endpoint
app.post('/api/services/scrape', async (req, res) => {
  const bodyHash = sha256HexUtf8(JSON.stringify(req.body));
  const paymentSig = req.headers['payment-signature'];

  if (!paymentSig) {
    // No payment yet - return 402
    const requirement = createX402Requirement({
      amount: '1000000', // 1 USDC
      payTo: process.env.USDC_TOKEN_ACCOUNT,
      mint: process.env.USDC_MINT,
      network: 'solana:devnet',
      method: 'POST',
      path: '/api/services/scrape',
      bodyHash,
      facilitator: `${process.env.API_URL}/api/facilitator/verify`,
    });

    res.status(402);
    res.header('PAYMENT-REQUIRED', b64urlEncodeJson(requirement));
    return res.json({ error: 'PAYMENT_REQUIRED', requirement });
  }

  // Payment provided - verify and execute
  // (Verification handled by middleware)
  return res.json({ result: 'Service executed!' });
});
```

### Buyer Agent (Makes Payments)

```typescript
import { Connection, Keypair } from '@solana/web3.js';
import { makePaymentProof, b64urlDecodeJson } from '@agentic-commerce/integrations';

// 1. First request
const response1 = await fetch('https://agent.com/api/services/scrape', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://example.com' })
});

if (response1.status === 402) {
  const requirementHeader = response1.headers.get('PAYMENT-REQUIRED');
  const requirement = b64urlDecodeJson(requirementHeader);

  // 2. Make USDC payment on Solana
  const txSignature = await sendUSDCPayment(requirement);

  // 3. Create proof
  const proof = makePaymentProof(requirement, txSignature);

  // 4. Retry with proof
  const response2 = await fetch('https://agent.com/api/services/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PAYMENT-SIGNATURE': b64urlEncodeJson(proof)
    },
    body: JSON.stringify({ url: 'https://example.com' })
  });

  const result = await response2.json();
  console.log('Service result:', result);
}
```

## Testing

### Unit Tests

```bash
cd /Users/cyrus19901/Repository/agentic-commerce
npm test tests/unit/policy-service.test.ts
```

### Integration Tests

```bash
npm test tests/integration/agent-to-agent-flow.test.ts
```

### E2E Tests

```bash
# Start test server
npm run dev

# Run E2E tests
npm test tests/e2e/agent-to-agent-api.test.ts
```

## Migration Guide

### For Existing Policies

Existing policies automatically default to `agent-to-merchant` for backward compatibility. To apply them to both transaction types:

```typescript
// Update existing policy
await updatePolicy({
  ...existingPolicy,
  transactionTypes: ['all'] // Now applies to both
});
```

### For Frontend

The gordon-fe-policy UI needs updates to support transaction type selection in the policy builder (see Phase 5).

## Security Considerations

### Anti-Replay Protection

The x402 nonce system prevents replay attacks:
- Each nonce can only be used once
- Nonces are tracked in the database
- Expired nonces are automatically cleaned up

### Policy Enforcement

Policies are checked on BOTH sides:
- **Buyer side**: Before making payment
- **Seller side**: After payment verification (defense in depth)

### Payment Verification

All payments are verified on-chain:
- Transaction must exist on Solana
- Amount must match requirement
- Recipient must match
- Mint must match (USDC only)

## Troubleshooting

### "PAYMENT_INVALID" Error

- Check that transaction is confirmed on Solana
- Verify you're using the correct network (devnet vs mainnet)
- Ensure USDC mint address matches

### "NONCE_REUSED" Error

- You're attempting to reuse a payment proof
- Generate a new payment for each request

### "AGENT_NOT_FOUND" Error

- Agent not registered in registry
- Register your agent: `POST /api/registry/agents`

## Next Steps

1. **Deploy to Production**:
   - Switch to Solana mainnet
   - Use production USDC mint
   - Configure reliable RPC provider

2. **Enhanced Features**:
   - Subscription payments (recurring x402)
   - Escrow services
   - Multi-party transactions

3. **Frontend Integration**:
   - Update gordon-fe-policy UI (Phase 5)
   - Add agent-to-agent transaction views
   - Visualize both transaction types in dashboard

## Support

For issues or questions:
- Check logs: `./data/shopping.db` and server logs
- Review test cases for examples
- Consult x402 protocol documentation
