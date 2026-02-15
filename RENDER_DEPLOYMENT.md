# Render Deployment Guide

## 🚀 Deploy Latest Changes

### 1. Update Render Service

Go to your Render dashboard:
1. Navigate to your service (agentic-commerce)
2. Go to **Settings** → **Build & Deploy**
3. Change branch from `main` to `feat/a2a` (or merge feat/a2a to main first)
4. Click **Manual Deploy** → **Deploy latest commit**

### 2. Verify Database Setup

After deployment completes, verify the database has all policies and agents:

```bash
# Check Render logs for database setup
# Look for lines like:
# ✓ Database setup complete
# ✓ Seeded 4 agents
# ✓ Seeded 7 policies
```

### 3. Manual Database Reset (if needed)

If policies are missing, run the database setup script:

**Option A: Via Render Shell**
1. Go to your Render service dashboard
2. Click **Shell** tab
3. Run:
```bash
cd /app
node packages/database/src/setup.js
```

**Option B: Via API Call**
```bash
curl -X POST https://your-render-url.onrender.com/api/admin/reset-database
```

### 4. Test Endpoints

Once deployed, test with your Render URL:

```bash
# Replace YOUR_RENDER_URL with your actual URL
export RENDER_URL="https://your-service.onrender.com"

# 1. Health check
curl $RENDER_URL/health

# 2. List agents
curl "$RENDER_URL/api/chatgpt-agent/agents" \
  -H "User-Email: test@render.com"

# 3. Create test user
curl "$RENDER_URL/api/auth/create-user" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@render.com",
    "name": "Render Test User"
  }'

# 4. Get wallet info
curl "$RENDER_URL/api/chatgpt-agent/wallet" \
  -H "Content-Type: application/json" \
  -d '{"user_email": "test@render.com"}'

# 5. Test agent service request (will fail with INSUFFICIENT_FUNDS until funded)
curl "$RENDER_URL/api/chatgpt-agent/request-service" \
  -H "Content-Type: application/json" \
  -d '{
    "user_email": "test@render.com",
    "agentId": "agent://apify.com/web-scraper/v1",
    "serviceType": "data-scraping",
    "parameters": {
      "url": "https://example.com",
      "extractFields": ["title"]
    }
  }'
```

### 5. Update ChatGPT Schema

Update your ChatGPT Actions schema:

1. Copy the contents of `docs/gpt-action-schema-seamless.yaml`
2. Update the `servers` section with your Render URL:
   ```yaml
   servers:
     - url: https://your-service.onrender.com
       description: Agentic Commerce Platform on Render
   ```
3. In ChatGPT:
   - Go to your GPT settings
   - Click **Actions**
   - Paste the updated schema
   - Set **Authentication** to **None**
   - Click **Save**

### 6. Verify Policies in Render

Check that all policies are created:

```bash
# List all policies
curl "$RENDER_URL/api/admin/policies"

# Expected policies:
# - policy-agent-budget-001 (Monthly spending limit)
# - policy-agent-service-002 (Service type restrictions)
# - policy-agent-recipient-003 (Recipient blocklist)
# - policy-agent-approval-004 (Approval threshold)
# - policy-stripe-merchant-001 (Merchant spending limit)
# - policy-stripe-category-002 (Category restrictions)
# - policy-stripe-approval-003 (Approval threshold)
```

## 🔍 Troubleshooting

### Issue: "No policies configured for agent-to-agent transactions"

**Solution:**
```bash
# Reset database via Render Shell
cd /app
node packages/database/src/setup.js
```

### Issue: Database file not persisting

**Solution:**
1. Verify Render persistent disk is mounted at `/app/data`
2. Check `DATABASE_PATH` env var is set to `/app/data/shopping.db`
3. Restart service

### Issue: Wallet creation fails

**Solution:**
Check Render logs for Solana connection errors. Verify:
- `SOLANA_CLUSTER=devnet` is set
- `ALCHEMY_RPC_URL` is set correctly

## 📝 Environment Variables on Render

Make sure these are set:

```
DATABASE_PATH=/app/data/shopping.db
SOLANA_CLUSTER=devnet
ALCHEMY_RPC_URL=https://solana-devnet.g.alchemy.com/v2/YOUR_KEY
JWT_SECRET=your-secret-key
API_URL=https://your-service.onrender.com
STRIPE_SECRET_KEY=sk_test_...
```

## ✅ Deployment Checklist

- [ ] Pushed latest changes to `feat/a2a` branch
- [ ] Deployed on Render (branch: feat/a2a)
- [ ] Verified database setup in logs
- [ ] All policies created (7 policies expected)
- [ ] All agents seeded (4 agents expected)
- [ ] Test user created successfully
- [ ] Wallet auto-created for test user
- [ ] Updated ChatGPT schema with Render URL
- [ ] Tested agent service request

## 🎯 Next Steps

After deployment is verified:
1. Test in ChatGPT with Render URL
2. Fund a test wallet for full end-to-end testing
3. Monitor Render logs for any errors
4. Once stable, merge `feat/a2a` to `main`
