#!/bin/bash

echo "🚀 Starting Agentic Commerce Backend"
echo "====================================="
echo ""

cd /Users/cyrus19901/Repository/agentic-commerce

# Kill existing process on port 3001
lsof -ti:3001 | xargs kill -9 2>/dev/null
sleep 1

# Start backend with Node v20
echo "Starting backend on port 3001..."
PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH" PORT=3001 DISABLE_AUTH=true npm start

echo ""
echo "Backend started!"
echo "Health check: http://localhost:3001/health"
