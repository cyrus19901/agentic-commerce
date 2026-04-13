/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('request_idempotency', {
    id: { type: 'text', primaryKey: true },
    user_id: { type: 'text', notNull: true, references: 'users', onDelete: 'CASCADE' },
    endpoint: { type: 'text', notNull: true },
    idempotency_key: { type: 'text', notNull: true },
    request_hash: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'pending' }, // pending|completed|failed
    response_code: { type: 'int' },
    response_json: { type: 'text' },
    error_message: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('request_idempotency', 'request_idempotency_unique_user_endpoint_key', {
    unique: ['user_id', 'endpoint', 'idempotency_key'],
  });
  pgm.createIndex('request_idempotency', ['user_id', 'endpoint', 'idempotency_key']);
  pgm.createIndex('request_idempotency', ['status', 'updated_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('request_idempotency');
};

