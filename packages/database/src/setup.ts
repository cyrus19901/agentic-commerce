import { DB } from './index.js';
import { Policy } from '@agentic-commerce/shared';
import * as fs from 'fs';
import * as path from 'path';

// Ensure data directory exists
const dataDir = path.resolve('./data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DB(process.env.DATABASE_URL || './data/shopping.db');

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
    conditions: {
      transactionType: ['agent-to-merchant', 'agent-to-agent'],
    },
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
    conditions: {
      transactionType: ['agent-to-merchant', 'agent-to-agent'],
    },
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
    conditions: {
      transactionType: ['agent-to-merchant'],
    },
    rules: {
      allowedCategories: ['Office Supplies', 'Bags & Purses', 'Office & Business', 'Paper & Party Supplies'],
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
    conditions: {
      transactionType: ['agent-to-merchant'],
    },
    rules: {
      compositeConditions: [
        { field: 'amount', operator: 'less_than_or_equal', value: 100 },
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

// Assign all policies to all existing users
console.log('\n📋 Assigning policies to users...');
const allUsers = db.db.prepare('SELECT id, email FROM users').all() as any[];
console.log(`Found ${allUsers.length} users`);

for (const user of allUsers) {
  for (const policy of defaultPolicies) {
    try {
      db.db.prepare('INSERT OR IGNORE INTO user_policies (user_id, policy_id, active) VALUES (?, ?, 1)')
        .run(user.id, policy.id);
    } catch (e) {
      // Ignore duplicate errors
    }
  }
  console.log(`✓ Assigned ${defaultPolicies.length} policies to ${user.email}`);
}

// Seed agents for agent-to-agent transactions
console.log('\n🤖 Seeding agents...');
const timestamp = new Date().toISOString();
// Use a single service wallet to collect all payments (simplifies testing)
const SERVICE_WALLET_USDC_ACCOUNT = process.env.SERVICE_WALLET_USDC || 'Aj3Z8i5HQ1z9poYBfCicYXHCtfzry9ijcQyunPTaoG4g';

const agents = [
  {
    id: 'agent-apify-001',
    agentId: 'agent://apify.com/web-scraper/v1',
    name: 'Apify Web Scraper',
    services: JSON.stringify(['data-scraping', 'web-extraction', 'crawling']),
    serviceDescription: 'Enterprise web scraping and data extraction service',
    baseUrl: 'https://api.apify.com',
    acceptedCurrencies: JSON.stringify(['USDC']),
    usdcTokenAccount: SERVICE_WALLET_USDC_ACCOUNT,
    solanaPubkey: 'ApifyScraperPubKey1234567890',
    active: 1,
    verified: 1,
    ownerId: 'system',
    metadata: JSON.stringify({ type: 'scraper', tier: 'enterprise' }),
  },
  {
    id: 'agent-browse-002',
    agentId: 'agent://browse.ai/data-extractor/v1',
    name: 'Browse.ai',
    services: JSON.stringify(['data-scraping', 'web-extraction', 'monitoring']),
    serviceDescription: 'No-code web extraction and monitoring platform',
    baseUrl: 'https://api.browse.ai',
    acceptedCurrencies: JSON.stringify(['USDC']),
    usdcTokenAccount: SERVICE_WALLET_USDC_ACCOUNT,
    solanaPubkey: 'BrowseAiPubKey1234567890',
    active: 1,
    verified: 1,
    ownerId: 'system',
    metadata: JSON.stringify({ type: 'scraper', tier: 'standard' }),
  },
  {
    id: 'agent-rapid-003',
    agentId: 'agent://rapidapi.com/api-proxy/v1',
    name: 'RapidAPI',
    services: JSON.stringify(['api-calling', 'data-integration', 'external-api']),
    serviceDescription: 'Universal API gateway with 40,000+ APIs',
    baseUrl: 'https://rapidapi.com',
    acceptedCurrencies: JSON.stringify(['USDC']),
    usdcTokenAccount: SERVICE_WALLET_USDC_ACCOUNT,
    solanaPubkey: 'RapidAPIPubKey1234567890',
    active: 1,
    verified: 1,
    ownerId: 'system',
    metadata: JSON.stringify({ type: 'api-gateway', apiCount: 40000 }),
  },
  {
    id: 'agent-wolfram-004',
    agentId: 'agent://wolfram.com/compute-engine/v1',
    name: 'Wolfram Compute',
    services: JSON.stringify(['computation', 'data-analysis', 'analytics']),
    serviceDescription: 'Advanced computation and analytics engine',
    baseUrl: 'https://api.wolframalpha.com',
    acceptedCurrencies: JSON.stringify(['USDC']),
    usdcTokenAccount: SERVICE_WALLET_USDC_ACCOUNT,
    solanaPubkey: 'WolframPubKey1234567890',
    active: 1,
    verified: 1,
    ownerId: 'system',
    metadata: JSON.stringify({ type: 'compute', tier: 'premium' }),
  },
];

for (const agent of agents) {
  try {
    db.db.prepare(`
      INSERT OR REPLACE INTO registered_agents (
        id, agent_id, name, base_url, services, service_description, 
        accepted_currencies, usdc_token_account, solana_pubkey, 
        active, verified, owner_id, metadata, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agent.id, agent.agentId, agent.name, agent.baseUrl, agent.services,
      agent.serviceDescription, agent.acceptedCurrencies, agent.usdcTokenAccount,
      agent.solanaPubkey, agent.active, agent.verified, agent.ownerId,
      agent.metadata, timestamp, timestamp
    );
    console.log(`✓ Seeded agent: ${agent.name}`);
  } catch (e) {
    console.log(`Error seeding agent ${agent.name}:`, e);
  }
}

console.log('\n✅ Database setup complete!');
console.log(`✓ Seeded ${defaultPolicies.length} policies`);
console.log(`✓ Seeded ${agents.length} agents`);
})();
