# E2E Testing with Real Solana Devnet

## Overview

This test suite performs **real** end-to-end testing of agent-to-agent communication using:
- **Real Solana devnet transactions**
- **Actual USDC transfers**
- **Production x402 protocol**
- **Live facilitator verification**

## Prerequisites

### 1. Install Solana CLI

```bash
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
```

### 2. Setup Devnet

```bash
chmod +x tests/e2e/setup-devnet.sh
./tests/e2e/setup-devnet.sh
```

### 3. Get USDC Devnet Tokens

Option A - Use SPL Token Faucet:
```bash
# Visit: https://spl-token-faucet.com/?token-name=USDC-Dev
# Enter your wallet address and request tokens
```

Option B - Manual setup:
```bash
# Create USDC token account
spl-token create-account Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr

# Check your token accounts
spl-token accounts
```

## Running the Test

### Start the API server

```bash
# In terminal 1
docker compose up -d
```

### Run the E2E test

```bash
# In terminal 2
npx tsx tests/e2e/agent-x402-real-solana.test.ts
```

## What the Test Does

### Step 1: Setup Solana Accounts
- Creates buyer and seller keypairs
- Requests SOL airdrops for gas fees
- Sets up USDC token accounts

### Step 2: Register Agents
- Registers seller agent with services
- Registers buyer agent
- Both linked to their Solana addresses

### Step 3: Request Service (402)
- Buyer requests service from seller
- Receives 402 Payment Required
- Gets x402 payment requirement with nonce

### Step 4: Execute Real Payment
- Creates USDC transfer transaction
- Signs with buyer's keypair
- **Submits to Solana devnet**
- Waits for confirmation
- Returns transaction signature

### Step 5: Create Payment Proof
- Builds x402 payment proof
- Includes transaction signature
- Signs proof with buyer's key
- Includes anti-replay nonce

### Step 6: Verify Payment
- Submits proof to facilitator
- Facilitator checks Solana transaction
- Verifies amount, recipient, nonce
- Returns verification receipt

### Step 7: Complete Service
- Re-submits service request
- Includes payment proof header
- Service executes successfully
- Returns result data

## Expected Output

```
🚀 Starting E2E Agent-to-Agent x402 Test (Real Solana Devnet)

🌐 Connecting to Solana devnet
  ✓ Connected to Solana

🔑 Setting up Solana accounts on devnet
  Buyer: ABC...123
  Seller: DEF...456
  ✓ Airdrops confirmed
  ✓ USDC token accounts created

📋 Step 1: Registering agents
  ✓ Seller agent registered
  ✓ Buyer agent registered

⚡ Step 2: Buyer requests service
  ✓ Received 402 Payment Required

💸 Step 3: Executing USDC payment on Solana devnet
  📤 Sending transaction to Solana devnet
  Transaction signature: 5Kqr...xyz
  🔗 View on Explorer: https://explorer.solana.com/tx/...
  ⏳ Waiting for confirmation
  ✅ Transaction confirmed on devnet!

🔐 Step 4: Creating x402 payment proof
  ✓ Payment proof created

✅ Step 5: Verifying payment with facilitator
  ✓ Payment verified

🎯 Step 6: Completing service request
  ✓ Service completed successfully

🎉 E2E TEST PASSED!

✅ Summary:
  • Agents registered: Buyer & Seller
  • 402 Payment Required: Received
  • Solana Transaction: 5Kqr...xyz
  • Payment Verified: true
  • Service Completed: Success
```

## Troubleshooting

### "Insufficient SOL for gas"
```bash
solana airdrop 2 YOUR_ADDRESS --url devnet
```

### "Account does not have sufficient token balance"
Request USDC devnet tokens from faucet or mint some

### "Transaction simulation failed"
Check that both token accounts exist and have sufficient balance

### "Nonce already used"
This is correct behavior - anti-replay protection working

## View Transactions

All transactions are visible on Solana Explorer:
```
https://explorer.solana.com/tx/YOUR_TX_SIGNATURE?cluster=devnet
```

## Production Readiness

This test uses:
- ✅ Real blockchain transactions
- ✅ Actual cryptographic signatures  
- ✅ Live network confirmation
- ✅ Production x402 protocol
- ✅ Anti-replay protection
- ✅ Facilitator verification

**To go to mainnet:**
1. Change RPC to mainnet-beta
2. Use mainnet USDC mint
3. Fund accounts with real USDC
4. Update environment variables
