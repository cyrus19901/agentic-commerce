# Comprehensive Test Plan

This document outlines the testing strategy for the agent-to-agent integration.

## Pre-Test Setup

### 1. Install Dependencies

```bash
cd /Users/cyrus19901/Repository/agentic-commerce

# Install root dependencies
npm install

# Install Solana dependencies
cd packages/integrations
npm install @solana/web3.js@^1.87.6 @solana/spl-token@^0.3.9

# Return to root and build
cd ../..
npm run build
```

### 2. Database Setup

```bash
# Initialize database
npm run db:setup

# Verify database created
ls -la ./data/shopping.db
```

### 3. Create Test User & Policy

```bash
# Create test user (save the JWT token output!)
npm run create-user

# Expected output:
# ✓ User created/retrieved: test-user-xxx
# ✓ JWT Token: eyJhbGci...
```

## Test Suite 1: Unit Tests

### Policy Service Tests

```bash
npm test tests/unit/policy-service.test.ts
```

**Expected Results:**
- ✅ Policy evaluation for agent-to-merchant
- ✅ Policy evaluation for agent-to-agent
- ✅ Transaction type filtering
- ✅ Budget limits work for both types
- ✅ Agent whitelist/blacklist enforcement

**What to verify:**
- All tests pass
- No errors in console
- Policy checks return correct allowed/denied states

## Test Suite 2: Integration Tests

### Agent-to-Agent Flow Tests

```bash
npm test tests/integration/agent-to-agent-flow.test.ts
```

**Expected Results:**
- ✅ Complete agent-to-agent transaction flow
- ✅ x402 requirement generation
- ✅ Payment proof creation
- ✅ Nonce anti-replay protection
- ✅ Agent registry CRUD operations

**What to verify:**
- Payment flow completes end-to-end
- Nonces are properly tracked
- Agent registration works correctly

## Test Suite 3: E2E API Tests

### Setup E2E Environment

```bash
# Terminal 1: Start API server
npm run dev

# Wait for server to start...
# ✓ API Server running on 0.0.0.0:3000
```

```bash
# Terminal 2: Run E2E tests
npm test tests/e2e/agent-to-agent-api.test.ts
```

**Expected Results:**
- ✅ 402 handshake works
- ✅ Payment verification flow
- ✅ Agent registry endpoints
- ✅ Facilitator verification

## Test Suite 4: Manual API Tests

### Test 1: Health Checks

```bash
# API health
curl http://localhost:3000/health

# Expected: {"status":"healthy"}

# Facilitator health
curl http://localhost:3000/api/facilitator/health

# Expected: {"ok":true,"service":"facilitator",...}
```

### Test 2: Policy Check (Agent-to-Merchant)

```bash
# Replace YOUR_JWT_TOKEN with token from create-user
export JWT_TOKEN="your_jwt_token_here"

curl -X POST http://localhost:3000/api/policy/check \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test-user",
    "product_id": "prod-123",
    "price": 50.0,
    "merchant": "Amazon",
    "category": "Electronics",
    "transactionType": "agent-to-merchant"
  }'
```

**Expected Response:**
```json
{
  "allowed": true/false,
  "reason": "...",
  "matchedPolicies": [...]
}
```

### Test 3: Policy Check (Agent-to-Agent)

```bash
curl -X POST http://localhost:3000/api/policy/check \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test-user",
    "product_id": "agent-service-scrape",
    "price": 1.0,
    "merchant": "agent://seller.scraper/v1",
    "category": "scraping",
    "transactionType": "agent-to-agent",
    "recipientAgentId": "agent://seller.scraper/v1",
    "serviceType": "scrape"
  }'
```

**Expected Response:**
```json
{
  "allowed": false,
  "reason": "No policies configured for agent-to-agent transactions",
  "matchedPolicies": []
}
```

*Note: This should fail until we create an agent-to-agent policy*

### Test 4: Create Agent-to-Agent Policy

```bash
curl -X POST http://localhost:3000/api/policies \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "agent-test-policy",
    "name": "Test Agent Policy",
    "type": "budget",
    "enabled": true,
    "priority": 1,
    "transactionTypes": ["agent-to-agent"],
    "conditions": {},
    "rules": {
      "maxAmount": 100,
      "period": "monthly",
      "allowedRecipientAgents": ["agent://seller.scraper/v1"]
    }
  }'
```

**Expected Response:**
```json
{
  "policy": {...},
  "message": "Policy created successfully"
}
```

### Test 5: Retry Policy Check (Should Pass Now)

```bash
# Retry the agent-to-agent policy check from Test 3
# Expected: allowed: true
```

### Test 6: Agent Service Request (Get 402)

```bash
curl -X POST http://localhost:3000/api/agent/services/scrape \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "mode": "demo"
  }' \
  -v
```

**Expected Response:**
```
< HTTP/1.1 402 Payment Required
< PAYMENT-REQUIRED: eyJwcm90b2NvbCI6IngyMDIi...

{
  "error": "PAYMENT_REQUIRED",
  "requirement": {
    "protocol": "x402",
    "version": "v2",
    "amount": "1000000",
    "nonce": "...",
    "payTo": "...",
    ...
  }
}
```

### Test 7: Register an Agent

