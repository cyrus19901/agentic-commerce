# Agent-to-Agent Policy Testing Guide

## Current Policies for Agent-to-Agent Transactions

Based on your setup, these policies apply to a2a transactions:

1. **Agent Services Monthly Budget** - Monthly spending limit for agent services
2. **Monthly Budget Limit - $5000** - Overall monthly cap (applies to both a2m and a2a)
3. **Maximum Transaction Amount - $500** - Per-transaction limit
4. **Agent Transaction Limit $10** - ⚠️ **MOST RESTRICTIVE** - Will trigger first!
5. **Business Hours Only** - Blocks transactions outside business hours

## Quick Test: Trigger Transaction Limit

### Current Setup
- **Service Cost**: $0.10 USDC per request
- **Transaction Limit**: $10.00
- **Requests Needed**: 101 requests to exceed limit

### Test Command

```bash
# Single request
curl -s 'https://send-analyses-arranged-trainer.trycloudflare.com/api/chatgpt-agent/request-service' \
  -H 'Content-Type: application/json' \
  -d '{
    "user_email": "simple-test-1771186302@example.com",
    "agentId": "agent://apify.com/web-scraper/v1",
    "serviceType": "data-scraping",
    "parameters": {"url": "https://example.com"}
  }' | jq '{success, error, reason, wallet: {remainingBalance}}'
```

### Automated Test (Run 101 requests)

```bash
#!/bin/bash
TUNNEL_URL="https://send-analyses-arranged-trainer.trycloudflare.com"
EMAIL="simple-test-1771186302@example.com"

echo "Testing agent-to-agent transaction limit..."
TOTAL_SPENT=0

for i in {1..105}; do
  echo "Request $i (Total spent: \$${TOTAL_SPENT})..."
  
  RESPONSE=$(curl -s "${TUNNEL_URL}/api/chatgpt-agent/request-service" \
    -H 'Content-Type: application/json' \
    -d "{\"user_email\": \"${EMAIL}\", \"agentId\": \"agent://apify.com/web-scraper/v1\", \"serviceType\": \"data-scraping\", \"parameters\": {\"url\": \"https://example.com\"}}")
  
  ERROR=$(echo $RESPONSE | jq -r '.error // empty')
  
  if [ "$ERROR" = "POLICY_VIOLATION" ]; then
    echo ""
    echo "✅ POLICY VIOLATION TRIGGERED on request $i!"
    echo ""
    echo "Response:"
    echo $RESPONSE | jq '{error, message, reason, matchedPolicies}'
    break
  fi
  
  if [ "$ERROR" = "INSUFFICIENT_FUNDS" ]; then
    echo "❌ Out of USDC funds. Please fund your wallet."
    echo $RESPONSE | jq '.wallet.fundingInstructions'
    break
  fi
  
  SUCCESS=$(echo $RESPONSE | jq -r '.success // empty')
  if [ "$SUCCESS" = "true" ]; then
    BALANCE=$(echo $RESPONSE | jq -r '.wallet.remainingBalance')
    TOTAL_SPENT=$(echo "$TOTAL_SPENT + 0.1" | bc)
    echo "  ✓ Success. Balance: $BALANCE USDC (Spent: \$${TOTAL_SPENT})"
  else
    echo "  ✗ Unexpected error: $ERROR"
    echo $RESPONSE | jq '.'
    break
  fi
  
  sleep 0.5
done
```

## Test Different Policies

### 1. Test Business Hours Policy

**When it blocks**: Outside 9 AM - 5 PM weekdays (check your timezone!)

```bash
# Check current time
date

# If outside business hours, this should be blocked
curl -s 'https://send-analyses-arranged-trainer.trycloudflare.com/api/chatgpt-agent/request-service' \
  -H 'Content-Type: application/json' \
  -d '{"user_email": "simple-test-1771186302@example.com", "agentId": "agent://apify.com/web-scraper/v1", "serviceType": "data-scraping"}' \
  | jq '{error, reason}'
```

