#!/bin/sh
set -e

echo "🐳 Docker container starting..."

# Ensure data directory exists
mkdir -p /app/data

# Check if database exists, if not initialize it
if [ ! -f /app/data/shopping.db ]; then
    echo "📊 Database not found, initializing..."
    npm run db:setup
    
    echo "🌱 Seeding database with test data..."
    npx tsx scripts/seed-database.ts || echo "⚠️  Seeding skipped (will be populated on first use)"
else
    echo "✓ Database already exists"
fi

# Link E2E buyer wallet to ChatGPT user so funded wallet is used (idempotent)
if [ -f /app/scripts/link-e2e-buyer-wallet.ts ]; then
    echo "🔗 Linking E2E buyer wallet for ChatGPT user..."
    DATABASE_PATH=/app/data/shopping.db npx tsx scripts/link-e2e-buyer-wallet.ts 2>/dev/null || true
fi

echo "🚀 Starting application..."
exec "$@"
