import { DB } from '@agentic-commerce/database';
import crypto from 'crypto';

function generateGuid(): string {
  return crypto.randomUUID();
}

async function createSamplePolicies() {
  const db = new DB('./data/shopping.db');
  
  // Get dev user
  const devUser = await db.getUserByEmail('dev@example.com');
  if (!devUser) {
    console.error('❌ Dev user not found. Run scripts/create-dev-user.ts first');
    return;
  }

  console.log('✅ Creating sample policies for:', devUser.email);

  // ============================================================================
  // AGENT-TO-MERCHANT POLICIES (Product Purchases)
  // ============================================================================

  // Policy 1: Auto-approve small purchases under $100
  const policy1 = {
    id: generateGuid(),
    name: 'Auto-approve Small Purchases',
    type: 'transaction' as const,
    enabled: true,
    priority: 100,
    transactionTypes: ['agent-to-merchant'] as any,
    conditions: {},
    rules: {
      maxTransactionAmount: 100,
      fallbackAction: 'approve' as const,
    },
  };

  // Policy 2: Require approval for purchases over $500
  const policy2 = {
    id: generateGuid(),
    name: 'Require Approval for Large Purchases',
    type: 'transaction' as const,
    enabled: true,
    priority: 90,
    transactionTypes: ['agent-to-merchant'] as any,
    conditions: {
      minAmount: 500
    },
    rules: {
      minTransactionAmount: 500,
      fallbackAction: 'require_approval' as const,
    },
  };

  // Policy 3: Block specific high-risk merchants
  const policy3 = {
    id: generateGuid(),
    name: 'Block High-Risk Merchants',
    type: 'merchant' as const,
    enabled: true,
    priority: 200, // High priority
    transactionTypes: ['agent-to-merchant'] as any,
    conditions: {},
    rules: {
      blockedMerchants: ['Crypto Exchange', 'Gambling Site', 'Unverified Seller'],
      fallbackAction: 'deny' as const,
    },
  };

  // Policy 4: Allow specific trusted merchants
  const policy4 = {
    id: generateGuid(),
    name: 'Trusted Merchant Whitelist',
    type: 'merchant' as const,
    enabled: true,
    priority: 150,
    transactionTypes: ['agent-to-merchant'] as any,
    conditions: {},
    rules: {
      allowedMerchants: ['Amazon', 'Google Cloud', 'Microsoft Azure', 'OpenAI', 'Anthropic'],
      fallbackAction: 'approve' as const,
    },
  };

  // Policy 5: Category restrictions
  const policy5 = {
    id: generateGuid(),
    name: 'Restrict Entertainment Purchases',
    type: 'category' as const,
    enabled: true,
    priority: 110,
    transactionTypes: ['agent-to-merchant'] as any,
    conditions: {},
    rules: {
      blockedCategories: ['Entertainment', 'Gaming', 'Luxury'],
      fallbackAction: 'require_approval' as const,
    },
  };

  // ============================================================================
  // AGENT-TO-AGENT POLICIES (Service Purchases)
  // ============================================================================

  // Policy 6: Auto-approve small AI service costs under $50
  const policy6 = {
    id: generateGuid(),
    name: 'Auto-approve Small AI Services',
    type: 'transaction' as const,
    enabled: true,
    priority: 100,
    transactionTypes: ['agent-to-agent'] as any,
    conditions: {},
    rules: {
      maxTransactionAmount: 50,
      fallbackAction: 'approve' as const,
    },
  };

  // Policy 7: Allow specific service types
  const policy7 = {
    id: generateGuid(),
    name: 'Allow Essential AI Services',
    type: 'composite' as const,
    enabled: true,
    priority: 120,
    transactionTypes: ['agent-to-agent'] as any,
    conditions: {},
    rules: {
      allowedServiceTypes: ['API Access', 'Data Processing', 'Model Inference', 'Translation'],
      fallbackAction: 'approve' as const,
    },
  };

  // Policy 8: Require approval for expensive services
  const policy8 = {
    id: generateGuid(),
    name: 'Approve Expensive AI Services',
    type: 'transaction' as const,
    enabled: true,
    priority: 90,
    transactionTypes: ['agent-to-agent'] as any,
    conditions: {
      minAmount: 200
    },
    rules: {
      minTransactionAmount: 200,
      fallbackAction: 'require_approval' as const,
    },
  };

  // Policy 9: Block certain service categories
  const policy9 = {
    id: generateGuid(),
    name: 'Block Risky AI Services',
    type: 'composite' as const,
    enabled: true,
    priority: 180,
    transactionTypes: ['agent-to-agent'] as any,
    conditions: {},
    rules: {
      blockedServiceTypes: ['Cryptocurrency Trading', 'High-Frequency Trading', 'Unverified Model'],
      fallbackAction: 'deny' as const,
    },
  };

  // Policy 10: Service category budget
  const policy10 = {
    id: generateGuid(),
    name: 'Computing Services Daily Limit',
    type: 'budget' as const,
    enabled: true,
    priority: 80,
    transactionTypes: ['agent-to-agent'] as any,
    conditions: {},
    rules: {
      maxAmount: 500,
      period: 'daily' as const,
      allowedServiceCategories: ['Computing', 'Cloud Services'],
      fallbackAction: 'require_approval' as const,
    },
  };

  // Insert all policies
  const policies = [
    policy1, policy2, policy3, policy4, policy5,
    policy6, policy7, policy8, policy9, policy10
  ];

  for (const policy of policies) {
    try {
      const now = new Date().toISOString();
      
      // Insert policy
      db['db'].prepare(`
        INSERT OR REPLACE INTO policies (id, name, type, enabled, priority, conditions, rules, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        policy.id,
        policy.name,
        policy.type,
        policy.enabled ? 1 : 0,
        policy.priority,
        JSON.stringify(policy.conditions),
        JSON.stringify(policy.rules),
        now,
        now
      );

      // Assign policy to dev user
      const userPolicyId = generateGuid();
      db['db'].prepare(`
        INSERT OR IGNORE INTO user_policies (id, user_id, policy_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(userPolicyId, devUser.id, policy.id, now);

      const txType = policy.transactionTypes[0] === 'agent-to-merchant' ? '🛒 A2M' : '🤖 A2A';
      console.log(`✅ ${txType} - ${policy.name} (${policy.type})`);
    } catch (error) {
      console.error(`❌ Failed to create ${policy.name}:`, error);
    }
  }

  console.log('\n📊 Policy Summary:');
  console.log(`- Total policies created: ${policies.length}`);
  console.log(`- Agent-to-Merchant: 5 policies`);
  console.log(`- Agent-to-Agent: 5 policies`);
  console.log(`\n🧪 Test with ChatGPT by making transactions!`);
}

createSamplePolicies()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
