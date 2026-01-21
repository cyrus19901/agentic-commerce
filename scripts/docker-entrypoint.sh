#!/bin/sh
set -e

echo "🚀 Starting Agentic Commerce API..."

# Create data directory if it doesn't exist
mkdir -p /app/data

# Check if database exists, if not, set it up
if [ ! -f "/app/data/shopping.db" ]; then
  echo "📦 Setting up database..."
  npm run db:setup
  echo "✓ Database setup complete"
fi

# Start the application
echo "✓ Starting server on port ${PORT:-3000}..."
exec "$@"

