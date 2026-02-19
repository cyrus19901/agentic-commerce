#!/bin/sh
set -e

echo "🚀 Starting Agentic Commerce API..."

# Create data directory if it doesn't exist
mkdir -p /app/data

# Database is bundled in the image at /app/data/shopping.db
# Only run full setup if somehow missing (shouldn't happen with COPY in Dockerfile)
if [ ! -f "/app/data/shopping.db" ]; then
  echo "📦 No database found - running fresh setup..."
  DATABASE_URL=${DATABASE_URL:-/app/data/shopping.db} \
  ADMIN_EMAIL=${ADMIN_EMAIL:-admin@example.com} \
  npm run db:setup
  echo "✓ Database setup complete"
else
  echo "✓ Using pre-seeded database ($(du -sh /app/data/shopping.db | cut -f1))"
fi

# Print auth mode
if [ "${DISABLE_AUTH}" = "true" ]; then
  echo "⚠️  Auth disabled (DISABLE_AUTH=true) - pass user_email in requests"
else
  echo "✓ Auth enabled - JWT tokens required"
fi

# Start the application
echo "✓ Starting server on port ${PORT:-3000}..."
exec "$@"

