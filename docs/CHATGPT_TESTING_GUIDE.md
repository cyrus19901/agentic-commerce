# ChatGPT Agent-to-Agent Testing Guide

## Overview
This guide shows how to test agent-to-agent transactions where **ChatGPT acts as the buyer agent** purchasing services from other agents using Solana USDC payments.

## Architecture
```
ChatGPT (Buyer Agent) → API Endpoints → Solana Blockchain → Seller Agent
     ↓                         ↓                ↓              ↓
  Request Service      Execute Payment    USDC Transfer   Service Result
```

## Prerequisites
1. ✅ API server running on `http://localhost:3000`
2. ✅ Seller agents registered in the registry
3. ✅ User account created
4. ✅ User wallet funded with SOL (for gas) and USDC (for payments)

## Step 1: Set Up ChatGPT Custom Action

### Option A: Use ChatGPT Actions (Recommended)
1. Go to https://chat.openai.com/
2. Create a new GPT or use an existing one
3. Go to "Configure" → "Actions"
4. Import the schema from `docs/gpt-action-schema.yaml`
5. Set the server URL: `http://localhost:3000` (for local testing) or your deployed URL

### Option B: Use ChatGPT Plugin
1. Follow the plugin development guide at https://platform.openai.com/docs/plugins
2. Use the same schema file

## Step 2: Test Flow with ChatGPT

### 2.1 Create a User Account
Say to ChatGPT:
```
Create a user account with email "chatgpt-test@example.com" and name "ChatGPT Agent"
```

Expected: User account created successfully

### 2.2 Create/Get Wallet
Say to ChatGPT:
```
Get my Solana wallet for agent payments using email "chatgpt-test@example.com"
```

Expected response:
- Solana public key
- USDC token account address
- Current balances (SOL and USDC)
- Funding instructions

### 2.3 Fund the Wallet
**For Devnet Testing:**

#### Get SOL (for transaction fees):
```bash
# In terminal
solana airdrop 1 <YOUR_PUBLIC_KEY> --url devnet
```

#### Get USDC (for agent payments):
1. Go to https://faucet.circle.com/
2. Select "Devnet"
3. Paste your USDC token account address
4. Request 10 USDC

Alternatively, use the test script:
```bash
npm run test:fund-chatgpt-wallet
```

### 2.4 List Available Agents
Say to ChatGPT:
```
Show me all available agents I can purchase services from
```

Expected: List of registered agents with their services and pricing

### 2.5 Request a Service (Complete Agent-to-Agent Transaction)
Say to ChatGPT:
```
Request data-scraping service from agent "agent://seller-test/v1" 
to scrape https://example.com and extract title and description.
Use my email "chatgpt-test@example.com"
```

Expected flow:
1. ✅ ChatGPT calls `/api/chatgpt-agent/request-service`
2. ✅ API initiates service request (gets 402 payment required)
3. ✅ API executes USDC payment on Solana automatically
4. ✅ API submits payment proof to seller
5. ✅ Seller verifies payment and returns service result
6. ✅ ChatGPT shows you the result with transaction details

### 2.6 View Transaction on Solana Explorer
ChatGPT will provide a Solana Explorer link. Click it to see:
- USDC transfer details
- Transaction signature
- From/To addresses
- Amount paid

## Step 3: Manual API Testing (Without ChatGPT)

### Create User
```bash
curl -X POST http://localhost:3000/api/auth/create-user \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "name": "Test User"
  }'
```

### Get/Create Wallet
```bash
curl -X GET http://localhost:3000/api/chatgpt-agent/wallet \
  -H "Content-Type: application/json" \
  -d '{
    "user_email": "test@example.com"
  }'
```

### List Agents
```bash
curl http://localhost:3000/api/registry/agents
```

### Request Service
```bash
curl -X POST http://localhost:3000/api/chatgpt-agent/request-service \
  -H "Content-Type: application/json" \
  -d '{
    "user_email": "test@example.com",
    "agentId": "agent://seller-test/v1",
    "serviceType": "data-scraping",
    "serviceParams": {
      "url": "https://example.com",
      "extractFields": ["title", "description"]
    }
  }'
```

## What Happens Behind the Scenes

1. **Policy Check**: Policies evaluate if the transaction is allowed (budget, recipient, amount)
2. **Payment Requirement**: Seller generates x402 payment requirement with nonce
3. **USDC Transfer**: Buyer's wallet sends USDC to seller's token account
4. **Facilitator Verification**: Transaction is verified on Solana blockchain
5. **Service Execution**: Seller performs the requested service
6. **Result Return**: Service result is returned to ChatGPT/buyer

## Troubleshooting

### "NO_WALLET" Error
- Create wallet first using `/api/chatgpt-agent/wallet`

### "Insufficient funds" Error
- Fund your wallet with SOL and USDC (see Step 2.3)

### "AGENT_NOT_FOUND" Error
- Check available agents with `/api/registry/agents`
- Register new agents if needed

### "POLICY_VIOLATION" Error
- Check policy configuration
- Ensure recipient agent is allowed
- Verify transaction amount is within limits

### Payment Verification Fails
- Ensure USDC token account has sufficient balance
- Wait for transaction confirmation (5-30 seconds on devnet)
- Check Solana Explorer for transaction status

## Example ChatGPT Conversation

**You:** "Create a user for me with email chatgpt-buyer@example.com"

**ChatGPT:** "I've created your user account. Would you like me to set up a Solana wallet for agent-to-agent transactions?"

**You:** "Yes, create a wallet"

**ChatGPT:** "Your Solana wallet is ready! Here are your details:
- Public Key: 2ZqWhcwYPqXKdtyCHSazqwp1F1ducfKvxLAbz95A8jkk
- USDC Token Account: Aj3Z8i5HQ1z9poYBfCicYXHCtfzry9ijcQyunPTaoG4g
- Balances: 0 SOL, 0 USDC

To fund your wallet for devnet testing, send SOL and USDC to the addresses above."

**You:** "Show me available agents"

**ChatGPT:** "Here are the available agents:
1. agent://seller-test/v1 - Data Scraping Service - 0.10 USDC
2. agent://platform-agent/v1 - API Calling Service - 0.05 USDC"

**You:** "Buy data scraping service from seller-test to scrape https://news.ycombinator.com"

**ChatGPT:** "Transaction completed successfully!
- Service: data-scraping
- Agent: agent://seller-test/v1
- Amount Paid: 0.10 USDC
- Transaction: 5KHx9... [View on Explorer]
- Result: [scraped data shown here]"

## Production Deployment

For production use with ChatGPT:
1. Deploy API to a public URL (e.g., https://api.yourdomain.com)
2. Update ChatGPT action schema with production URL
3. Use mainnet-beta Solana cluster
4. Implement proper wallet encryption/security
5. Add rate limiting and authentication
6. Monitor transactions and implement fraud detection

## Security Notes

⚠️ **Current Implementation**
- Wallets are stored in the database with base64 encoding (NOT secure for production)
- No multi-sig or approval workflows
- Automatic payment execution without user confirmation

✅ **Production Requirements**
- Encrypt private keys with user-specific encryption
- Implement spending limits and approval workflows
- Use hardware security modules (HSM) for key storage
- Add transaction confirmation steps
- Implement comprehensive audit logging
