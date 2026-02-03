#!/bin/sh
set -e

echo "🚀 Starting Agentic Commerce API..."
echo "🔍 Current directory: $(pwd)"
echo "🔍 Directory contents: $(ls -la)"

# Determine database path - use /data for production (Render mount), ./data for development
if [ "$NODE_ENV" = "production" ]; then
  DB_PATH="/data"
  DB_FILE="/data/shopping.db"
else
  DB_PATH="/app/data"
  DB_FILE="/app/data/shopping.db"
fi

# Create data directory with proper permissions
echo "📁 Creating data directory: $DB_PATH..."
mkdir -p "$DB_PATH"
chmod 777 "$DB_PATH"
echo "✓ Data directory created: $DB_PATH"
ls -la "$DB_PATH" || echo "⚠️  Cannot list data directory"

# Initialize database if it doesn't exist
if [ ! -f "$DB_FILE" ]; then
  echo "📊 Initializing database at $DB_FILE..."
  cd /app/packages/database
  DATABASE_URL="$DB_FILE" node dist/setup.js || echo "⚠️  Database setup script not found, will create on first request"
  cd /app
else
  echo "✓ Database already exists at $DB_FILE"
fi

# Print environment info
echo "✅ Environment:"
echo "   NODE_ENV: ${NODE_ENV:-development}"
echo "   PORT: ${PORT:-3000}"
echo "   DATABASE_URL: ${DATABASE_URL:-$DB_FILE}"
echo "   Actual DB Path: $DB_FILE"
echo "   JWT_SECRET: ${JWT_SECRET:+[SET]}"
echo "   STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY:+[SET]}"

# Verify node and required files exist
echo "🔍 Node version: $(node --version)"
echo "🔍 API file exists: $(test -f /app/packages/api/dist/index.js && echo 'YES' || echo 'NO')"

# Start the application
echo "🎯 Starting API server from /app..."
echo "📝 Command: node /app/packages/api/dist/index.js"
exec node /app/packages/api/dist/index.js
