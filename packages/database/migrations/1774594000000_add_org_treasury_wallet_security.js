/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('org_treasury_wallets', {
    id: { type: 'text', primaryKey: true },
    org_id: { type: 'text', notNull: true, references: 'organizations', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    address: { type: 'text', notNull: true },
    network: { type: 'text', notNull: true }, // e.g. solana:mainnet-beta, base, polygon
    asset: { type: 'text', notNull: true }, // e.g. mint/contract address
    status: { type: 'text', notNull: true, default: 'active' }, // active|paused|archived
    priority: { type: 'int', notNull: true, default: 100 },
    key_ciphertext: { type: 'text' }, // encrypted private key blob
    kms_key_id: { type: 'text' },
    key_version: { type: 'text' },
    routing_policy: { type: 'text' }, // JSON allow/deny/rate limits
    metadata: { type: 'text' },
    created_by: { type: 'text', references: 'users', onDelete: 'SET NULL' },
    last_rotated_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('org_treasury_wallets', 'org_treasury_wallets_unique_org_address_network_asset', {
    unique: ['org_id', 'address', 'network', 'asset'],
  });
  pgm.createIndex('org_treasury_wallets', ['org_id', 'status', 'priority']);
  pgm.createIndex('org_treasury_wallets', ['org_id', 'network', 'asset', 'status']);

  pgm.createTable('org_treasury_wallet_admins', {
    id: { type: 'text', primaryKey: true },
    org_id: { type: 'text', notNull: true, references: 'organizations', onDelete: 'CASCADE' },
    wallet_id: { type: 'text', notNull: true, references: 'org_treasury_wallets', onDelete: 'CASCADE' },
    user_id: { type: 'text', notNull: true, references: 'users', onDelete: 'CASCADE' },
    role: { type: 'text', notNull: true, default: 'admin' }, // owner|admin|operator|viewer
    status: { type: 'text', notNull: true, default: 'active' }, // active|revoked
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('org_treasury_wallet_admins', 'org_treasury_wallet_admins_unique_wallet_user', {
    unique: ['wallet_id', 'user_id'],
  });
  pgm.createIndex('org_treasury_wallet_admins', ['org_id', 'user_id', 'status']);

  pgm.createTable('org_treasury_policies', {
    id: { type: 'text', primaryKey: true },
    org_id: { type: 'text', notNull: true, unique: true, references: 'organizations', onDelete: 'CASCADE' },
    routing_mode: { type: 'text', notNull: true, default: 'priority' }, // priority|round-robin
    allow_networks: { type: 'text' }, // JSON array
    allow_assets: { type: 'text' }, // JSON array
    per_txn_limit_atomic: { type: 'numeric' },
    daily_limit_atomic: { type: 'numeric' },
    require_manual_approval_over_atomic: { type: 'numeric' },
    metadata: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('treasury_sign_requests', {
    id: { type: 'text', primaryKey: true },
    org_id: { type: 'text', notNull: true, references: 'organizations', onDelete: 'CASCADE' },
    wallet_id: { type: 'text', references: 'org_treasury_wallets', onDelete: 'SET NULL' },
    user_id: { type: 'text', references: 'users', onDelete: 'SET NULL' },
    endpoint: { type: 'text', notNull: true },
    request_hash: { type: 'text', notNull: true },
    idempotency_key: { type: 'text' },
    network: { type: 'text', notNull: true },
    asset: { type: 'text', notNull: true },
    destination: { type: 'text', notNull: true },
    amount_atomic: { type: 'numeric', notNull: true },
    amount_usd: { type: 'numeric' },
    status: { type: 'text', notNull: true, default: 'pending' }, // pending|signed|submitted|confirmed|failed
    tx_signature: { type: 'text' },
    provider_status: { type: 'int' },
    error_message: { type: 'text' },
    metadata: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('treasury_sign_requests', ['org_id', 'status', 'created_at']);
  pgm.createIndex('treasury_sign_requests', ['wallet_id', 'created_at']);
  pgm.createIndex('treasury_sign_requests', ['tx_signature']);
  pgm.createIndex('treasury_sign_requests', ['idempotency_key']);

  pgm.addColumns('org_treasury_ledger_entries', {
    treasury_wallet_id: { type: 'text', references: 'org_treasury_wallets', onDelete: 'SET NULL' },
  });
  pgm.createIndex('org_treasury_ledger_entries', ['treasury_wallet_id', 'created_at']);
};

exports.down = (pgm) => {
  pgm.dropIndex('org_treasury_ledger_entries', ['treasury_wallet_id', 'created_at']);
  pgm.dropColumns('org_treasury_ledger_entries', ['treasury_wallet_id']);
  pgm.dropTable('treasury_sign_requests');
  pgm.dropTable('org_treasury_policies');
  pgm.dropTable('org_treasury_wallet_admins');
  pgm.dropTable('org_treasury_wallets');
};