### 2. Lower the Transaction Limit (Make Testing Easier)

To test policies faster, lower the limit to $1:

**Option A: Via Database** (if you have access)
```bash
# Connect to your local database
docker compose -f docker-compose.tunnel.yml exec agentic-commerce-api sh -c \
  "sqlite3 /app/data/shopping.db \"UPDATE policies SET rules = json_set(rules, '$.maxAmount', 1) WHERE name LIKE '%Agent Transaction Limit%';\""

# Restart service
docker compose -f docker-compose.tunnel.yml restart agentic-commerce-api
```

**Option B: Via Code** (permanent change)
Edit `packages/database/src/setup.ts`:
```typescript
// Find "Agent Transaction Limit $10" and change to:
{
  name: 'Agent Transaction Limit $1',
  description: 'Limit agent-to-agent transactions to $1 (for testing)',
  type: 'budget',
  enabled: true,
  transactionTypes: ['agent-to-agent'],
  rules: {
    period: 'transaction',
    maxAmount: 1,  // Changed from 10
  },
}
```

Then rebuild: `docker compose -f docker-compose.tunnel.yml up -d --build`

### 3. Test Monthly Budget

Make ~50 requests (50 * $0.10 = $5.00) to exceed the monthly limit:

```bash
for i in {1..55}; do
  curl -s 'https://send-analyses-arranged-trainer.trycloudflare.com/api/chatgpt-agent/request-service' \
    -H 'Content-Type: application/json' \
    -d '{"user_email": "simple-test-1771186302@example.com", "agentId": "agent://apify.com/web-scraper/v1", "serviceType": "data-scraping"}' \
    | jq -c '{success, error, balance: .wallet.remainingBalance}'
  sleep 0.5
done
```

## Expected Policy Violation Response

When a policy is violated, you'll see:

```json
{
  "error": "POLICY_VIOLATION",
  "message": "This service request violates company policy",
  "reason": "Agent-to-agent transaction limit of $10.00 exceeded",
  "matchedPolicies": [
    {
      "id": 8,
      "name": "Agent Transaction Limit $10",
      "type": "budget",
      "reason": "Transaction limit exceeded"
    }
  ]
}
```

## Check Your Current Spending

Get the user's transaction history:

```bash
# Get user info first
curl -s 'https://send-analyses-arranged-trainer.trycloudflare.com/api/auth/me' \
  -H 'Authorization: Bearer YOUR_TOKEN' | jq '{id, email, totalSpent}'

# Or check wallet balance
curl -s 'https://send-analyses-arranged-trainer.trycloudflare.com/api/chatgpt-agent/wallet' \
  -H 'Content-Type: application/json' \
  -d '{"user_email": "simple-test-1771186302@example.com"}' \
  | jq '.wallet.balances'
```

## Reset Policies/Budget (for testing)

To reset and test again:

```bash
# Option 1: Create a new test user
curl -s 'https://send-analyses-arranged-trainer.trycloudflare.com/api/auth/create-user' \
  -H 'Content-Type: application/json' \
  -d '{"email": "test-'$(date +%s)'@example.com"}' | jq '.'

# Option 2: Clear purchase history (database)
docker compose -f docker-compose.tunnel.yml exec agentic-commerce-api sh -c \
  "sqlite3 /app/data/shopping.db \"DELETE FROM purchases WHERE user_id = 'your-user-id';\""
```

## Tips

1. **Start with low limits** - Set transaction limit to $1 for faster testing
2. **Check logs** - `docker compose -f docker-compose.tunnel.yml logs -f` to see policy checks
3. **Test incrementally** - Make 10 requests, check status, make 10 more
4. **Use different users** - Test policies with fresh users to avoid state issues
5. **Watch your USDC** - Remember, you're actually spending devnet USDC!

## Current Test User

- Email: `simple-test-1771186302@example.com`
- Wallet: `6kzEhPaeXQBcCJwGN8xK3VSyfUpVPU39gdw1KAj9ymru`
- Current Balance: ~9.4 USDC (after previous tests)
