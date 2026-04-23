/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('funding_accounts', {
    id: { type: 'text', primaryKey: true },
    user_id: { type: 'text', notNull: true, unique: true, references: 'users', onDelete: 'CASCADE' },
    currency: { type: 'text', notNull: true, default: 'USDC' },
    status: { type: 'text', notNull: true, default: 'active' },
    balance_available: { type: 'numeric', notNull: true, default: 0 },
    balance_reserved: { type: 'numeric', notNull: true, default: 0 },
    metadata: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('funding_accounts', 'user_id');
  pgm.createIndex('funding_accounts', ['status', 'currency']);

  pgm.createTable('funding_ledger_entries', {
    id: { type: 'text', primaryKey: true },
    account_id: { type: 'text', notNull: true, references: 'funding_accounts', onDelete: 'CASCADE' },
    entry_type: { type: 'text', notNull: true }, // credit|reserve|release|debit
    amount: { type: 'numeric', notNull: true },
    currency: { type: 'text', notNull: true, default: 'USDC' },
    reference_type: { type: 'text' },
    reference_id: { type: 'text' },
    idempotency_key: { type: 'text', unique: true },
    status: { type: 'text', notNull: true, default: 'posted' }, // posted|pending|voided
    metadata: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('funding_ledger_entries', 'account_id');
  pgm.createIndex('funding_ledger_entries', ['reference_type', 'reference_id']);
  pgm.createIndex('funding_ledger_entries', 'created_at');
};

exports.down = (pgm) => {
  pgm.dropTable('funding_ledger_entries');
  pgm.dropTable('funding_accounts');
};

