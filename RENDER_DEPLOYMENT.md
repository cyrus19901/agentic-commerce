# Deploy to Render

This guide will walk you through deploying the Agentic Commerce API to Render.

## Prerequisites

1. **Render Account**: Sign up at [render.com](https://render.com)
2. **GitHub Repository**: Push your code to GitHub
3. **Stripe Account** (for payments): Get your API keys from [stripe.com/dashboard](https://dashboard.stripe.com/apikeys)

## Step 1: Push to GitHub

```bash
cd /Users/cyrus19901/Repository/agentic-commerce
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

## Step 2: Create New Web Service on Render

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository: `agentic-commerce`
4. Render will automatically detect the `render.yaml` file

## Step 3: Configure Environment Variables

Render will automatically set most variables from `render.yaml`, but you need to manually add these sensitive keys:

### In Render Dashboard → Environment Tab:

1. **STRIPE_SECRET_KEY**
   - Value: `sk_test_...` (from [Stripe Dashboard](https://dashboard.stripe.com/test/apikeys))
   - For production: use `sk_live_...`

2. **STRIPE_PUBLISHABLE_KEY**
   - Value: `pk_test_...` (from Stripe Dashboard)
   - For production: use `pk_live_...`

3. **SOLANA_RPC_MAINNET** (Optional, only if using mainnet)
   - Value: Your Alchemy or QuickNode mainnet RPC URL
   - Example: `https://solana-mainnet.g.alchemy.com/v2/YOUR_KEY`

### Auto-configured by render.yaml:
- ✅ `PORT=3000`
- ✅ `NODE_ENV=production`
- ✅ `DATABASE_URL=/data/shopping.db`
- ✅ `JWT_SECRET` (auto-generated)
- ✅ `SOLANA_CLUSTER=devnet`
- ✅ `SOLANA_RPC_DEVNET` (Alchemy devnet)
- ✅ `USE_MOCK_PAYMENTS=false`

## Step 4: Update API_URL After Deployment

1. After deployment completes, Render will give you a URL like:
   ```
   https://agentic-commerce-api.onrender.com
   ```

2. Go back to **Environment** tab and update:
   - Key: `API_URL`
   - Value: `https://agentic-commerce-api.onrender.com` (your actual URL)

3. Click **"Manual Deploy"** → **"Clear build cache & deploy"**

## Step 5: Initialize Database

Once deployed, the database will be automatically initialized on first startup via the `docker-entrypoint.sh` script.

To verify:
```bash
# Check logs in Render Dashboard
# You should see: "✅ Database setup complete!"
```

## Step 6: Create a Test User

Use the deployed API to create a test user:

```bash
curl -X POST https://agentic-commerce-api.onrender.com/api/auth/create-user \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@example.com",
    "name": "Test User"
  }'
```

**Save the token from the response!**

## Step 7: Configure ChatGPT

1. Go to [ChatGPT GPT Builder](https://chat.openai.com/gpts/editor)
2. Create or edit your GPT
3. In **Actions** section:
   - Import schema from: `docs/gpt-action-schema-seamless.yaml`
   - Update the `servers` section with your Render URL:
     ```yaml
     servers:
       - url: https://agentic-commerce-api.onrender.com
         description: Production API on Render
     ```
4. In **Authentication**:
   - Type: **API Key**
   - Auth Type: **Bearer**
   - API Key: Use the token from Step 6

## Architecture on Render

```
┌─────────────────────────────────────┐
│   Render Web Service                │
│   (Docker Container)                │
│                                     │
│   ┌─────────────────────────────┐  │
│   │  Node.js API (Port 3000)    │  │
│   │  - Express Server           │  │
│   │  - Policy Engine            │  │
│   │  - Stripe Integration       │  │
│   │  - Solana Wallet Manager    │  │
│   └─────────────────────────────┘  │
│                                     │
│   ┌─────────────────────────────┐  │
│   │  Persistent Disk (/data)    │  │
│   │  - shopping.db (SQLite)     │  │
│   │  - User wallets             │  │
│   │  - Transaction history      │  │
│   └─────────────────────────────┘  │
└─────────────────────────────────────┘
         ↑                    ↑
         │                    │
    ChatGPT              Solana Devnet
    Actions              (via Alchemy RPC)
```

## Important Notes

### Database Persistence
- Your SQLite database is stored on a **persistent disk** at `/data`
- Data survives deployments and restarts
- Disk size: 1GB (configurable in `render.yaml`)

### Free Tier Limitations
- **Spin-down after 15 minutes** of inactivity
- First request after spin-down takes ~30-60 seconds (cold start)
- **750 hours/month** free compute time

### Production Recommendations
1. **Upgrade to Paid Plan** ($7/month) for:
   - No spin-down
   - Faster builds
   - Better performance

2. **Use Mainnet for Real Payments**:
   - Set `SOLANA_CLUSTER=mainnet-beta`
   - Add `SOLANA_RPC_MAINNET` with production RPC
   - Use Stripe live keys (`sk_live_...`)

3. **Set up Monitoring**:
   - Enable Render's built-in logging
   - Set up health check alerts

## Troubleshooting

### Database not initializing?
Check logs in Render Dashboard. The entrypoint script should show:
```
🔧 Setting up database...
✅ Database setup complete!
```

### Cold starts taking too long?
- Upgrade to paid plan to eliminate spin-down
- Or keep service warm with a scheduled ping (using cron-job.org)

### Stripe webhooks not working?
- Configure webhook endpoint in Stripe Dashboard:
  ```
  https://your-app.onrender.com/api/stripe/webhook
  ```

### Need to reset database?
Delete the persistent disk and redeploy (⚠️ destroys all data)

## Testing Deployment

```bash
# 1. Health check
curl https://agentic-commerce-api.onrender.com/health

# 2. List agents
curl https://agentic-commerce-api.onrender.com/api/registry/agents

# 3. Test with ChatGPT
"Show me my wallet balance"
```

## Updating Your Deployment

```bash
# Push changes to GitHub
git add .
git commit -m "Update feature"
git push origin main

# Render will auto-deploy on push
# Or trigger manually in Render Dashboard
```

## Cost Estimate

- **Free Tier**: $0/month (with spin-down)
- **Starter Plan**: $7/month (no spin-down, better performance)
- **Additional costs**:
  - Persistent disk: Included in plan
  - Bandwidth: Included (100GB/month on free tier)

## Support

- [Render Documentation](https://render.com/docs)
- [Render Community Forum](https://community.render.com)
- Check logs in Render Dashboard for errors
