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

// Seed admin user from environment variable (required for authentication)
const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
const adminName = process.env.ADMIN_NAME || 'Admin';
try {
  const user = await db.createOrGetUser(adminEmail, adminName);
  console.log(`✓ Admin user ready: ${adminEmail} (ID: ${user.id})`);
  // Ensure admin role
  db.db.prepare(`UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), user.id);
} catch (e) {
  console.log('Error seeding admin user:', e);
}

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

  // ============================================
  // AGENT-TO-AGENT SPECIFIC POLICIES
  // ============================================

  {
    id: 'policy-21-a2a-scraper-limit',
    name: 'A2A: Web Scraping Services - $5 Limit',
    description: 'Restrict web scraping services to $5 per transaction',
    type: 'transaction',
    enabled: true,
    priority: 80,
    conditions: {
      transactionType: ['agent-to-agent'],
      serviceType: ['data-scraping', 'scrape', 'web-scraper'],
    },
    rules: {
      maxTransactionAmount: 5,
      fallbackAction: 'deny',
    },
  },

  {
    id: 'policy-22-a2a-api-require-approval',
    name: 'A2A: API Services Require Approval',
    description: 'All API calling services require manager approval',
    type: 'transaction',
    enabled: true,
    priority: 75,
    conditions: {
      transactionType: ['agent-to-agent'],
      serviceType: ['api-call', 'api-calling', 'external-api'],
    },
    rules: {
      fallbackAction: 'require_approval',
    },
  },

  {
    id: 'policy-23-a2a-expensive-services-approval',
    name: 'A2A: Services Over $2 Require Approval',
    description: 'Agent services costing more than $2 need approval',
    type: 'transaction',
    enabled: true,
    priority: 70,
    conditions: {
      transactionType: ['agent-to-agent'],
    },
    rules: {
      maxTransactionAmount: 2,
      fallbackAction: 'require_approval',
    },
  },

  {
    id: 'policy-24-a2a-block-specific-agents',
    name: 'A2A: Block Untrusted Agents',
    description: 'Block specific agents from receiving payments',
    type: 'agent',
    enabled: false, // Disabled by default - enable for testing by blocking Wolfram agent
    priority: 90,
    conditions: {
      transactionType: ['agent-to-agent'],
    },
    rules: {
      blockedRecipientAgents: [
        'agent://wolfram.com/compute-engine/v1', // For testing - blocks Wolfram
        'agent://untrusted.com/service',
        'agent://suspicious-bot.io/scraper',
      ],
      fallbackAction: 'deny',
    },
  },

  {
    id: 'policy-25-a2a-whitelist-agents',
    name: 'A2A: Only Allow Trusted Agents',
    description: 'Only allow payments to pre-approved trusted agents',
    type: 'agent',
    enabled: false, // Disabled by default - too restrictive
    priority: 95,
    conditions: {
      transactionType: ['agent-to-agent'],
    },
    rules: {
      allowedRecipientAgents: [
        'agent://apify.com/web-scraper/v1',
        'agent://browse.ai/scraper',
        'agent://rapidapi.com/api-caller',
      ],
      fallbackAction: 'deny',
    },
  },

  {
    id: 'policy-26-a2a-data-analysis-budget',
    name: 'A2A: Data Analysis Monthly Budget - $50',
    description: 'Limit data analysis services to $50 per month',
    type: 'budget',
    enabled: true,
    priority: 65,
    conditions: {
      transactionType: ['agent-to-agent'],
      serviceType: ['data-analysis', 'analytics', 'compute'],
    },
    rules: {
      maxAmount: 50,
      period: 'monthly',
      fallbackAction: 'deny',
    },
  },

  {
    id: 'policy-27-a2a-scraping-daily-limit',
    name: 'A2A: Scraping Daily Limit - $10',
    description: 'Limit web scraping to $10 per day to prevent abuse',
    type: 'budget',
    enabled: true,
    priority: 60,
    conditions: {
      transactionType: ['agent-to-agent'],
      serviceType: ['data-scraping', 'scrape', 'web-scraper'],
    },
    rules: {
      maxAmount: 10,
      period: 'daily',
      fallbackAction: 'deny',
    },
  },

  {
    id: 'policy-28-a2a-auto-approve-cheap',
    name: 'A2A: Auto-Approve Services Under $0.50',
    description: 'Automatically approve cheap agent services',
    type: 'transaction',
    enabled: true,
    priority: 5,
    conditions: {
      transactionType: ['agent-to-agent'],
    },
    rules: {
      compositeConditions: [
        { field: 'amount', operator: 'less_than_or_equal', value: 0.5 },
      ],
      fallbackAction: 'approve',
    },
  },

  {
    id: 'policy-29-a2a-per-agent-daily-limit',
    name: 'A2A: $5 Daily Limit Per Agent',
    description: 'Limit spending to $5 per day per specific agent',
    type: 'composite',
    enabled: true,
    priority: 55,
    conditions: {
      transactionType: ['agent-to-agent'],
    },
    rules: {
      perAgentDailyLimit: 5,
      fallbackAction: 'require_approval',
    },
  },

  {
    id: 'policy-30-a2a-weekend-approval',
    name: 'A2A: Weekend Services Require Approval',
    description: 'Agent services on weekends need manager approval',
    type: 'time',
    enabled: false, // Disabled by default
    priority: 50,
    conditions: {
      transactionType: ['agent-to-agent'],
    },
    rules: {
      allowedDays: [1, 2, 3, 4, 5], // Monday-Friday
      fallbackAction: 'require_approval',
    },
  },
  
  // Simple practical policies for easy testing
  {
    id: 'policy-31-block-facebook-scraping',
    name: 'Block Facebook Scraping',
    description: 'Cannot scrape data from Facebook',
    type: 'composite',
    enabled: true,
    priority: 95,
    conditions: {
      transactionType: ['agent-to-agent'],
      serviceType: ['data-scraping', 'scrape', 'web-scraper'],
    },
    rules: {
      compositeConditions: [
        { field: 'purpose', operator: 'contains', value: 'facebook' },
      ],
      fallbackAction: 'deny',
    },
  },
  
  {
    id: 'policy-32-block-twitter-scraping',
    name: 'Block Twitter Scraping',
    description: 'Cannot scrape data from Twitter/X',
    type: 'composite',
    enabled: true,
    priority: 95,
    conditions: {
      transactionType: ['agent-to-agent'],
      serviceType: ['data-scraping', 'scrape', 'web-scraper'],
    },
    rules: {
      compositeConditions: [
        { field: 'purpose', operator: 'contains', value: 'twitter' },
      ],
      fallbackAction: 'deny',
    },
  },
  
  {
    id: 'policy-33-block-linkedin-scraping',
    name: 'Block LinkedIn Scraping',
    description: 'Cannot scrape data from LinkedIn',
    type: 'composite',
    enabled: true,
    priority: 95,
    conditions: {
      transactionType: ['agent-to-agent'],
      serviceType: ['data-scraping', 'scrape', 'web-scraper'],
    },
    rules: {
      compositeConditions: [
        { field: 'purpose', operator: 'contains', value: 'linkedin' },
      ],
      fallbackAction: 'deny',
    },
  },
  
  {
    id: 'policy-34-block-expensive-ai-services',
    name: 'Block Expensive AI/ML Services',
    description: 'Cannot use advanced-analysis, ml-inference, or data-pipeline services',
    type: 'transaction',
    enabled: true,
    priority: 90,
    conditions: {
      transactionType: ['agent-to-agent'],
      serviceType: ['advanced-analysis', 'ml-inference', 'data-pipeline'],
    },
    rules: {
      fallbackAction: 'deny',
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
// For testing, use the user's own ATA so payments go back to them
const SERVICE_WALLET_USDC_ACCOUNT = process.env.SERVICE_WALLET_USDC || 'D8SWG8sHtTrZV39LMtZ86rWtjmZAj32pnedx6pp5ffC4';

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
  {
    id: 'agent-aiservices-005',
    agentId: 'agent://aiservices.io/enterprise/v1',
    name: 'AI Services Enterprise',
    services: JSON.stringify(['advanced-analysis', 'ml-inference', 'data-pipeline']),
    serviceDescription: 'Enterprise AI and ML services for advanced data processing',
    baseUrl: 'https://api.aiservices.io',
    acceptedCurrencies: JSON.stringify(['USDC']),
    usdcTokenAccount: SERVICE_WALLET_USDC_ACCOUNT,
    solanaPubkey: 'AIServicesPubKey1234567890',
    active: 1,
    verified: 1,
    ownerId: 'system',
    metadata: JSON.stringify({ type: 'ai-ml', tier: 'enterprise', highCost: true }),
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

// Seed sample products from approved merchants
console.log('\n📦 Seeding sample products...');

const products = [
  {
    id: 'prod-notebook-001',
    name: 'Minimalist Leather Notebook',
    price: 28.99,
    description: 'Premium leather notebook with 200 pages',
    merchant: 'MinimalGoods',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/notebook.jpg'
  },
  {
    id: 'prod-pen-002',
    name: 'Premium Pen Set',
    price: 45.00,
    description: 'Executive pen set with ballpoint and fountain pen',
    merchant: 'OfficeComfort',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/pens.jpg'
  },
  {
    id: 'prod-bag-003',
    name: 'Handmade Leather Messenger Bag',
    price: 89.99,
    description: 'Artisan leather messenger bag with laptop compartment',
    merchant: 'ArtisanLeatherCo',
    category: 'Bags & Purses',
    imageUrl: 'https://example.com/bag.jpg'
  },
  {
    id: 'prod-headphones-004',
    name: 'Studio Monitor Headphones',
    price: 199.99,
    description: 'Professional studio monitor headphones',
    merchant: 'TechAudio',
    category: 'Electronics',
    imageUrl: 'https://example.com/headphones.jpg'
  },
  {
    id: 'prod-keychain-005',
    name: 'Silver Keychain',
    price: 24.99,
    description: 'Handcrafted sterling silver keychain',
    merchant: 'SilverCraft',
    category: 'Office & Business',
    imageUrl: 'https://example.com/keychain.jpg'
  },
  {
    id: 'prod-organizer-006',
    name: 'Desk Organizer Set',
    price: 35.50,
    description: 'Bamboo desk organizer with multiple compartments',
    merchant: 'MinimalGoods',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/organizer.jpg'
  },
  {
    id: 'prod-chair-007',
    name: 'Ergonomic Office Chair',
    price: 299.00,
    description: 'Adjustable ergonomic office chair with lumbar support',
    merchant: 'OfficeComfort',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/chair.jpg'
  },
  {
    id: 'prod-wallet-008',
    name: 'Leather Bifold Wallet',
    price: 49.99,
    description: 'Slim leather bifold wallet with RFID protection',
    merchant: 'ArtisanLeatherCo',
    category: 'Bags & Purses',
    imageUrl: 'https://example.com/wallet.jpg'
  },
  // Additional MinimalGoods products
  {
    id: 'prod-journal-009',
    name: 'Daily Journal',
    price: 18.99,
    description: 'Minimalist daily journal with dotted pages',
    merchant: 'MinimalGoods',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/journal.jpg'
  },
  {
    id: 'prod-planner-010',
    name: 'Weekly Planner',
    price: 22.50,
    description: 'Simple weekly planner for productivity',
    merchant: 'MinimalGoods',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/planner.jpg'
  },
  {
    id: 'prod-tote-011',
    name: 'Canvas Tote Bag',
    price: 32.00,
    description: 'Minimalist canvas tote with leather handles',
    merchant: 'MinimalGoods',
    category: 'Bags & Purses',
    imageUrl: 'https://example.com/tote.jpg'
  },
  // Additional OfficeComfort products
  {
    id: 'prod-lamp-012',
    name: 'LED Desk Lamp',
    price: 45.99,
    description: 'Adjustable LED desk lamp with USB charging',
    merchant: 'OfficeComfort',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/lamp.jpg'
  },
  {
    id: 'prod-mousepad-013',
    name: 'Premium Mouse Pad',
    price: 15.99,
    description: 'Large ergonomic mouse pad with wrist support',
    merchant: 'OfficeComfort',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/mousepad.jpg'
  },
  {
    id: 'prod-monitor-014',
    name: 'Monitor Stand',
    price: 38.50,
    description: 'Bamboo monitor stand with storage drawer',
    merchant: 'OfficeComfort',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/monitor-stand.jpg'
  },
  {
    id: 'prod-footrest-015',
    name: 'Ergonomic Footrest',
    price: 42.00,
    description: 'Adjustable ergonomic footrest for office',
    merchant: 'OfficeComfort',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/footrest.jpg'
  },
  // Additional ArtisanLeatherCo products
  {
    id: 'prod-portfolio-016',
    name: 'Leather Portfolio',
    price: 125.00,
    description: 'Professional leather portfolio with notepad',
    merchant: 'ArtisanLeatherCo',
    category: 'Bags & Purses',
    imageUrl: 'https://example.com/portfolio.jpg'
  },
  {
    id: 'prod-cardholder-017',
    name: 'Leather Card Holder',
    price: 29.99,
    description: 'Slim leather card holder with 6 slots',
    merchant: 'ArtisanLeatherCo',
    category: 'Office & Business',
    imageUrl: 'https://example.com/cardholder.jpg'
  },
  {
    id: 'prod-deskpad-018',
    name: 'Leather Desk Pad',
    price: 65.00,
    description: 'Full-grain leather desk pad',
    merchant: 'ArtisanLeatherCo',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/deskpad.jpg'
  },
  {
    id: 'prod-briefcase-019',
    name: 'Leather Briefcase',
    price: 385.00,
    description: 'Executive leather briefcase with laptop compartment',
    merchant: 'ArtisanLeatherCo',
    category: 'Bags & Purses',
    imageUrl: 'https://example.com/briefcase.jpg'
  },
  // Additional TechAudio products
  {
    id: 'prod-speakers-020',
    name: 'Desktop Speakers',
    price: 89.99,
    description: 'Compact desktop speakers with premium sound',
    merchant: 'TechAudio',
    category: 'Electronics',
    imageUrl: 'https://example.com/speakers.jpg'
  },
  {
    id: 'prod-microphone-021',
    name: 'USB Microphone',
    price: 129.00,
    description: 'Professional USB microphone for calls and recording',
    merchant: 'TechAudio',
    category: 'Electronics',
    imageUrl: 'https://example.com/microphone.jpg'
  },
  {
    id: 'prod-earbuds-022',
    name: 'Wireless Earbuds',
    price: 79.99,
    description: 'True wireless earbuds with noise cancellation',
    merchant: 'TechAudio',
    category: 'Electronics',
    imageUrl: 'https://example.com/earbuds.jpg'
  },
  // Additional SilverCraft products
  {
    id: 'prod-pen-023',
    name: 'Silver Ballpoint Pen',
    price: 45.00,
    description: 'Sterling silver ballpoint pen',
    merchant: 'SilverCraft',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/silver-pen.jpg'
  },
  {
    id: 'prod-paperweight-024',
    name: 'Silver Paperweight',
    price: 38.50,
    description: 'Handcrafted silver paperweight',
    merchant: 'SilverCraft',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/paperweight.jpg'
  },
  {
    id: 'prod-cardholder-025',
    name: 'Silver Business Card Holder',
    price: 55.00,
    description: 'Elegant silver business card holder',
    merchant: 'SilverCraft',
    category: 'Office & Business',
    imageUrl: 'https://example.com/silver-cardholder.jpg'
  },
  {
    id: 'prod-letteropener-026',
    name: 'Silver Letter Opener',
    price: 32.00,
    description: 'Handcrafted silver letter opener',
    merchant: 'SilverCraft',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/letteropener.jpg'
  },
  // More variety - different price points
  {
    id: 'prod-sticky-027',
    name: 'Sticky Note Set',
    price: 8.99,
    description: 'Colorful sticky notes in 5 sizes',
    merchant: 'MinimalGoods',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/sticky.jpg'
  },
  {
    id: 'prod-clips-028',
    name: 'Binder Clips Set',
    price: 6.50,
    description: 'Assorted binder clips 30-pack',
    merchant: 'OfficeComfort',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/clips.jpg'
  },
  {
    id: 'prod-highlighters-029',
    name: 'Highlighter Set',
    price: 12.99,
    description: 'Premium highlighters in 8 colors',
    merchant: 'OfficeComfort',
    category: 'Office Supplies',
    imageUrl: 'https://example.com/highlighters.jpg'
  },
  {
    id: 'prod-folders-030',
    name: 'File Folders Pack',
    price: 14.99,
    description: 'Manila file folders 25-pack',
    merchant: 'MinimalGoods',
    category: 'Paper & Party Supplies',
    imageUrl: 'https://example.com/folders.jpg'
  }
];

for (const product of products) {
  try {
    db.db.prepare(`
      INSERT OR REPLACE INTO products (
        id, name, price, description, merchant, category, image_url, 
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      product.id,
      product.name,
      product.price,
      product.description,
      product.merchant,
      product.category,
      product.imageUrl,
      timestamp,
      timestamp
    );
    console.log(`✓ Seeded product: ${product.name} ($${product.price})`);
  } catch (e) {
    console.log(`Error seeding product ${product.name}:`, e);
  }
}

console.log('\n✅ Database setup complete!');
console.log(`✓ Seeded ${defaultPolicies.length} policies`);
console.log(`✓ Seeded ${agents.length} agents`);
console.log(`✓ Seeded ${products.length} products`);
})();
