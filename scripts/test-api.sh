#!/bin/bash

# Test script for Agentic Commerce API

set -e

API_URL="${API_URL:-http://localhost:3000}"
TOKEN="${TOKEN:-}"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🧪 Testing Agentic Commerce API"
echo "================================"
echo ""
echo "API URL: $API_URL"
echo ""

# Test 1: Health Check
echo "Test 1: Health Check"
echo "--------------------"
RESPONSE=$(curl -s "$API_URL/health")
if echo "$RESPONSE" | grep -q "healthy"; then
    echo -e "${GREEN}✓ PASSED${NC}"
    echo "Response: $RESPONSE"
else
    echo -e "${RED}✗ FAILED${NC}"
    echo "Response: $RESPONSE"
    exit 1
fi
echo ""

# Check if token is provided
if [ -z "$TOKEN" ]; then
    echo -e "${YELLOW}⚠ No TOKEN provided. Skipping authenticated tests.${NC}"
    echo ""
    echo "To run authenticated tests:"
    echo "  TOKEN=your-jwt-token ./scripts/test-api.sh"
    echo ""
    echo "Generate a token with:"
    echo "  make generate-token USER=user-123"
    echo ""
    exit 0
fi

# Test 2: Product Search
echo "Test 2: Product Search"
echo "----------------------"
RESPONSE=$(curl -s -X POST "$API_URL/api/products/search" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"query":"leather","max_price":50}')

if echo "$RESPONSE" | grep -q "products"; then
    echo -e "${GREEN}✓ PASSED${NC}"
    PRODUCT_COUNT=$(echo "$RESPONSE" | grep -o '"id"' | wc -l)
    echo "Found $PRODUCT_COUNT products"
else
    echo -e "${RED}✗ FAILED${NC}"
    echo "Response: $RESPONSE"
    exit 1
fi
echo ""

# Test 3: Policy Check
echo "Test 3: Policy Check"
echo "--------------------"
RESPONSE=$(curl -s -X POST "$API_URL/api/policy/check" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "user_id":"user-123",
        "product_id":"mock-1",
        "price":35.99,
        "merchant":"ArtisanLeatherCo",
        "category":"Paper & Party Supplies"
    }')

if echo "$RESPONSE" | grep -q "allowed"; then
    echo -e "${GREEN}✓ PASSED${NC}"
    ALLOWED=$(echo "$RESPONSE" | grep -o '"allowed":[^,}]*' | cut -d':' -f2)
    echo "Policy check result: allowed=$ALLOWED"
else
    echo -e "${RED}✗ FAILED${NC}"
    echo "Response: $RESPONSE"
    exit 1
fi
echo ""

# Test 4: Get Spending
echo "Test 4: Get Spending"
echo "--------------------"
RESPONSE=$(curl -s -X POST "$API_URL/api/policy/spending" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"user_id":"user-123"}')

if echo "$RESPONSE" | grep -q "spending"; then
    echo -e "${GREEN}✓ PASSED${NC}"
    echo "Response: $RESPONSE"
else
    echo -e "${RED}✗ FAILED${NC}"
    echo "Response: $RESPONSE"
    exit 1
fi
echo ""

# Test 5: Checkout Initiate
echo "Test 5: Checkout Initiate"
echo "-------------------------"
RESPONSE=$(curl -s -X POST "$API_URL/api/checkout/initiate" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "user_id":"user-123",
        "product_id":"mock-1",
        "amount":35.99,
        "merchant":"ArtisanLeatherCo"
    }')

if echo "$RESPONSE" | grep -q "checkout_session_id"; then
    echo -e "${GREEN}✓ PASSED${NC}"
    SESSION_ID=$(echo "$RESPONSE" | grep -o '"checkout_session_id":"[^"]*"' | cut -d'"' -f4)
    echo "Session ID: $SESSION_ID"
else
    echo -e "${RED}✗ FAILED${NC}"
    echo "Response: $RESPONSE"
    exit 1
fi
echo ""

# Test 6: Checkout Complete
echo "Test 6: Checkout Complete"
echo "-------------------------"
RESPONSE=$(curl -s -X POST "$API_URL/api/checkout/complete" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"session_id\":\"$SESSION_ID\",
        \"user_id\":\"user-123\"
    }")

if echo "$RESPONSE" | grep -q "completed"; then
    echo -e "${GREEN}✓ PASSED${NC}"
    echo "Response: $RESPONSE"
else
    echo -e "${RED}✗ FAILED${NC}"
    echo "Response: $RESPONSE"
    exit 1
fi
echo ""

echo "================================"
echo -e "${GREEN}✅ All tests passed!${NC}"
echo "================================"
echo ""

