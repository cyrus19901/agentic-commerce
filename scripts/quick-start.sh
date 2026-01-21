#!/bin/bash

set -e

echo "🚀 Agentic Commerce - Quick Start Script"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    echo ""
    echo "Please install Docker Desktop from:"
    echo "  https://www.docker.com/products/docker-desktop"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓${NC} Docker is installed"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running${NC}"
    echo ""
    echo "Please start Docker Desktop and try again."
    echo ""
    echo "On macOS: Open Docker Desktop from Applications"
    echo "On Windows: Start Docker Desktop from Start Menu"
    echo "On Linux: Run 'sudo systemctl start docker'"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓${NC} Docker is running"

# Detect docker compose command
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    DOCKER_COMPOSE="docker compose"
fi

echo -e "${GREEN}✓${NC} Using: $DOCKER_COMPOSE"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo -e "${GREEN}✓${NC} Created .env file"
else
    echo -e "${GREEN}✓${NC} .env file exists"
fi

echo ""
echo "🔨 Building Docker images..."
echo "   (This may take a few minutes on first run)"
echo ""

$DOCKER_COMPOSE -f docker-compose.dev.yml build

echo ""
echo -e "${GREEN}✓${NC} Docker images built successfully"
echo ""
echo "🚀 Starting containers..."
echo ""

$DOCKER_COMPOSE -f docker-compose.dev.yml up -d

echo ""
echo "⏳ Waiting for API to be ready..."
sleep 5

# Wait for API to be healthy
MAX_RETRIES=30
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -s http://localhost:3000/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} API is ready!"
        break
    fi
    echo -n "."
    sleep 2
    RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo ""
    echo -e "${RED}❌ API did not start in time${NC}"
    echo ""
    echo "Check logs with: make dev-logs"
    exit 1
fi

echo ""
echo "📦 Setting up database..."
$DOCKER_COMPOSE -f docker-compose.dev.yml exec -T api npm run db:setup

echo ""
echo "🔑 Generating JWT token..."
echo ""
TOKEN_OUTPUT=$($DOCKER_COMPOSE -f docker-compose.dev.yml exec -T api npm run generate-token user-123 2>/dev/null)
TOKEN=$(echo "$TOKEN_OUTPUT" | grep "Token:" | awk '{print $2}' | tr -d '\r\n')

echo ""
echo "=========================================="
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "📍 Services Running:"
echo "   • API:        http://localhost:3000"
echo "   • Health:     http://localhost:3000/health"
echo "   • DB Viewer:  http://localhost:8080"
echo ""
echo "🔑 Your JWT Token:"
echo "   $TOKEN"
echo ""
echo "📋 Next Steps:"
echo ""
echo "   1. Test the API:"
echo "      curl http://localhost:3000/health"
echo ""
echo "   2. Configure ChatGPT GPT:"
echo "      • Go to https://chat.openai.com/gpts/editor"
echo "      • Follow instructions in docs/chatgpt-gpt-config.md"
echo "      • Use the JWT token above"
echo ""
echo "   3. View logs:"
echo "      make dev-logs"
echo ""
echo "   4. Stop services:"
echo "      make dev-down"
echo ""
echo "📚 Documentation: docs/chatgpt-gpt-config.md"
echo ""
echo "Happy shopping! 🛍️"
echo ""

