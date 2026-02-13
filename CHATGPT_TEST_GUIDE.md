# ChatGPT Testing Guide

## Setup

### 1. Current Tunnel URL
```
https://greene-men-pct-seems.trycloudflare.com
```

**Note**: This URL changes when you restart containers. Get the current URL with:
```bash
make tunnel-url
```

### 2. Your Wallet Info
- **Public Key**: `2BCd1R1LPLsutzQ2gBLdFDuoKeakqqyebicvrPSsej1J`
- **USDC Balance**: `1980.6 USDC` (Solana devnet)
- **Network**: Devnet

---

## Test Scenarios for ChatGPT

### 🛍️ Test 1: Agent-to-Merchant (Shopping)

**User**: "I need to buy some office supplies, maybe around $20. Can you help me find sticky notes or notebooks?"

**Expected Flow**:
1. ChatGPT asks for your email → provide: `cyrus19901@gmail.com`
2. Searches products
3. Shows results with prices
4. Checks policy
5. **Returns Stripe checkout URL** → You can click and complete payment in Stripe sandbox

**Example Products Available**:
- Sticky Notes Bundle - $18 (QuickOffice)
- Leather Desk Pad - $45 (QuickOffice)
- Wireless Mouse - $35 (TechGear)
- USB-C Hub - $49 (TechGear)

---

### 🤖 Test 2: Agent-to-Agent (Services)

**User**: "Can you scrape https://example.com and extract the title and description for me?"

**Expected Flow**:
1. ChatGPT already has your email from Test 1
2. Calls `requestService` endpoint
3. System automatically:
   - Checks policies
   - Creates/uses Solana wallet
   - Executes USDC payment on Solana
   - Calls seller agent
   - Returns service result

**Available Agent Services**:
- `agent://seller.scraper/v1` - Web scraping (extracts data from websites)
- `agent://seller.api-caller/v1` - API calls (makes external API calls)
- `agent://seller.analytics/v1` - Analytics (data analysis and reporting)

**Service Types**:
- `data-scraping` - Extract data from websites
- `api-calling` - Make external API calls
- `computation` - Run calculations
- `data-processing` - Process and analyze data

---

## Example ChatGPT Prompts

### Shopping (Agent-to-Merchant)
```
"Find me a wireless mouse under $50"
"I need office supplies - show me what's available"
"Buy the sticky notes bundle"
```

### Services (Agent-to-Agent)
```
"Scrape https://example.com and get the title"
"Call the weather API for New York"
"Use the analytics service to process this data: [...]"
```

---

## Current Active Policies

### For Shopping (agent-to-merchant):
- ✅ Monthly Electronics Budget: $1500
- ✅ Transaction Limit: $500 per transaction
- ✅ Business Hours Only (Mon-Fri, 9am-5pm)

### For Services (agent-to-agent):
- ✅ Monthly Agent Budget: $1000
- ✅ Transaction Limit: $10 per request
- ✅ Business Hours Only

---

## Known Issues

### Solana Devnet Timeouts
Agent-to-agent transactions may fail with:
```
"Signature has expired: block height exceeded"
```

**This is normal on Solana devnet** - it means:
- ✅ Policy checks passed
- ✅ Transaction was created
- ❌ Solana network was too slow to confirm

**Solutions**:
- Retry the request
- Use mainnet for production (faster, more reliable)
- The flow still demonstrates the complete agent-to-agent payment cycle

---

## Updating Tunnel URL

When you restart containers, update these 2 files:

**1. `docker-compose.tunnel.yml` (line 31)**:
```yaml
- API_URL=https://YOUR-NEW-TUNNEL-URL.trycloudflare.com
```

**2. `docs/gpt-action-schema-seamless.yaml` (line 143)**:
```yaml
servers:
  - url: https://YOUR-NEW-TUNNEL-URL.trycloudflare.com
```

Then restart:
```bash
docker compose -f docker-compose.tunnel.yml up -d --force-recreate agentic-commerce-api
```

---

## Verifying Setup

### Check if API is running:
```bash
curl https://greene-men-pct-seems.trycloudflare.com/health
```

### List available agents:
```bash
curl https://greene-men-pct-seems.trycloudflare.com/api/registry/agents | jq '.agents[].name'
```

### Check your wallet:
```bash
curl -X POST https://greene-men-pct-seems.trycloudflare.com/api/chatgpt-agent/wallet \
  -H "Content-Type: application/json" \
  -d '{"user_email":"cyrus19901@gmail.com"}' | jq '.wallet.balances'
```

---

## Success Criteria

### Agent-to-Merchant (Shopping) Success:
- ✅ Products are searchable and returned
- ✅ Policy check returns "approved" or "denied" with reason
- ✅ Checkout returns **real Stripe URL** (starts with `https://checkout.stripe.com/`)
- ✅ You can complete payment in Stripe's test mode

### Agent-to-Agent (Services) Success:
- ✅ Agent list is available
- ✅ Service request passes policy checks
- ✅ Solana transaction is created (even if it expires)
- ✅ If successful, returns service result + transaction signature
