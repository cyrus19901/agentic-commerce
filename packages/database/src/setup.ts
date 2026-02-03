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
  // ============================================
  // REGULAR POLICIES (Simple, Common Scenarios)
  // ============================================
  
  {
    id: 'policy-1-monthly-budget',
    name: 'Monthly Budget Limit - $5000',
    type: 'budget',
    enabled: true,
    priority: 100,
    conditions: {},
    rules: { 
      maxAmount: 5000, 
      period: 'monthly',
      fallbackAction: 'deny',
    },
  },
  
  {
    id: 'policy-2-transaction-limit',
    name: 'Maximum Transaction Amount - $500',
    type: 'transaction',
    enabled: true,
    priority: 95,
    conditions: {},
    rules: { 
      maxTransactionAmount: 500,
      fallbackAction: 'deny',
    },
  },
  
  {
    id: 'policy-3-daily-budget',
    name: 'Daily Spending Cap - $1000',
    type: 'budget',
    enabled: true,
    priority: 90,
    conditions: {},
    rules: { 
      maxAmount: 1000, 
      period: 'daily',
      fallbackAction: 'require_approval',
    },
  },
  
  {
    id: 'policy-4-weekly-budget',
    name: 'Weekly Spending Limit - $2500',
    type: 'budget',
    enabled: true,
    priority: 85,
    conditions: {},
    rules: { 
      maxAmount: 2500, 
      period: 'weekly',
      fallbackAction: 'require_approval',
    },
  },
  
  {
    id: 'policy-5-allowed-merchants',
    name: 'Approved Merchants Only',
    type: 'merchant',
    enabled: true,
    priority: 80,
    conditions: {},
    rules: {
      allowedMerchants: ['ArtisanLeatherCo', 'MinimalGoods', 'OfficeComfort', 'TechAudio', 'SilverCraft'],
      fallbackAction: 'require_approval',
    },
  },
  
  {
    id: 'policy-6-blocked-merchants',
    name: 'Blocked Merchants - No Purchase',
    type: 'merchant',
    enabled: true,
    priority: 75,
    conditions: {},
    rules: {
      blockedMerchants: ['BlockedShop', 'RestrictedMerchant', 'UnauthorizedVendor'],
      fallbackAction: 'deny',
    },
  },
  
  {
    id: 'policy-7-allowed-categories',
    name: 'Office Supplies & Bags Only',
    type: 'category',
    enabled: true,
    priority: 70,
    conditions: {},
    rules: {
      allowedCategories: ['Office Supplies', 'Bags & Purses', 'Office & Business'],
      fallbackAction: 'require_approval',
    },
  },
  
  {
    id: 'policy-8-blocked-categories',
    name: 'Electronics Require Approval',
    type: 'category',
    enabled: true,
    priority: 65,
    conditions: {},
    rules: {
      blockedCategories: ['Electronics'],
      fallbackAction: 'require_approval',
    },
  },
  
  // ============================================
  // COMPLICATED POLICIES (Time, Agent, Composite)
  // ============================================
  
  {
    id: 'policy-9-business-hours',
    name: 'Business Hours Only (9 AM - 5 PM Weekdays)',
    type: 'time',
    enabled: true,
    priority: 60,
    conditions: {},
    rules: {
      allowedTimeRanges: [{ start: '09:00', end: '17:00' }],
      allowedDaysOfWeek: [1, 2, 3, 4, 5], // Monday-Friday
      fallbackAction: 'require_approval',
    },
  },
  
  {
    id: 'policy-10-weekend-restriction',
    name: 'Weekend Purchases Blocked',
    type: 'time',
    enabled: true,
    priority: 55,
    conditions: {},
    rules: {
      allowedDaysOfWeek: [1, 2, 3, 4, 5], // Only weekdays
      fallbackAction: 'deny',
    },
  },
  
  {
    id: 'policy-11-lunch-hours',
    name: 'Lunch Break Hours (12 PM - 1 PM) Auto-Approve',
    type: 'time',
    enabled: true,
    priority: 50,
    conditions: {},
    rules: {
      allowedTimeRanges: [{ start: '12:00', end: '13:00' }],
      allowedDaysOfWeek: [1, 2, 3, 4, 5],
      fallbackAction: 'require_approval',
    },
  },
  
  {
    id: 'policy-12-chatgpt-only',
    name: 'ChatGPT Agent Only - Block Others',
    type: 'agent',
    enabled: true,
    priority: 45,
    conditions: {},
    rules: {
      allowedAgentNames: ['ChatGPT', 'chatgpt', 'gpt-4', 'gpt-3.5'],
      blockedAgentTypes: ['claude', 'gemini', 'llama'],
      fallbackAction: 'deny',
    },
  },
  
  {
    id: 'policy-13-agent-type-restriction',
    name: 'Block Specific Agent Types',
    type: 'agent',
    enabled: true,
    priority: 40,
    conditions: {},
    rules: {
      blockedAgentTypes: ['claude', 'experimental'],
      fallbackAction: 'require_approval',
    },
  },
  
  {
    id: 'policy-14-recipient-agent',
    name: 'Restrict Recipient Agents',
    type: 'agent',
    enabled: true,
    priority: 35,
    conditions: {},
    rules: {
      blockedRecipientAgents: ['ExternalAgent', 'ThirdPartyBot'],
      fallbackAction: 'deny',
    },
  },
  
  {
    id: 'policy-15-purpose-restriction',
    name: 'Personal Use Purchases Blocked',
    type: 'purpose',
    enabled: true,
    priority: 30,
    conditions: {},
    rules: {
      blockedPurposes: ['personal', 'gift', 'entertainment'],
      allowedPurposes: ['business', 'office', 'work'],
      fallbackAction: 'require_approval',
    },
  },
  
  {
    id: 'policy-16-composite-high-value',
    name: 'High-Value Office Supplies Require Approval',
    type: 'composite',
    enabled: true,
    priority: 25,
    conditions: {},
    rules: {
      compositeConditions: [
        { field: 'amount', operator: 'greater_than', value: 100 },
        { field: 'category', operator: 'equals', value: 'Office Supplies' },
      ],
      fallbackAction: 'require_approval',
    },
  },
  
  {
    id: 'policy-17-composite-merchant-amount',
    name: 'Large Purchases from Specific Merchants',
    type: 'composite',
    enabled: true,
    priority: 20,
    conditions: {},
    rules: {
      compositeConditions: [
        { field: 'amount', operator: 'greater_than', value: 200 },
        { field: 'merchant', operator: 'equals', value: 'LuxuryLeatherGoods' },
      ],
      fallbackAction: 'require_approval',
    },
  },
  
  {
    id: 'policy-18-complex-multi-condition',
    name: 'Complex: Electronics Over $150 on Weekends',
    type: 'composite',
    enabled: true,
    priority: 15,
    conditions: {},
    rules: {
      compositeConditions: [
        { field: 'category', operator: 'equals', value: 'Electronics' },
        { field: 'amount', operator: 'greater_than', value: 150 },
        // Note: day_of_week would need to be passed in request
      ],
      fallbackAction: 'deny',
    },
  },
  
  {
    id: 'policy-19-time-category-combo',
    name: 'After-Hours Electronics Blocked',
    type: 'composite',
    enabled: true,
    priority: 10,
    conditions: {},
    rules: {
      compositeConditions: [
        { field: 'category', operator: 'equals', value: 'Electronics' },
        // Time check would be in time-based policy, this is category + amount
        { field: 'amount', operator: 'greater_than', value: 50 },
      ],
      fallbackAction: 'deny',
    },
  },
  
  {
    id: 'policy-20-low-value-auto-approve',
    name: 'Auto-Approve Small Office Supplies',
    type: 'composite',
    enabled: true,
    priority: 5,
    conditions: {},
    rules: {
      compositeConditions: [
        { field: 'amount', operator: 'less_than_or_equal', value: 25 },
        { field: 'category', operator: 'equals', value: 'Office Supplies' },
      ],
      fallbackAction: 'approve',
    },
  },
];

(async () => {
console.log('Setting up database...');

for (const policy of defaultPolicies) {
  try {
    const existing = await db.getPolicyById(policy.id);
    if (existing) {
      await db.updatePolicy(policy);
      console.log(`✓ Updated policy: ${policy.name}`);
    } else {
      await db.createPolicy(policy);
      console.log(`✓ Created policy: ${policy.name}`);
    }
  } catch (e) {
    console.log(`Error with policy ${policy.name}:`, e);
  }
}

console.log('✓ Database setup complete!');
})();
