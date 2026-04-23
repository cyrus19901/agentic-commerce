#!/bin/sh
set -e

echo "🚀 Starting Agentic Commerce API..."

if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL is required"
  exit 1
fi

echo "🔄 Running database migrations..."
npm run db:migrate --workspace=@agentic-commerce/database
echo "✓ Migrations complete"

# Print auth mode
if [ "${DISABLE_AUTH}" = "true" ]; then
  echo "⚠️  Auth disabled (DISABLE_AUTH=true) - pass user_email in requests"
else
  echo "✓ Auth enabled - JWT tokens required"
fi

echo "✓ Starting server on port ${PORT:-3000}..."
exec "$@"
