#!/bin/bash

# Agent-to-Agent Policy Testing Script
# Tests all a2a policies with different scenarios

TUNNEL_URL="${TUNNEL_URL:-https://send-analyses-arranged-trainer.trycloudflare.com}"
EMAIL="${TEST_EMAIL:-simple-test-1771186302@example.com}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

function print_header() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${BLUE}$1${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

function test_service() {
    local test_name="$1"
    local agent_id="$2"
    local service_type="$3"
    local expected_result="$4"
    
    echo -e "${YELLOW}Testing:${NC} $test_name"
    echo "  Agent: $agent_id"
    echo "  Service: $service_type"
    echo "  Expected: $expected_result"
    echo ""
    
    RESPONSE=$(curl -s "${TUNNEL_URL}/api/chatgpt-agent/request-service" \
        -H 'Content-Type: application/json' \
        -d "{\"user_email\": \"${EMAIL}\", \"agentId\": \"${agent_id}\", \"serviceType\": \"${service_type}\", \"parameters\": {\"url\": \"https://example.com\"}}")
    
    SUCCESS=$(echo $RESPONSE | jq -r '.success // empty')
    ERROR=$(echo $RESPONSE | jq -r '.error // empty')
    REASON=$(echo $RESPONSE | jq -r '.reason // empty')
    
    if [ "$ERROR" = "POLICY_VIOLATION" ]; then
        echo -e "${RED}✗ BLOCKED${NC} - Policy violation"
        echo "  Reason: $REASON"
        POLICIES=$(echo $RESPONSE | jq -r '.matchedPolicies[].name' | head -1)
        echo "  Policy: $POLICIES"
    elif [ "$ERROR" = "APPROVAL_REQUIRED" ]; then
        echo -e "${YELLOW}⏸ APPROVAL REQUIRED${NC}"
        echo "  Reason: $REASON"
        POLICIES=$(echo $RESPONSE | jq -r '.matchedPolicies[].name' | head -1)
        echo "  Policy: $POLICIES"
    elif [ "$SUCCESS" = "true" ]; then
        echo -e "${GREEN}✓ APPROVED${NC}"
        BALANCE=$(echo $RESPONSE | jq -r '.wallet.remainingBalance')
        TXID=$(echo $RESPONSE | jq -r '.payment.txSignature' | cut -c1-16)
        echo "  Balance: $BALANCE USDC"
        echo "  TX: $TXID..."
    elif [ "$ERROR" = "INSUFFICIENT_FUNDS" ]; then
        echo -e "${RED}✗ INSUFFICIENT FUNDS${NC}"
        echo "  Please fund your wallet first"
    else
        echo -e "${RED}✗ ERROR${NC}: $ERROR"
    fi
    
    echo ""
    sleep 1
}

# Main test suite
print_header "🧪 Agent-to-Agent Policy Testing Suite"

echo "Tunnel URL: $TUNNEL_URL"
echo "Test User: $EMAIL"
echo ""
read -p "Press Enter to start testing..."

# Test 1: Web Scraping Service (should work if under $5)
print_header "Test 1: Web Scraping Service ($0.10)"
test_service \
    "Normal scraping request" \
    "agent://apify.com/web-scraper/v1" \
    "data-scraping" \
    "SUCCESS"

# Test 2: API Service (should require approval)
print_header "Test 2: API Service (Requires Approval)"
test_service \
    "API calling service" \
    "agent://rapidapi.com/api-caller" \
    "api-call" \
    "APPROVAL_REQUIRED"

# Test 3: Blocked Agent (should be denied)
print_header "Test 3: Blocked/Untrusted Agent"
test_service \
    "Payment to blocked agent" \
    "agent://untrusted.com/service" \
    "data-scraping" \
    "DENIED"

# Test 4: Data Analysis Service
print_header "Test 4: Data Analysis Service"
test_service \
    "Data analysis request" \
    "agent://wolfram.com/compute" \
    "data-analysis" \
    "SUCCESS or APPROVAL"

# Test 5: Cheap Service (should auto-approve)
print_header "Test 5: Cheap Service Under $0.50"
echo "Note: Current service is $0.10, should auto-approve"
test_service \
    "Cheap service auto-approval" \
    "agent://apify.com/web-scraper/v1" \
    "data-scraping" \
    "SUCCESS"

# Test 6: Multiple requests to same agent (test daily limit)
print_header "Test 6: Daily Limit Per Agent ($5)"
echo "Making 10 requests to same agent ($1 total)..."
for i in {1..10}; do
    echo -n "Request $i... "
    RESPONSE=$(curl -s "${TUNNEL_URL}/api/chatgpt-agent/request-service" \
        -H 'Content-Type: application/json' \
        -d "{\"user_email\": \"${EMAIL}\", \"agentId\": \"agent://apify.com/web-scraper/v1\", \"serviceType\": \"data-scraping\"}")
    
    ERROR=$(echo $RESPONSE | jq -r '.error // empty')
    if [ "$ERROR" = "POLICY_VIOLATION" ] || [ "$ERROR" = "APPROVAL_REQUIRED" ]; then
        echo -e "${RED}BLOCKED${NC}"
        echo "  Reason: $(echo $RESPONSE | jq -r '.reason')"
        break
    else
        echo -e "${GREEN}OK${NC}"
    fi
    sleep 0.5
done

# Test 7: Scraping daily limit ($10)
print_header "Test 7: Scraping Daily Limit Test"
echo "Current scraping daily limit: $10"
echo "You've spent: (check your balance)"
BALANCE_RESPONSE=$(curl -s "${TUNNEL_URL}/api/chatgpt-agent/wallet" \
    -H 'Content-Type: application/json' \
    -d "{\"user_email\": \"${EMAIL}\"}")
BALANCE=$(echo $BALANCE_RESPONSE | jq -r '.wallet.balances.usdc')
echo "Current USDC Balance: $BALANCE"

print_header "✅ Test Suite Complete"
echo ""
echo "Summary:"
echo "  ✓ = Transaction approved"
echo "  ⏸ = Approval required (manager review)"
echo "  ✗ = Blocked by policy"
echo ""
echo "Check the responses above to see which policies triggered!"
