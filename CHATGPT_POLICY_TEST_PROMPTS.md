# ChatGPT A2A Policy Testing Prompts

## ⚠️ Prerequisites

1. **Database must persist on Render**: Add persistent disk at `/app/data`
2. **Fund your wallet with USDC**: ~10 USDC for testing
3. **Set env var**: `USDC_TOKEN_ACCOUNT=6kzEhPaeXQBcCJwGN8xK3VSyfUpVPU39gdw1KAj9ymru`

## 🧪 Policy Test Prompts for ChatGPT

### ✅ Test 1: Normal Web Scraping (Should Work)

**Prompt:**
```
Use the Apify web scraper to extract data from https://example.com
```

**Expected Result:** 
- ✅ Transaction succeeds
- Costs: $0.10 USDC
- Policy: Passes all checks

**Which Policies Apply:**
- ✅ Web Scraping Services - $5 Limit (under limit)
- ✅ Auto-Approve Services Under $0.50 (auto-approved)
- ✅ Business Hours Only (if during business hours)

---

### ⏸ Test 2: API Calling Service (Should Require Approval)

**Prompt:**
```
Use the RapidAPI service to call an external API with service type "api-calling"
```

**Expected Result:**
- ⏸ **APPROVAL_REQUIRED**
- Policy triggered: "A2A: API Services Require Approval"
- Reason: "All API calling services require manager approval"

**Which Policies Apply:**
- 🚫 A2A: API Services Require Approval → **BLOCKS** (requires approval)

---

### 💰 Test 3: Hit Daily Scraping Limit ($10/day)

**Prompt:**
```
Use the Apify web scraper to scrape 101 different websites one by one
```

**Expected Result:**
- ✅ First ~99 requests succeed ($9.90 spent)
- 🚫 Request #100+ blocked
- Policy: "A2A: Scraping Daily Limit - $10"
- Reason: "Daily scraping budget of $10.00 exceeded"

---

### 💳 Test 4: Hit Per-Agent Limit ($5 per agent per day)

**Prompt:**
```
Use the Browse.ai web scraper to extract data from 51 different websites
```

**Expected Result:**
- ✅ First 49 requests succeed ($4.90 to Browse.ai)
- 🚫 Request #50+ blocked or requires approval
- Policy: "A2A: $5 Daily Limit Per Agent"
- Reason: "Daily spending limit of $5.00 for this agent exceeded"

---

### 📊 Test 5: Data Analysis Service

**Prompt:**
```
Use Wolfram compute engine to analyze some data for me
```

**Expected Result:**
- ✅ or ⏸ Depends on amount and monthly budget
- Policy: "A2A: Data Analysis Monthly Budget - $50"

---

### 🚫 Test 6: Block Specific Service Types

To test service-specific blocking, try different serviceTypes:

**Scraping (should work):**
```
Scrape https://news.ycombinator.com using the web scraper
```

**API calling (should require approval):**
```
Make an API call to get GitHub user data using RapidAPI
```

**Data analysis:**
```
Analyze this dataset using computational services
```

---

## 🔍 Verify Policy Assignments

**Prompt to check your policies:**
```
What policies are currently active for my account?
```

ChatGPT should show you all 30 policies assigned to your user.

---

## 📋 Expected Policy Outcomes

### Service Types & Their Policies

| Service Type | Policy | Action |
|-------------|--------|--------|
| `data-scraping` | Web Scraping - $5 Limit | ✅ Allow (if < $5) |
| `data-scraping` | Scraping Daily Limit | 🚫 Block (if > $10/day) |
| `api-calling` | API Services Require Approval | ⏸ Require Approval |
| `api-call` | API Services Require Approval | ⏸ Require Approval |
| `external-api` | API Services Require Approval | ⏸ Require Approval |
| `data-analysis` | Data Analysis Budget | 🚫 Block (if > $50/month) |
| `computation` | Data Analysis Budget | 🚫 Block (if > $50/month) |
| Any service | Services Over $2 | ⏸ Require Approval (if > $2) |
| Any service | Auto-Approve Under $0.50 | ✅ Auto-approve (if < $0.50) |

### Blocked Agents

These agents should always be denied:
- `agent://untrusted.com/service`
- `agent://suspicious-bot.io/scraper`
- `agent://blocked-agent.xyz`

---

## 🐛 Troubleshooting

### If API calls aren't blocked:

1. **Check deployment status**: Ensure Render has deployed commit `8a3787b`
2. **Check service type**: API call might use different serviceType than expected
3. **Enable debug logging**: Check Render logs for policy evaluation

### If all services are blocked:

1. Check "Business Hours Only" policy (only allows 9 AM - 5 PM weekdays)
2. Check if user has policies assigned
3. Verify wallet has USDC balance

---

## 🔧 Direct API Tests (for debugging)

Test policies directly via API:

```bash
# Test 1: Scraping (should pass)
curl -s 'https://agentic-commerce-79fc.onrender.com/api/chatgpt-agent/request-service' \
  -H 'Content-Type: application/json' \
  -d '{"user_email": "YOUR_EMAIL", "agentId": "agent://apify.com/web-scraper/v1", "serviceType": "data-scraping"}'

# Test 2: API calling (should require approval)  
curl -s 'https://agentic-commerce-79fc.onrender.com/api/chatgpt-agent/request-service' \
  -H 'Content-Type: application/json' \
  -d '{"user_email": "YOUR_EMAIL", "agentId": "agent://rapidapi.com/api-proxy/v1", "serviceType": "api-calling"}'

# Test 3: Check what serviceType ChatGPT used
# Look in Render logs for lines like:
# 🔍 PolicyService: Checking policies for serviceType: XXXXX
```

---

## 💡 Why Your API Call Went Through

Possible reasons:
1. **ServiceType mismatch**: ChatGPT might have sent `serviceType: "external-api"` or another value
2. **Old code**: Render might not have the serviceType condition check deployed yet
3. **Policy not applied**: User might not have that specific policy assigned

**Next Step:** Check Render logs during the next ChatGPT request to see what serviceType is being sent!
