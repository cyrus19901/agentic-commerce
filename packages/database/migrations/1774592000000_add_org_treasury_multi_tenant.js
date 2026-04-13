/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('organizations', {
    id: { type: 'text', primaryKey: true },
    name: { type: 'text', notNull: true },
    slug: { type: 'text', notNull: true, unique: true },
    status: { type: 'text', notNull: true, default: 'active' },
    metadata: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('organizations', 'slug');
  pgm.createIndex('organizations', 'status');

  pgm.createTable('org_memberships', {
    id: { type: 'text', primaryKey: true },
    org_id: { type: 'text', notNull: true, references: 'organizations', onDelete: 'CASCADE' },
    user_id: { type: 'text', notNull: true, references: 'users', onDelete: 'CASCADE' },
    role: { type: 'text', notNull: true, default: 'member' }, // owner|admin|manager|member
    status: { type: 'text', notNull: true, default: 'active' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('org_memberships', 'org_memberships_unique_org_user', {
    unique: ['org_id', 'user_id'],
  });
  pgm.createIndex('org_memberships', ['user_id', 'status']);
  pgm.createIndex('org_memberships', ['org_id', 'status']);

  pgm.createTable('org_treasury_accounts', {
    id: { type: 'text', primaryKey: true },
    org_id: { type: 'text', notNull: true, unique: true, references: 'organizations', onDelete: 'CASCADE' },
    currency: { type: 'text', notNull: true, default: 'USDC' },
    status: { type: 'text', notNull: true, default: 'active' },
    balance_available: { type: 'numeric', notNull: true, default: 0 },
    balance_reserved: { type: 'numeric', notNull: true, default: 0 },
    metadata: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('org_treasury_accounts', ['status', 'currency']);

  pgm.createTable('org_treasury_ledger_entries', {
    id: { type: 'text', primaryKey: true },
    treasury_account_id: { type: 'text', notNull: true, references: 'org_treasury_accounts', onDelete: 'CASCADE' },
    entry_type: { type: 'text', notNull: true }, // credit|reserve|release|debit|allocation
    amount: { type: 'numeric', notNull: true },
    currency: { type: 'text', notNull: true, default: 'USDC' },
    reference_type: { type: 'text' },
    reference_id: { type: 'text' },
    idempotency_key: { type: 'text', unique: true },
    status: { type: 'text', notNull: true, default: 'posted' },
    metadata: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('org_treasury_ledger_entries', 'treasury_account_id');
  pgm.createIndex('org_treasury_ledger_entries', ['reference_type', 'reference_id']);
  pgm.createIndex('org_treasury_ledger_entries', 'created_at');

  pgm.addColumns('funding_accounts', {
    organization_id: { type: 'text', references: 'organizations', onDelete: 'SET NULL' },
  });
  pgm.createIndex('funding_accounts', ['organization_id', 'user_id']);
};

exports.down = (pgm) => {
  pgm.dropIndex('funding_accounts', ['organization_id', 'user_id']);
  pgm.dropColumns('funding_accounts', ['organization_id']);
  pgm.dropTable('org_treasury_ledger_entries');
  pgm.dropTable('org_treasury_accounts');
  pgm.dropTable('org_memberships');
  pgm.dropTable('organizations');
};

