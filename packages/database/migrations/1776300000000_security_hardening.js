/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('organizations', {
    webhook_secret: { type: 'text' },
  });

  pgm.createIndex('payment_requests', 'status');

  pgm.createIndex('audit_entries', ['org_id', 'event_type']);
};

exports.down = (pgm) => {
  pgm.dropIndex('audit_entries', ['org_id', 'event_type']);
  pgm.dropIndex('payment_requests', 'status');
  pgm.dropColumns('organizations', ['webhook_secret']);
};
