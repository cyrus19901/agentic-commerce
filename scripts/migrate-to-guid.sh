#!/bin/bash

echo "🔄 Migrating Database to GUID Schema"
echo "====================================="
echo ""

cd "$(dirname "$0")/.."

DB_PATH="packages/api/data/shopping.db"

if [ ! -f "$DB_PATH" ]; then
  echo "❌ Database not found at: $DB_PATH"
  exit 1
fi

# Backup database
BACKUP_PATH="${DB_PATH}.backup-$(date +%Y%m%d-%H%M%S)"
echo "📦 Creating backup: $BACKUP_PATH"
cp "$DB_PATH" "$BACKUP_PATH"

echo ""
echo "🔧 Running migration..."

sqlite3 "$DB_PATH" << 'SQL'

-- Step 1: Create new purchase_attempts table with GUID
CREATE TABLE IF NOT EXISTS purchase_attempts_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT,
  amount REAL NOT NULL,
  merchant TEXT NOT NULL,
  category TEXT,
  transaction_type TEXT NOT NULL DEFAULT 'agent-to-merchant',
  allowed INTEGER NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  approval_status TEXT,
  policy_results TEXT NOT NULL,
  checkout_method TEXT DEFAULT 'traditional',
  payment_status TEXT,
  payment_id TEXT,
  timestamp TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT,
  CHECK (allowed IN (0, 1)),
  CHECK (requires_approval IN (0, 1)),
  CHECK (transaction_type IN ('agent-to-merchant', 'agent-to-agent')),
  CHECK (approval_status IS NULL OR approval_status IN ('pending', 'approved', 'rejected')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Step 2: Migrate data from old table to new table
INSERT INTO purchase_attempts_new (
  id, 
  user_id, 
  product_id, 
  product_name, 
  amount, 
  merchant, 
  category, 
  transaction_type, 
  allowed, 
  requires_approval, 
  approval_status,
  policy_results, 
  checkout_method,
  payment_status,
  payment_id,
  timestamp,
  approved_at,
  approved_by
)
SELECT 
  'purchase-' || id || '-migrated',  -- Convert INTEGER id to TEXT GUID
  user_id,
  product_id,
  product_name,
  amount,
  merchant,
  category,
  COALESCE(transaction_type, 'agent-to-merchant'),
  allowed,
  COALESCE(requires_approval, 0),
  approval_status,
  policy_results,
  COALESCE(checkout_method, 'traditional'),
  NULL as payment_status,
  NULL as payment_id,
  timestamp,
  NULL as approved_at,
  NULL as approved_by
FROM purchase_attempts;

-- Step 3: Drop old table
DROP TABLE purchase_attempts;

-- Step 4: Rename new table
ALTER TABLE purchase_attempts_new RENAME TO purchase_attempts;

-- Step 5: Create indexes
CREATE INDEX idx_purchase_user_timestamp ON purchase_attempts(user_id, timestamp DESC);
CREATE INDEX idx_purchase_transaction_type ON purchase_attempts(transaction_type);
CREATE INDEX idx_purchase_allowed ON purchase_attempts(allowed);
CREATE INDEX idx_purchase_user_type_timestamp ON purchase_attempts(user_id, transaction_type, allowed, timestamp DESC);

SELECT 'Migration completed successfully - ' || changes() || ' records migrated';

SQL

echo ""
echo "✅ Migration complete!"
echo ""
echo "📊 Verifying data integrity..."
sqlite3 "$DB_PATH" "
SELECT 'Total purchases: ' || COUNT(*) FROM purchase_attempts;
SELECT 'Users: ' || COUNT(*) FROM users;
SELECT 'Policies: ' || COUNT(*) FROM policies;
SELECT 'Sample purchase ID: ' || id FROM purchase_attempts LIMIT 1;
"

echo ""
echo "💾 Backup saved at: $BACKUP_PATH"
echo "✅ Database now uses GUID primary keys!"
