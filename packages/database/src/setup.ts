import { DB } from './index.js';
import { Policy } from '@agentic-commerce/shared';
import * as fs from 'fs';
import * as path from 'path';

// Ensure data directory exists
const dataDir = path.resolve('./data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DB('./data/shopping.db');

const defaultPolicies: Policy[] = [
  {
    id: 'default-monthly-1000',
    name: 'Monthly Budget $1000',
    type: 'budget',
    enabled: true,
    priority: 100,
    conditions: {},
    rules: { maxAmount: 1000, period: 'monthly' },
  },
  {
    id: 'default-transaction-500',
    name: 'Max $500 per Transaction',
    type: 'transaction',
    enabled: true,
    priority: 90,
    conditions: {},
    rules: { maxTransactionAmount: 500 },
  },
];

(async () => {
  console.log('Setting up database...');

  for (const policy of defaultPolicies) {
    try {
      await db.createPolicy(policy);
      console.log(`✓ Created policy: ${policy.name}`);
    } catch (e) {
      console.log(`Policy ${policy.name} already exists`);
    }
  }

  console.log('✓ Database setup complete!');
})();
