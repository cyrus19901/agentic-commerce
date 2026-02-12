#!/usr/bin/env node
/**
 * Database seeding script
 * Populates the database with test data including:
 * - Test user
 * - Sample products
 * - Sample policies (agent-to-merchant and agent-to-agent)
 * - Registered agents
 */

import { DB } from '../packages/database/src/index.js';

async function seedDatabase() {
  console.log('🌱 Starting database seed...\n');

  const db = new DB('./data/shopping.db');

  try {
    // 1. Create test user
    console.log('👤 Creating test user...');
    const userId = 'test-user-' + Date.now();
    const userEmail = `test-${Date.now()}@example.com`;
    
    const existingUser = db.db.prepare('SELECT * FROM users WHERE email = ?').get(userEmail);
    if (!existingUser) {
      db.db.prepare(`
        INSERT INTO users (id, email, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, userEmail, 'Test User', new Date().toISOString(), new Date().toISOString());
      console.log(`✓ Test user created: ${userEmail} (ID: ${userId})\n`);
    } else {
      console.log(`✓ User already exists: ${userEmail}\n`);
    }

    // 2. Insert sample products
    console.log('📦 Creating sample products...');
    const products = [
      {
        id: 'prod-laptop-001',
        name: 'MacBook Pro 16"',
        price: 2499.00,
        description: 'High-performance laptop',
        merchant: 'Apple Store',
        category: 'Electronics',
        imageUrl: 'https://example.com/macbook.jpg'
      },
      {
        id: 'prod-headphones-002',
        name: 'Sony WH-1000XM5',
        price: 399.99,
        description: 'Noise-cancelling headphones',
        merchant: 'Amazon',
        category: 'Electronics',
        imageUrl: 'https://example.com/headphones.jpg'
      },
      {
        id: 'prod-book-003',
        name: 'The Pragmatic Programmer',
        price: 49.99,
        description: 'Essential programming book',
        merchant: 'Amazon',
        category: 'Books',
        imageUrl: 'https://example.com/book.jpg'
      },
      {
        id: 'prod-coffee-004',
        name: 'Premium Coffee Beans',
        price: 19.99,
        description: 'Single-origin Ethiopian coffee',
        merchant: 'Starbucks',
        category: 'Food & Beverage',
        imageUrl: 'https://example.com/coffee.jpg'
      }
    ];

    for (const product of products) {
      const existing = db.db.prepare('SELECT * FROM products WHERE id = ?').get(product.id);
      if (!existing) {
        db.db.prepare(`
          INSERT INTO products (id, name, price, description, merchant, category, image_url, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          product.id,
          product.name,
          product.price,
          product.description,
          product.merchant,
          product.category,
          product.imageUrl,
          new Date().toISOString(),
          new Date().toISOString()
        );
        console.log(`  ✓ ${product.name} - $${product.price}`);
      }
    }
    console.log('');

    // 3. Create agent-to-merchant policies
    console.log('📋 Creating agent-to-merchant policies...');
    const merchantPolicies = [
      {
        id: 'policy-merchant-budget-001',
        name: 'Monthly Electronics Budget',
        type: 'budget',
        enabled: true,
        priority: 100,
        transactionTypes: JSON.stringify(['agent-to-merchant']),
        rules: JSON.stringify({
          maxAmount: 5000,
          period: 'monthly',
          allowedCategories: ['Electronics']
        })
      },
      {
        id: 'policy-merchant-vendor-002',
        name: 'Approved Merchants Only',
        type: 'merchant',
        enabled: true,
        priority: 90,
        transactionTypes: JSON.stringify(['agent-to-merchant']),
        rules: JSON.stringify({
          allowedMerchants: ['Amazon', 'Apple Store', 'Best Buy']
        })
      },
      {
        id: 'policy-merchant-amount-003',
        name: 'Transaction Limit $500',
        type: 'transaction',
        enabled: true,
        priority: 80,
        transactionTypes: JSON.stringify(['agent-to-merchant']),
        rules: JSON.stringify({
          maxTransactionAmount: 500
        })
      }
    ];

    for (const policy of merchantPolicies) {
      const existing = db.db.prepare('SELECT * FROM policies WHERE id = ?').get(policy.id);
      if (!existing) {
        db.db.prepare(`
          INSERT INTO policies (id, name, type, enabled, priority, transaction_types, conditions, rules, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          policy.id,
          policy.name,
          policy.type,
          policy.enabled ? 1 : 0,
          policy.priority,
          policy.transactionTypes,
          JSON.stringify({}), // conditions
          policy.rules,
          new Date().toISOString(),
          new Date().toISOString()
        );
        console.log(`  ✓ ${policy.name}`);
      }
    }
    console.log('');

    // 4. Create agent-to-agent policies
    console.log('🤖 Creating agent-to-agent policies...');
    const agentPolicies = [
      {
        id: 'policy-agent-budget-001',
        name: 'Agent Services Monthly Budget',
        type: 'budget',
        enabled: true,
        priority: 100,
        transactionTypes: JSON.stringify(['agent-to-agent']),
        rules: JSON.stringify({
          maxAmount: 100,
          period: 'monthly',
          allowedRecipientAgents: ['agent://seller-test/v1', 'agent://platform-agent/v1', 'agent://seller.scraper/v1', 'agent://seller.api-caller/v1']
        })
      },
      {
        id: 'policy-agent-service-002',
        name: 'Allowed Agent Services',
        type: 'agent',
        enabled: true,
        priority: 90,
        transactionTypes: JSON.stringify(['agent-to-agent']),
        rules: JSON.stringify({
          allowedRecipientAgents: ['agent://seller-test/v1', 'agent://platform-agent/v1', 'agent://seller.scraper/v1', 'agent://seller.api-caller/v1'],
          allowedAgentTypes: ['scraper', 'api-caller', 'test']
        })
      },
      {
        id: 'policy-agent-amount-003',
        name: 'Agent Transaction Limit $10',
        type: 'transaction',
        enabled: true,
        priority: 80,
        transactionTypes: JSON.stringify(['agent-to-agent']),
        rules: JSON.stringify({
          maxTransactionAmount: 10
        })
      }
    ];

    for (const policy of agentPolicies) {
      const existing = db.db.prepare('SELECT * FROM policies WHERE id = ?').get(policy.id);
      if (!existing) {
        db.db.prepare(`
          INSERT INTO policies (id, name, type, enabled, priority, transaction_types, conditions, rules, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          policy.id,
          policy.name,
          policy.type,
          policy.enabled ? 1 : 0,
          policy.priority,
          policy.transactionTypes,
          JSON.stringify({}), // conditions
          policy.rules,
          new Date().toISOString(),
          new Date().toISOString()
        );
        console.log(`  ✓ ${policy.name}`);
      }
    }
    console.log('');

    // 5. Create "All Transactions" policy
    console.log('🌐 Creating universal policies...');
    const universalPolicies = [
      {
        id: 'policy-all-time-001',
        name: 'Business Hours Only',
        type: 'time',
        enabled: true,
        priority: 70,
        transactionTypes: JSON.stringify(['all']),
        rules: JSON.stringify({
          allowedTimeRanges: [{ start: '09:00', end: '17:00' }],
          allowedDaysOfWeek: [1, 2, 3, 4, 5] // Monday to Friday
        })
      }
    ];

    for (const policy of universalPolicies) {
      const existing = db.db.prepare('SELECT * FROM policies WHERE id = ?').get(policy.id);
      if (!existing) {
        db.db.prepare(`
          INSERT INTO policies (id, name, type, enabled, priority, transaction_types, conditions, rules, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          policy.id,
          policy.name,
          policy.type,
          policy.enabled ? 1 : 0,
          policy.priority,
          policy.transactionTypes,
          JSON.stringify({}), // conditions
          policy.rules,
          new Date().toISOString(),
          new Date().toISOString()
        );
        console.log(`  ✓ ${policy.name}`);
      }
    }
    console.log('');

    // 6. Register sample agents
    console.log('🔧 Registering sample agents...');
    const agents = [
      {
        agentId: 'agent://seller.scraper/v1',
        name: 'Web Scraper Service',
        baseUrl: 'http://localhost:4001',
        services: ['scrape', 'extract'],
        serviceDescription: 'Extracts data from websites',
        acceptedCurrencies: ['USDC'],
        usdcTokenAccount: 'test-usdc-scraper-account',
        solanaPubkey: 'test-solana-pubkey-scraper',
        ownerId: userId
      },
      {
        agentId: 'agent://seller.api-caller/v1',
        name: 'API Caller Service',
        baseUrl: 'http://localhost:4002',
        services: ['api-call', 'webhook'],
        serviceDescription: 'Makes external API calls',
        acceptedCurrencies: ['USDC'],
        usdcTokenAccount: 'test-usdc-api-account',
        solanaPubkey: 'test-solana-pubkey-api',
        ownerId: userId
      },
      {
        agentId: 'agent://seller.analytics/v1',
        name: 'Analytics Service',
        baseUrl: 'http://localhost:4003',
        services: ['analytics', 'reporting'],
        serviceDescription: 'Provides data analytics',
        acceptedCurrencies: ['USDC'],
        usdcTokenAccount: 'test-usdc-analytics-account',
        solanaPubkey: 'test-solana-pubkey-analytics',
        ownerId: userId
      }
    ];

    for (const agent of agents) {
      try {
        const existing = await db.getRegisteredAgent(agent.agentId);
        if (!existing) {
          await db.registerAgent(agent);
          console.log(`  ✓ ${agent.name} (${agent.agentId})`);
        } else {
          console.log(`  • ${agent.name} already registered`);
        }
      } catch (error) {
        console.log(`  ✗ Failed to register ${agent.name}:`, error);
      }
    }
    console.log('');

    // 7. Link policies to user
    console.log('🔗 Linking policies to user...');
    const allPolicyIds = [
      ...merchantPolicies.map(p => p.id),
      ...agentPolicies.map(p => p.id),
      ...universalPolicies.map(p => p.id)
    ];

    for (const policyId of allPolicyIds) {
      const existing = db.db.prepare('SELECT * FROM user_policies WHERE user_id = ? AND policy_id = ?').get(userId, policyId);
      if (!existing) {
        db.db.prepare(`
          INSERT INTO user_policies (id, user_id, policy_id, created_at)
          VALUES (?, ?, ?, ?)
        `).run(
          `up-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          userId,
          policyId,
          new Date().toISOString()
        );
      }
    }
    console.log(`  ✓ Linked ${allPolicyIds.length} policies to user\n`);

    // Summary
    console.log('✅ Database seeding complete!\n');
    console.log('📊 Summary:');
    console.log(`  - User ID: ${userId}`);
    console.log(`  - Email: ${userEmail}`);
    console.log(`  - Products: ${products.length}`);
    console.log(`  - Merchant Policies: ${merchantPolicies.length}`);
    console.log(`  - Agent Policies: ${agentPolicies.length}`);
    console.log(`  - Universal Policies: ${universalPolicies.length}`);
    console.log(`  - Registered Agents: ${agents.length}`);
    console.log('');
    console.log('🧪 Test with:');
    console.log(`  export USER_ID="${userId}"`);
    console.log('  npm run dev');
    console.log('');

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seedDatabase();
