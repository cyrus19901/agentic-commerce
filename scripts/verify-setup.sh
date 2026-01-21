#!/bin/bash

# Comprehensive verification script for Agentic Commerce

set +e  # Don't exit on errors, we want to check everything

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

echo "🔍 Agentic Commerce - Setup Verification"
echo "========================================"
echo ""

# Check 1: Docker Installation
echo -n "1. Docker installed... "
if command -v docker &> /dev/null; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "   Install Docker Desktop: https://www.docker.com/products/docker-desktop"
    ERRORS=$((ERRORS + 1))
fi

# Check 2: Docker Running
echo -n "2. Docker running... "
if docker info > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "   Please start Docker Desktop and wait for it to be ready"
    ERRORS=$((ERRORS + 1))
fi

# Check 3: Docker Compose
echo -n "3. Docker Compose available... "
if command -v docker-compose &> /dev/null || docker compose version &> /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "   Docker Compose should come with Docker Desktop"
    ERRORS=$((ERRORS + 1))
fi

# Check 4: .env file
echo -n "4. .env file exists... "
if [ -f .env ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${YELLOW}⚠${NC}"
    echo "   Creating .env from .env.example..."
    cp .env.example .env
    WARNINGS=$((WARNINGS + 1))
fi

# Check 5: Port 3000 available
echo -n "5. Port 3000 available... "
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠${NC}"
    echo "   Port 3000 is in use. You may need to stop the existing service or change PORT in .env"
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "${GREEN}✓${NC}"
fi

# Check 6: Port 8080 available
echo -n "6. Port 8080 available... "
if lsof -Pi :8080 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠${NC}"
    echo "   Port 8080 is in use (DB viewer). This is optional."
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "${GREEN}✓${NC}"
fi

# Check 7: Data directory
echo -n "7. Data directory... "
if [ -d data ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${YELLOW}⚠${NC}"
    echo "   Creating data directory..."
    mkdir -p data
    WARNINGS=$((WARNINGS + 1))
fi

echo ""
echo "========================================"

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ All critical checks passed!${NC}"
    echo ""
    
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}⚠ $WARNINGS warning(s) - see above${NC}"
        echo ""
    fi
    
    echo "Next steps:"
    echo "  1. Build and start: ./scripts/quick-start.sh"
    echo "  2. Or manually: make dev"
    echo ""
else
    echo -e "${RED}❌ $ERRORS error(s) found - please fix them first${NC}"
    echo ""
    echo "Common fixes:"
    echo "  • Install Docker Desktop: https://www.docker.com/products/docker-desktop"
    echo "  • Start Docker Desktop and wait for it to be ready"
    echo "  • Run 'docker info' to verify Docker is running"
    echo ""
    exit 1
fi

