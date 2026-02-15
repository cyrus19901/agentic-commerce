#!/bin/bash

# Test API Services Require Approval Policy

echo "🧪 Testing A2A: API Services Require Approval Policy"
echo "================================================="

# Get the user token (assuming user is already created)
TOKEN=$(cat token-user_1771192474243_wljkkvd.txt 2>/dev/null || echo "")

if [ -z "$TOKEN" ]; then
  echo "❌ No token found. Please create a user first."
  exit 1
fi

echo "✓ Using token: ${TOKEN:0:20}..."
echo ""

# Test API call (should require approval)
echo "📞 Testing API service call (serviceType: api-calling)..."
echo "Expected: APPROVAL_REQUIRED"
echo ""

RESPONSE=$(curl -s -X POST http://localhost:3000/api/chatgpt/agent/services/api-calling \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "cost": 0.1,
    "serviceName": "RapidAPI External Call",
    "serviceType": "api-calling"
  }')

echo "$RESPONSE" | jq '.'
echo ""

# Check if response contains APPROVAL_REQUIRED
if echo "$RESPONSE" | grep -q "APPROVAL_REQUIRED\|requiresApproval\|approval required"; then
  echo "✅ SUCCESS: Policy correctly requires approval!"
else
  echo "❌ FAILED: Policy did not require approval"
  echo "Response was: $RESPONSE"
fi