```bash
curl -X POST http://localhost:3000/api/registry/agents \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent://test-agent/v1",
    "name": "Test Agent Service",
    "baseUrl": "http://localhost:3000",
    "services": ["scrape", "api-call"],
    "serviceDescription": "Test agent for integration testing",
    "acceptedCurrencies": ["USDC"],
    "usdcTokenAccount": "test-usdc-account-placeholder",
    "solanaPubkey": "test-pubkey-placeholder"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Agent registered successfully",
  "agent": {...}
}
```

### Test 8: Discover Agent

```bash
curl http://localhost:3000/api/registry/agents/agent%3A%2F%2Ftest-agent%2Fv1
```

**Expected Response:**
```json
{
  "agentId": "agent://test-agent/v1",
  "name": "Test Agent Service",
  "baseUrl": "http://localhost:3000",
  "services": ["scrape", "api-call"],
  ...
}
```

### Test 9: List All Agents

```bash
curl http://localhost:3000/api/registry/agents
```

**Expected Response:**
```json
{
  "agents": [...],
  "count": 1
}
```

## Test Suite 5: Frontend Tests

### Setup Frontend

```bash
cd /Users/cyrus19901/Repository/gordon-fe-policy

# Install dependencies (if not already)
npm install

# Start dev server
npm run dev
```

### Test 10: Policy Builder UI

1. Open http://localhost:3001 in browser
2. Navigate to Policy Builder
3. Create new policy

**Manual Verification:**
- ✅ Transaction type selector shows: "All Transactions", "Agent to Merchant", "Agent to Agent"
- ✅ Selecting "Agent to Agent" shows agent-specific fields:
  - Buyer Agent Name
  - Buyer Agent Type
  - Recipient Agent (Seller)
- ✅ Selecting "Agent to Merchant" shows merchant-specific fields:
  - Merchant Name
  - Merchant Category
- ✅ "All Transactions" shows all fields
- ✅ Saving policy works correctly
- ✅ Loading policy preserves transaction type

### Test 11: Create Agent-to-Agent Policy via UI

1. Click "New Policy"
2. Name: "Agent Service Budget"
3. Transaction Type: "Agent to Agent"
4. Add condition: Amount ≤ 50
5. Add condition: Recipient Agent equals "agent://seller.scraper/v1"
6. Fallback: Require Approval
7. Save

**Verify:**
- ✅ Policy saves successfully
- ✅ Policy appears in backend (`GET /api/policies`)
- ✅ Policy has `transactionTypes: ["agent-to-agent"]`

## Test Results Checklist

### Core Functionality
- [ ] Database schema updated correctly
- [ ] x402 protocol functions work
- [ ] Facilitator service verifies payments
- [ ] Policy engine filters by transaction type
- [ ] Agent registry CRUD operations work

### API Endpoints
- [ ] `/api/agent/services/:type` returns 402
- [ ] `/api/registry/agents` lists agents
- [ ] `/api/registry/agents/:id` discovers agent
- [ ] `/api/facilitator/verify` validates proofs
- [ ] `/api/policies` supports transactionTypes

### Policy Evaluation
- [ ] Agent-to-merchant policies work
- [ ] Agent-to-agent policies work
- [ ] "All" policies apply to both types
- [ ] Budget limits enforced correctly
- [ ] Agent whitelist/blacklist works

### Frontend UI
- [ ] Transaction type selector works
- [ ] Field options filter by transaction type
- [ ] Policies save with correct transaction types
- [ ] Policies load with correct transaction types
- [ ] UI updates when changing transaction type

## Known Issues & Limitations

### Not Yet Implemented:
1. Real Solana transaction verification (currently mocked in tests)
2. Production RPC endpoints
3. Solana wallet integration in frontend
4. Real USDC payments

### Future Enhancements:
1. Subscription payments
2. Escrow services
3. Multi-party transactions
4. Real-time transaction monitoring
5. Enhanced agent discovery (filtering, search)

## Troubleshooting Common Issues

### "No policies configured" Error
**Solution:** Create a policy with matching transaction type

### "USDC_TOKEN_ACCOUNT not configured"
**Solution:** Set in `.env` file (can use placeholder for testing)

### Database Locked Error
**Solution:** Stop all server instances, delete `./data/shopping.db`, run `npm run db:setup`

### 401 Unauthorized Error
**Solution:** Verify JWT token is correct and not expired

### Module Not Found Errors
**Solution:** Run `npm run build` to rebuild packages

## Success Criteria

All tests pass when:
1. ✅ All unit tests pass
2. ✅ All integration tests pass
3. ✅ All E2E tests pass
4. ✅ Manual API tests return expected responses
5. ✅ Frontend UI works correctly
6. ✅ Policies enforce correctly for both transaction types
7. ✅ Agent registry operations work
8. ✅ 402 handshake flow completes

## Next Steps After Testing

1. **Production Configuration:**
   - Switch to Solana mainnet
   - Configure production RPC
   - Set up real USDC accounts

2. **Monitoring:**
   - Add logging
   - Set up alerting
   - Track transaction metrics

3. **Documentation:**
   - Update API documentation
   - Create user guides
   - Document production deployment

4. **Security:**
   - Security audit
   - Penetration testing
   - Rate limiting configuration
