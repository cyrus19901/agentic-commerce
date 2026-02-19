#!/bin/bash

echo "🔧 Setting up Agentic Commerce Database"
echo "========================================"
echo ""

cd "$(dirname "$0")/.."

# Ensure database directory exists
mkdir -p packages/api/data

DB_PATH="packages/api/data/shopping.db"

if [ -f "$DB_PATH" ]; then
  echo "✓ Database already exists at: $DB_PATH"
  echo ""
  echo "Current contents:"
  sqlite3 "$DB_PATH" "SELECT COUNT(*) as policies FROM policies;" 2>/dev/null | sed 's/^/  Policies: /'
  sqlite3 "$DB_PATH" "SELECT COUNT(*) as users FROM users;" 2>/dev/null | sed 's/^/  Users: /'
  sqlite3 "$DB_PATH" "SELECT COUNT(*) as purchases FROM purchase_attempts;" 2>/dev/null | sed 's/^/  Purchases: /'
  echo ""
  read -p "Do you want to recreate the database? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "✓ Keeping existing database"
    exit 0
  fi
  echo "Removing old database..."
  rm "$DB_PATH"
fi

# Run setup script to create tables and policies
echo "Creating database and adding policies..."
cd packages/api
PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH" npx tsx ../database/src/setup.ts

# Add default user
echo ""
echo "Adding default user..."
sqlite3 data/shopping.db "
INSERT OR IGNORE INTO users (id, email, name, role, created_at, updated_at)
VALUES ('user-test-123', 'cyrus19901@gmail.com', 'Cyrus Test', 'admin', datetime('now'), datetime('now'));
"

echo ""
echo "✅ Database setup complete!"
echo ""
echo "Database location: $DB_PATH"
echo "User email: cyrus19901@gmail.com"
echo ""
echo "To start the backend:"
echo "  cd $(pwd)/../.."
echo "  PATH=\"\$HOME/.nvm/versions/node/v20.19.6/bin:\$PATH\" PORT=3001 DISABLE_AUTH=true npm start"
