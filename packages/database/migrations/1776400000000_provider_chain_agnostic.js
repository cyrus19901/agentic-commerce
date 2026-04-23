/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('providers', {
    wallet_address:     { type: 'text', default: '' },
    supported_networks: { type: 'text', default: '[]' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('providers', ['wallet_address', 'supported_networks']);
};
