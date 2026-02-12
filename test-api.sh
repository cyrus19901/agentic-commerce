#!/bin/bash
# Complete API testing script with authentication

echo "🔑 Generating JWT Token..."
TOKEN=$(docker exec agentic-commerce-api-1 node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { userId: 'test-user', email: 'test@example.com' },
  process.env.JWT_SECRET || 'your-secret-key',
  { expiresIn: '7d' }
);
console.log(token);
")

echo "✅ Token: $TOKEN"
echo ""

# Test 1: Health check (no auth required)
echo "📊 Test 1: Health Check"
curl -s http://localhost:3000/health | jq '.'
echo ""

# Test 2: Policy check with token
echo "📋 Test 2: Policy Check (agent-to-merchant)"
curl -s -X POST http://localhost:3000/api/policy/check \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test-user",
    "product_id": "prod-laptop-001",
    "price": 50.00,
    "merchant": "Apple Store",
    "category": "Electronics",
    "transactionType": "agent-to-merchant"
  }' | jq '.'
echo ""

# Test 3: Register an agent
echo "🤖 Test 3: Register Agent"
curl -s -X POST http://localhost:3000/api/registry/agents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent://test-scraper/v1",
    "name": "Test Web Scraper",
    "baseUrl": "http://localhost:4001",
    "services": ["scrape", "extract"],
    "serviceDescription": "Web scraping and data extraction",
    "acceptedCurrencies": ["USDC"],
    "usdcTokenAccount": "test-usdc-account-123",
    "solanaPubkey": "test-solana-pubkey-456"
  }' | jq '.'
echo ""

# Test 4: List agents
echo "📋 Test 4: List Registered Agents"
curl -s http://localhost:3000/api/registry/agents | jq '.'
echo ""

# Test 5: Agent service (should get 402)
echo "⚡ Test 5: Request Agent Service (expect 402)"
curl -X POST http://localhost:3000/api/agent/services/scrape \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' \
  -v 2>&1 | grep -A 10 "HTTP/"
echo ""

echo "✅ All tests complete!"
echo ""
echo "💡 Your JWT Token (valid for 7 days):"
echo "export JWT_TOKEN=\"$TOKEN\""
