/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // ── API Keys ────────────────────────────────────────────────────────────────
  pgm.createTable('api_keys', {
    id:           { type: 'text',        primaryKey: true },
    org_id:       { type: 'text',        notNull: true, references: 'organizations', onDelete: 'CASCADE' },
    key_hash:     { type: 'text',        notNull: true, unique: true },
    key_prefix:   { type: 'text',        notNull: true },
    name:         { type: 'text',        notNull: true },
    scopes:       { type: 'text',        notNull: true, default: '["*"]' },
    rate_limit:   { type: 'integer',     notNull: true, default: 100 },
    enabled:      { type: 'boolean',     notNull: true, default: true },
    last_used_at: { type: 'timestamptz' },
    expires_at:   { type: 'timestamptz' },
    created_at:   { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('api_keys', 'key_hash');
  pgm.createIndex('api_keys', ['org_id', 'enabled']);

  // ── Providers ───────────────────────────────────────────────────────────────
  pgm.createTable('providers', {
    id:         { type: 'text',        primaryKey: true },
    name:       { type: 'text',        notNull: true },
    type:       { type: 'text',        notNull: true, default: 'hybrid' },
    endpoint:   { type: 'text',        notNull: true },
    actions:    { type: 'text',        notNull: true, default: '[]' },
    pricing:    { type: 'text',        notNull: true, default: '{}' },
    enabled:    { type: 'boolean',     notNull: true, default: true },
    metadata:   { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // ── Payment Requests ────────────────────────────────────────────────────────
  pgm.createTable('payment_requests', {
    id:                   { type: 'text',        primaryKey: true },
    org_id:               { type: 'text',        notNull: true, references: 'organizations', onDelete: 'CASCADE' },
    provider_id:          { type: 'text',        notNull: true, references: 'providers' },
    action:               { type: 'text',        notNull: true },
    params:               { type: 'text',        notNull: true, default: '{}' },
    max_payment_usdc:     { type: 'numeric' },
    status:               { type: 'text',        notNull: true, default: 'pending' },
    policy_result:        { type: 'text' },
    provider_response:    { type: 'text' },
    base_tx_hash:         { type: 'text' },
    payment_amount_usdc:  { type: 'numeric' },
    audit_correlation_id: { type: 'text' },
    callback_url:         { type: 'text' },
    error:                { type: 'text' },
    created_at:           { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    completed_at:         { type: 'timestamptz' },
  });
  pgm.createIndex('payment_requests', ['org_id', 'status']);
  pgm.createIndex('payment_requests', 'created_at');
  pgm.createIndex('payment_requests', 'audit_correlation_id');

  // ── Audit Entries ───────────────────────────────────────────────────────────
  pgm.createTable('audit_entries', {
    id:             { type: 'text',        primaryKey: true },
    org_id:         { type: 'text',        references: 'organizations', onDelete: 'SET NULL' },
    correlation_id: { type: 'text' },
    event_type:     { type: 'text',        notNull: true },
    actor:          { type: 'text',        notNull: true },
    actor_type:     { type: 'text',        notNull: true, default: 'system' },
    resource:       { type: 'text',        notNull: true },
    resource_id:    { type: 'text' },
    action:         { type: 'text',        notNull: true },
    outcome:        { type: 'text',        notNull: true, default: 'success' },
    details:        { type: 'text',        notNull: true, default: '{}' },
    ip_address:     { type: 'text' },
    created_at:     { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('audit_entries', ['org_id', 'created_at']);
  pgm.createIndex('audit_entries', 'correlation_id');
  pgm.createIndex('audit_entries', 'event_type');

  // ── Add org_id to policies ──────────────────────────────────────────────────
  pgm.addColumns('policies', {
    org_id: { type: 'text', references: 'organizations', onDelete: 'CASCADE' },
  });
  pgm.createIndex('policies', 'org_id');
};

exports.down = (pgm) => {
  pgm.dropIndex('policies', 'org_id');
  pgm.dropColumns('policies', ['org_id']);
  pgm.dropTable('audit_entries');
  pgm.dropTable('payment_requests');
  pgm.dropTable('providers');
  pgm.dropTable('api_keys');
};
