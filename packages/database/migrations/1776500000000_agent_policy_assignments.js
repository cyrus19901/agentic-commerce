/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('agent_policies', {
    id:         { type: 'text', notNull: true, primaryKey: true },
    agent_id:   { type: 'text', notNull: true, references: 'registered_agents(agent_id)', onDelete: 'CASCADE' },
    policy_id:  { type: 'text', notNull: true, references: 'policies', onDelete: 'CASCADE' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.addConstraint('agent_policies', 'agent_policies_unique', {
    unique: ['agent_id', 'policy_id'],
  });
  pgm.createIndex('agent_policies', 'agent_id');
  pgm.createIndex('agent_policies', 'policy_id');
};

exports.down = (pgm) => {
  pgm.dropTable('agent_policies');
};
