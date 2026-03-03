/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // ── Users ──────────────────────────────────────────────────────────────────
  pgm.createTable('users', {
    id:                        { type: 'text',        primaryKey: true },
    email:                     { type: 'text',        notNull: true, unique: true },
    name:                      { type: 'text' },
    role:                      { type: 'text',        notNull: true, default: 'user' },
    verification_code:         { type: 'text' },
    verification_code_expires: { type: 'timestamptz' },
    created_at:                { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at:                { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('users', 'email');

  // ── Policies ────────────────────────────────────────────────────────────────
  pgm.createTable('policies', {
    id:                { type: 'text',        primaryKey: true },
    name:              { type: 'text',        notNull: true },
    type:              { type: 'text',        notNull: true },
    enabled:           { type: 'boolean',     notNull: true, default: true },
    priority:          { type: 'integer',     notNull: true, default: 0 },
    transaction_types: { type: 'text',        notNull: true, default: '["agent-to-merchant"]' },
    conditions:        { type: 'text',        notNull: true },
    rules:             { type: 'text',        notNull: true },
    created_at:        { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at:        { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // ── User Policies (join) ────────────────────────────────────────────────────
  pgm.createTable('user_policies', {
    id:         { type: 'text',        notNull: true },
    user_id:    { type: 'text',        notNull: true, references: 'users',    onDelete: 'CASCADE' },
    policy_id:  { type: 'text',        notNull: true, references: 'policies', onDelete: 'CASCADE' },
    active:     { type: 'boolean',     notNull: true, default: true },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });
  pgm.addConstraint('user_policies', 'user_policies_pk', { primaryKey: ['user_id', 'policy_id'] });
  pgm.createIndex('user_policies', 'user_id');
  pgm.createIndex('user_policies', 'policy_id');

  // ── Products ────────────────────────────────────────────────────────────────
  pgm.createTable('products', {
    id:          { type: 'text',        primaryKey: true },
    name:        { type: 'text',        notNull: true },
    price:       { type: 'numeric',     notNull: true },
    description: { type: 'text' },
    merchant:    { type: 'text',        notNull: true },
    category:    { type: 'text',        notNull: true },
    image_url:   { type: 'text' },
    available:   { type: 'boolean',     notNull: true, default: true },
    created_at:  { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at:  { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('products', 'merchant');
  pgm.createIndex('products', 'category');

  // ── Purchase Attempts ────────────────────────────────────────────────────────
  pgm.createTable('purchase_attempts', {
    id:                     { type: 'bigserial',   primaryKey: true },
    user_id:                { type: 'text',        notNull: true },
    product_id:             { type: 'text',        notNull: true },
    product_name:           { type: 'text' },
    amount:                 { type: 'numeric',     notNull: true },
    merchant:               { type: 'text',        notNull: true },
    category:               { type: 'text' },
    allowed:                { type: 'boolean',     notNull: true },
    requires_approval:      { type: 'boolean',     default: false },
    approval_status:        { type: 'text' },
    policy_results:         { type: 'text',        notNull: true },
    checkout_method:        { type: 'text',        default: 'traditional' },
    transaction_type:       { type: 'text',        default: 'agent-to-merchant' },
    payment_method:         { type: 'text',        default: 'stripe' },
    blockchain_tx_signature:{ type: 'text' },
    product_url:            { type: 'text' },
    product_image_url:      { type: 'text' },
    timestamp:              { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('purchase_attempts', ['user_id', 'timestamp']);

  // ── x402 Nonces (anti-replay) ────────────────────────────────────────────────
  pgm.createTable('x402_nonces', {
    id:           { type: 'bigserial',   primaryKey: true },
    nonce:        { type: 'text',        notNull: true, unique: true },
    tx_signature: { type: 'text',        notNull: true },
    agent_id:     { type: 'text',        notNull: true },
    buyer_user_id:{ type: 'text' },
    amount:       { type: 'text',        notNull: true },
    mint:         { type: 'text',        notNull: true },
    verified:     { type: 'boolean',     notNull: true, default: false },
    verified_at:  { type: 'timestamptz' },
    expires_at:   { type: 'timestamptz', notNull: true },
    created_at:   { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('x402_nonces', 'nonce');
  pgm.createIndex('x402_nonces', 'tx_signature');
  pgm.createIndex('x402_nonces', 'expires_at');

  // ── Registered Agents ────────────────────────────────────────────────────────
  pgm.createTable('registered_agents', {
    id:                  { type: 'text',        primaryKey: true },
    agent_id:            { type: 'text',        notNull: true, unique: true },
    name:                { type: 'text',        notNull: true },
    base_url:            { type: 'text',        notNull: true },
    services:            { type: 'text',        notNull: true },
    service_description: { type: 'text' },
    accepted_currencies: { type: 'text',        notNull: true },
    usdc_token_account:  { type: 'text' },
    solana_pubkey:       { type: 'text' },
    active:              { type: 'boolean',     notNull: true, default: true },
    verified:            { type: 'boolean',     notNull: true, default: false },
    owner_id:            { type: 'text',        notNull: true },
    metadata:            { type: 'text' },
    created_at:          { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at:          { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('registered_agents', 'agent_id');
  pgm.createIndex('registered_agents', ['active', 'verified']);

  // ── User Wallets ─────────────────────────────────────────────────────────────
  pgm.createTable('user_wallets', {
    id:               { type: 'text',        primaryKey: true },
    user_id:          { type: 'text',        notNull: true, unique: true, references: 'users', onDelete: 'CASCADE' },
    public_key:       { type: 'text',        notNull: true, unique: true },
    encrypted_secret: { type: 'text',        notNull: true },
    created_at:       { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('user_wallets', 'user_id');
  pgm.createIndex('user_wallets', 'public_key');

  // ── User Events (data lake – append-only) ────────────────────────────────────
  pgm.createTable('user_events', {
    id:           { type: 'text',        primaryKey: true },
    user_id:      { type: 'text',        notNull: true, references: 'users', onDelete: 'CASCADE' },
    session_id:   { type: 'text' },
    event_type:   { type: 'text',        notNull: true },
    source:       { type: 'text',        default: 'api' },
    raw_input:    { type: 'text' },
    intent:       { type: 'text' },
    product_name: { type: 'text' },
    category:     { type: 'text' },
    merchant:     { type: 'text' },
    amount:       { type: 'numeric' },
    outcome:      { type: 'text' },
    policy_id:    { type: 'text' },
    block_reason: { type: 'text' },
    metadata:     { type: 'text' },
    created_at:   { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('user_events', 'user_id');
  pgm.createIndex('user_events', 'event_type');
  pgm.createIndex('user_events', 'created_at');
  pgm.createIndex('user_events', 'session_id');

  // ── User Profiles (aggregated – rebuilt nightly) ─────────────────────────────
  pgm.createTable('user_profiles', {
    user_id:                  { type: 'text',        primaryKey: true, references: 'users', onDelete: 'CASCADE' },
    total_spend_lifetime:     { type: 'numeric',     default: 0 },
    total_spend_30d:          { type: 'numeric',     default: 0 },
    total_spend_7d:           { type: 'numeric',     default: 0 },
    total_queries:            { type: 'integer',     default: 0 },
    total_purchases:          { type: 'integer',     default: 0 },
    total_blocked:            { type: 'integer',     default: 0 },
    block_rate:               { type: 'numeric',     default: 0 },
    avg_transaction_amount:   { type: 'numeric',     default: 0 },
    largest_purchase:         { type: 'numeric',     default: 0 },
    top_categories:           { type: 'text',        default: '[]' },
    top_merchants:            { type: 'text',        default: '[]' },
    most_common_block_reason: { type: 'text' },
    queries_per_day:          { type: 'numeric',     default: 0 },
    first_seen:               { type: 'timestamptz' },
    last_active:              { type: 'timestamptz' },
    last_synthesized_at:      { type: 'timestamptz' },
    event_count:              { type: 'integer',     default: 0 },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('user_profiles');
  pgm.dropTable('user_events');
  pgm.dropTable('user_wallets');
  pgm.dropTable('registered_agents');
  pgm.dropTable('x402_nonces');
  pgm.dropTable('purchase_attempts');
  pgm.dropTable('products');
  pgm.dropTable('user_policies');
  pgm.dropTable('policies');
  pgm.dropTable('users');
};
