#!/bin/bash

# Render Setup Verification Script
# Usage: ./scripts/verify-render-setup.sh https://your-service.onrender.com

RENDER_URL="${1:-https://agentic-commerce.onrender.com}"

echo "🔍 Verifying Render Deployment"
echo "URL: $RENDER_URL"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Health Check
echo "1️⃣  Checking health endpoint..."
HEALTH=$(curl -s "$RENDER_URL/health")
if echo "$HEALTH" | grep -q "healthy"; then
    echo -e "${GREEN}✓${NC} Health check passed"
else
    echo -e "${RED}✗${NC} Health check failed"
    echo "Response: $HEALTH"
fi
echo ""

# 2. Check Agents
echo "2️⃣  Checking agents..."
AGENTS=$(curl -s "$RENDER_URL/api/registry/agents?user_email=test@verify.com")
AGENT_COUNT=$(echo "$AGENTS" | jq -r '.agents | length' 2>/dev/null)
if [ "$AGENT_COUNT" = "4" ]; then
    echo -e "${GREEN}✓${NC} Found 4 agents"
    echo "$AGENTS" | jq -r '.agents[] | "  - \(.agentId): \(.name)"'
else
    echo -e "${RED}✗${NC} Expected 4 agents, found: $AGENT_COUNT"
    echo "Response: $AGENTS"
fi
echo ""

# 3. Create Test User
echo "3️⃣  Creating test user..."
USER_RESPONSE=$(curl -s "$RENDER_URL/api/auth/create-user" \
    -H "Content-Type: application/json" \
    -d '{
        "email": "verify@render.com",
        "name": "Verification Test User"
    }')

USER_EMAIL=$(echo "$USER_RESPONSE" | jq -r '.user.email' 2>/dev/null)
if [ "$USER_EMAIL" = "verify@render.com" ]; then
    echo -e "${GREEN}✓${NC} Test user created/retrieved"
    WALLET_KEY=$(echo "$USER_RESPONSE" | jq -r '.user.wallet.publicKey' 2>/dev/null)
    if [ "$WALLET_KEY" != "null" ] && [ "$WALLET_KEY" != "" ]; then
        echo -e "${GREEN}✓${NC} Wallet auto-created: $WALLET_KEY"
    else
        echo -e "${YELLOW}⚠${NC} Wallet not created"
    fi
else
    echo -e "${RED}✗${NC} User creation failed"
    echo "Response: $USER_RESPONSE"
fi
echo ""

# 4. Check Wallet Endpoint
echo "4️⃣  Checking wallet endpoint..."
WALLET=$(curl -s "$RENDER_URL/api/chatgpt-agent/wallet" \
    -H "Content-Type: application/json" \
    -d '{"user_email": "verify@render.com"}')

WALLET_PUBLIC_KEY=$(echo "$WALLET" | jq -r '.wallet.publicKey' 2>/dev/null)
if [ "$WALLET_PUBLIC_KEY" != "null" ] && [ "$WALLET_PUBLIC_KEY" != "" ]; then
    echo -e "${GREEN}✓${NC} Wallet retrieved: $WALLET_PUBLIC_KEY"
    TOKEN_ACCOUNT=$(echo "$WALLET" | jq -r '.wallet.tokenAccount' 2>/dev/null)
    echo "  Token Account: $TOKEN_ACCOUNT"
    USDC_BALANCE=$(echo "$WALLET" | jq -r '.wallet.balances.usdc' 2>/dev/null)
    echo "  USDC Balance: $USDC_BALANCE"
else
    echo -e "${RED}✗${NC} Wallet retrieval failed"
    echo "Response: $WALLET"
fi
echo ""

# 5. Test Service Request (expect INSUFFICIENT_FUNDS)
echo "5️⃣  Testing agent service request..."
SERVICE=$(curl -s "$RENDER_URL/api/chatgpt-agent/request-service" \
    -H "Content-Type: application/json" \
    -d '{
        "user_email": "verify@render.com",
        "agentId": "agent://apify.com/web-scraper/v1",
        "serviceType": "data-scraping",
        "parameters": {
            "url": "https://example.com",
            "extractFields": ["title"]
        }
    }')

ERROR_TYPE=$(echo "$SERVICE" | jq -r '.error' 2>/dev/null)
if [ "$ERROR_TYPE" = "INSUFFICIENT_FUNDS" ]; then
    echo -e "${GREEN}✓${NC} Service request works (INSUFFICIENT_FUNDS is expected)"
    REQUIRED=$(echo "$SERVICE" | jq -r '.service.estimatedCost' 2>/dev/null)
    echo "  Required: $REQUIRED USDC"
elif [ "$ERROR_TYPE" = "POLICY_VIOLATION" ]; then
    echo -e "${RED}✗${NC} Policy violation - policies may be misconfigured"
    echo "Response: $SERVICE"
elif [ "$ERROR_TYPE" = "NO_POLICY" ] || echo "$SERVICE" | grep -q "No policies"; then
    echo -e "${RED}✗${NC} NO POLICIES FOUND - Database needs setup!"
    echo "Response: $SERVICE"
    echo ""
    echo "Run this in Render Shell:"
    echo "  cd /app && node packages/database/src/setup.js"
else
    echo -e "${YELLOW}⚠${NC} Unexpected response"
    echo "Response: $SERVICE"
fi
echo ""

# 6. Summary
echo "📊 Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if echo "$AGENTS" | grep -q "apify" && [ "$WALLET_PUBLIC_KEY" != "null" ] && [ "$ERROR_TYPE" = "INSUFFICIENT_FUNDS" ]; then
    echo -e "${GREEN}✓${NC} Render deployment is working correctly!"
    echo ""
    echo "Next steps:"
    echo "  1. Update ChatGPT schema with: $RENDER_URL"
    echo "  2. Fund wallet: $WALLET_PUBLIC_KEY"
    echo "  3. Test in ChatGPT"
elif [ "$ERROR_TYPE" = "NO_POLICY" ] || echo "$SERVICE" | grep -q "No policies"; then
    echo -e "${RED}✗${NC} Database setup incomplete"
    echo ""
    echo "Fix by running in Render Shell:"
    echo "  cd /app && node packages/database/src/setup.js"
else
    echo -e "${YELLOW}⚠${NC} Some issues detected - review output above"
fi
