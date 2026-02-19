#!/bin/bash

echo "🧪 Testing Agentic Commerce Flow"
echo "================================="
echo ""

# Test user
USER_EMAIL="cyrus19901@gmail.com"
API_URL="http://localhost:3001"

echo "1️⃣  Testing Policy Check (Read-Only - Should NOT record)"
echo "--------------------------------------------------------"
POLICY_CHECK=$(curl -s -X POST "${API_URL}/api/policy/check" \
  -H "Content-Type: application/json" \
  -d '{
    "user_email": "'${USER_EMAIL}'",
    "product_id": "test-product-1",
    "price": 50,
    "merchant": "Test Merchant",
    "category": "Office Supplies",
    "transaction_type": "agent-to-merchant"
  }')

echo "Policy Check Response:"
echo "$POLICY_CHECK" | jq .
echo ""

echo "2️⃣  Testing Agent-to-Merchant Checkout (Should record transaction)"
echo "--------------------------------------------------------------------"
A2M_CHECKOUT=$(curl -s -X POST "${API_URL}/api/checkout/initiate" \
  -H "Content-Type: application/json" \
  -d '{
    "user_email": "'${USER_EMAIL}'",
    "product_id": "test-notebook",
    "product_name": "Professional Notebook",
    "amount": 25.99,
    "merchant": "Staples",
    "category": "Office Supplies",
    "transaction_type": "agent-to-merchant"
  }')

echo "A2M Checkout Response:"
echo "$A2M_CHECKOUT" | jq .
echo ""

echo "3️⃣  Testing Agent-to-Agent Service Purchase (Should record transaction)"
echo "-------------------------------------------------------------------------"
A2A_CHECKOUT=$(curl -s -X POST "${API_URL}/api/checkout/initiate" \
  -H "Content-Type: application/json" \
  -d '{
    "user_email": "'${USER_EMAIL}'",
    "product_id": "translation-api",
    "product_name": "Translation API Service",
    "amount": 15.50,
    "merchant": "AI Services Inc",
    "category": "AI Services",
    "transaction_type": "agent-to-agent",
    "service_type": "Translation API",
    "recipient_agent": "TranslationBot"
  }')

echo "A2A Checkout Response:"
echo "$A2A_CHECKOUT" | jq .
echo ""

echo "4️⃣  Verifying Dashboard Data"
echo "-----------------------------"
DASHBOARD=$(curl -s -X POST "${API_URL}/api/dashboard" \
  -H "Content-Type: application/json" \
  -d '{"user_email": "'${USER_EMAIL}'", "period": "daily"}')

echo "Dashboard Response:"
echo "$DASHBOARD" | jq '.spending, .spendingByType, .spendingByCategory'
echo ""

echo "5️⃣  Checking Purchase History"
echo "------------------------------"
HISTORY=$(curl -s -X POST "${API_URL}/api/purchases" \
  -H "Content-Type: application/json" \
  -d '{"user_email": "'${USER_EMAIL}'"}')

echo "Recent Purchases:"
echo "$HISTORY" | jq '.purchases | .[] | {timestamp, amount, merchant, category, transaction_type, allowed}'
echo ""

echo "✅ Flow test completed!"
