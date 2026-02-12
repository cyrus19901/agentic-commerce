# Quick Start Guide - Agent-to-Agent Integration

This guide will help you quickly set up and test the agent-to-agent transaction flow.

## Prerequisites

- Node.js >= 20
- npm or pnpm
- Solana CLI (for testing with real transactions)
- Basic understanding of Solana and USDC

## Setup (5 minutes)

### 1. Install Dependencies

```bash
cd /Users/cyrus19901/Repository/agentic-commerce

# Install root dependencies
npm install

# Add Solana dependencies
cd packages/integrations
npm install @solana/web3.js @solana/spl-token

# Build all packages
cd ../..
npm run build
```

### 2. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your values
nano .env
```

**Minimum required configuration for testing:**

```env
# Database
DATABASE_URL=./data/shopping.db

# API
PORT=3000
JWT_SECRET=test-secret-key

# Solana (Devnet for testing)
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# Your Agent Configuration
AGENT_ID=agent://myagent/v1
USDC_TOKEN_ACCOUNT=YOUR_USDC_TOKEN_ACCOUNT_HERE

# Facilitator
FACILITATOR_URL=http://localhost:3000/api/facilitator/verify
```

### 3. Initialize Database

```bash
npm run db:setup
```

### 4. Create Test User and Policy

```bash
# Create test user
npm run create-user

# The script will output a JWT token - save this!
```

### 5. Start the Server

```bash
npm run dev
```

Server will start on http://localhost:3000

## Testing Agent-to-Agent Flow

### Option 1: Using cURL

#### Step 1: Test Policy Check

```bash
# Replace YOUR_JWT_TOKEN with the token from create-user script
curl -X POST http://localhost:3000/api/policy/check \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test-user",
    "product_id": "agent-service-scrape",
    "price": 1.0,
    "merchant": "agent://seller.scraper/v1",
    "category": "scraping",
    "transactionType": "agent-to-agent",
    "recipientAgentId": "agent://seller.scraper/v1"
  }'
```

Expected response:
```json
{
  "allowed": true,
  "matchedPolicies": [...]
}
```

#### Step 2: Request Agent Service (Get 402)

```bash
curl -X POST http://localhost:3000/api/agent/services/scrape \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "mode": "demo"
  }' \
  -v
```

Expected response:
```
< HTTP/1.1 402 Payment Required
< PAYMENT-REQUIRED: eyJ...base64url...
{
  "error": "PAYMENT_REQUIRED",
  "requirement": {
    "protocol": "x402",
    "version": "v2",
    "amount": "1000000",
    "nonce": "...",
    ...
  }
}
```

### Option 2: Using Test Script

```bash
# Run integration tests
npm test tests/integration/agent-to-agent-flow.test.ts

# Run unit tests
npm test tests/unit/policy-service.test.ts
```

### Option 3: Using Solana Devnet (Real Transactions)

```bash
# 1. Create Solana wallet for testing
solana-keygen new --outfile ~/test-wallet.json

# 2. Get devnet SOL
solana airdrop 2 --keypair ~/test-wallet.json --url devnet

# 3. Create USDC token account
spl-token create-account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --keypair ~/test-wallet.json --url devnet

# 4. Get devnet USDC (use Solana faucet or test tools)

# 5. Use the token account address in your USDC_TOKEN_ACCOUNT env variable
```

## Register Your Agent

```bash
curl -X POST http://localhost:3000/api/registry/agents \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent://myagent/v1",
    "name": "My Test Agent",
    "baseUrl": "http://localhost:3000",
    "services": ["scrape", "api-call"],
    "serviceDescription": "Test agent for development",
    "acceptedCurrencies": ["USDC"],
    "usdcTokenAccount": "YOUR_USDC_TOKEN_ACCOUNT",
    "solanaPubkey": "YOUR_SOLANA_PUBKEY"
  }'
```

## Create Policies

### Policy 1: Budget Limit for Agent Transactions

```bash
curl -X POST http://localhost:3000/api/policies \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "agent-budget-1",
    "name": "Agent Service Budget",
    "type": "budget",
    "enabled": true,
    "priority": 1,
    "transactionTypes": ["agent-to-agent"],
    "conditions": {},
    "rules": {
      "maxAmount": 100,
      "period": "monthly"
    }
  }'
```

### Policy 2: Allow Only Specific Agents

```bash
curl -X POST http://localhost:3000/api/policies \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "agent-whitelist-1",
    "name": "Approved Agents",
    "type": "agent",
    "enabled": true,
    "priority": 1,
    "transactionTypes": ["agent-to-agent"],
    "conditions": {},
    "rules": {
      "allowedRecipientAgents": [
        "agent://seller.scraper/v1",
        "agent://trusted.service/v1"
      ]
    }
  }'
```

## Verify Setup

Check all systems are working:

```bash
# 1. Health check
curl http://localhost:3000/health

# 2. Check facilitator
curl http://localhost:3000/api/facilitator/health

# 3. List policies
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:3000/api/policies

# 4. List registered agents
curl http://localhost:3000/api/registry/agents
```

## Next Steps

1. **Frontend Integration**: Update gordon-fe-policy UI to support agent-to-agent policies
2. **Production Setup**: Switch to Solana mainnet and configure production settings
3. **Monitoring**: Set up logging and monitoring for agent transactions
4. **Advanced Policies**: Create complex policies with multiple conditions

## Troubleshooting

### "No policies configured" Error

**Solution**: Create at least one policy with `transactionTypes: ["agent-to-agent"]` or `["all"]`

```bash
# Quick fix: Create a permissive policy
curl -X POST http://localhost:3000/api/policies \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "allow-all-agents",
    "name": "Allow All Agents",
    "type": "budget",
    "enabled": true,
    "priority": 1,
    "transactionTypes": ["all"],
    "conditions": {},
    "rules": {
      "maxAmount": 10000,
      "period": "monthly"
    }
  }'
```

### "USDC_TOKEN_ACCOUNT not configured" Error

**Solution**: Set your USDC token account in `.env`:

```env
USDC_TOKEN_ACCOUNT=your_solana_usdc_ata_here
```

### Database Errors

**Solution**: Reset and reinitialize database:

```bash
rm -rf ./data/shopping.db
npm run db:setup
npm run create-user
```

### Solana RPC Errors

**Solution**: Use a reliable RPC provider:

- Free devnet: https://api.devnet.solana.com
- Paid (better reliability): Helius, Triton, QuickNode

## Resources

- [Integration Guide](./INTEGRATION_GUIDE.md) - Detailed technical documentation
- [x402 Protocol Spec](https://github.com/a2a-x402) - Protocol specification
- [Solana Docs](https://docs.solana.com/) - Solana documentation
- [USDC on Solana](https://www.circle.com/en/usdc-multichain/solana) - USDC information

## Support

For questions or issues:
1. Check the logs: `./data/shopping.db` and server console
2. Review test cases for working examples
3. Consult the Integration Guide for detailed explanations
