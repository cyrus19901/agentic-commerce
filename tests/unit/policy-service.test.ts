/**
 * Unit Tests for PolicyService
 * Tests policy evaluation for both agent-to-merchant and agent-to-agent transactions
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { PolicyService } from '@agentic-commerce/core';
import { DB } from '@agentic-commerce/database';
import type { Policy, PurchaseRequest } from '@agentic-commerce/shared';

// Mock database
class MockDB extends DB {
  private mockPolicies: Policy[] = [];

  constructor() {
    super(':memory:'); // Use in-memory SQLite for tests
  }

  async getActivePolicies(userId?: string): Promise<Policy[]> {
    return this.mockPolicies;
  }

  setMockPolicies(policies: Policy[]) {
    this.mockPolicies = policies;
  }

  async getUserSpending(userId: string, period: 'daily' | 'weekly' | 'monthly'): Promise<number> {
    return 0; // Mock: no spending yet
  }
}

describe('PolicyService - Agent-to-Merchant', () => {
  let db: MockDB;
  let policyService: PolicyService;

  beforeEach(() => {
    db = new MockDB();
    policyService = new PolicyService(db);
  });

  it('should allow purchase under budget limit', async () => {
    const policy: Policy = {
      id: 'budget-1',
      name: 'Daily Budget Limit',
      type: 'budget',
      enabled: true,
      priority: 1,
      transactionTypes: ['agent-to-merchant'],
      conditions: {},
      rules: {
        maxAmount: 1000,
        period: 'daily',
      },
    };
    db.setMockPolicies([policy]);

    const request: PurchaseRequest = {
      userId: 'user-1',
      productId: 'prod-1',
      price: 50,
      merchant: 'Amazon',
      category: 'Electronics',
      transactionType: 'agent-to-merchant',
    };

    const result = await policyService.checkPurchase(request);
    
    expect(result.allowed).toBe(true);
    expect(result.matchedPolicies).toHaveLength(1);
    expect(result.matchedPolicies[0].passed).toBe(true);
  });

  it('should deny purchase exceeding budget limit', async () => {
    const policy: Policy = {
      id: 'budget-1',
      name: 'Daily Budget Limit',
      type: 'budget',
      enabled: true,
      priority: 1,
      transactionTypes: ['agent-to-merchant'],
      conditions: {},
      rules: {
        maxAmount: 100,
        period: 'daily',
      },
    };
    db.setMockPolicies([policy]);

    const request: PurchaseRequest = {
      userId: 'user-1',
      productId: 'prod-1',
      price: 500,
      merchant: 'Amazon',
      category: 'Electronics',
      transactionType: 'agent-to-merchant',
    };

    const result = await policyService.checkPurchase(request);
    
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('budget');
  });

  it('should block purchases from blocked merchants', async () => {
    const policy: Policy = {
      id: 'merchant-1',
      name: 'Blocked Merchants',
      type: 'merchant',
      enabled: true,
      priority: 1,
      transactionTypes: ['agent-to-merchant'],
      conditions: {},
      rules: {
        blockedMerchants: ['BadMerchant', 'ScamSite'],
      },
    };
    db.setMockPolicies([policy]);

    const request: PurchaseRequest = {
      userId: 'user-1',
      productId: 'prod-1',
      price: 50,
      merchant: 'BadMerchant',
      category: 'Electronics',
      transactionType: 'agent-to-merchant',
    };

    const result = await policyService.checkPurchase(request);
    
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('blocked');
  });

  it('should allow purchases from allowed merchants', async () => {
    const policy: Policy = {
      id: 'merchant-1',
      name: 'Allowed Merchants',
      type: 'merchant',
      enabled: true,
      priority: 1,
      transactionTypes: ['agent-to-merchant'],
      conditions: {},
      rules: {
        allowedMerchants: ['Amazon', 'BestBuy', 'Walmart'],
      },
    };
    db.setMockPolicies([policy]);

    const request: PurchaseRequest = {
      userId: 'user-1',
      productId: 'prod-1',
      price: 50,
      merchant: 'Amazon',
      category: 'Electronics',
      transactionType: 'agent-to-merchant',
    };

    const result = await policyService.checkPurchase(request);
    
    expect(result.allowed).toBe(true);
  });
});

describe('PolicyService - Agent-to-Agent', () => {
  let db: MockDB;
  let policyService: PolicyService;

  beforeEach(() => {
    db = new MockDB();
    policyService = new PolicyService(db);
  });

  it('should allow agent-to-agent purchase with correct recipient', async () => {
    const policy: Policy = {
      id: 'agent-1',
      name: 'Allowed Agents',
      type: 'agent',
      enabled: true,
      priority: 1,
      transactionTypes: ['agent-to-agent'],
      conditions: {},
      rules: {
        allowedRecipientAgents: ['agent://seller.scraper/v1', 'agent://data.analyzer/v1'],
      },
    };
    db.setMockPolicies([policy]);

    const request: PurchaseRequest = {
      userId: 'user-1',
      productId: 'service-scrape',
      price: 1.0,
      merchant: 'agent://seller.scraper/v1',
      category: 'scraping',
      transactionType: 'agent-to-agent',
      recipientAgentId: 'agent://seller.scraper/v1',
      buyerAgentId: 'agent://buyer/v1',
      serviceType: 'scrape',
    };

    const result = await policyService.checkPurchase(request);
    
    expect(result.allowed).toBe(true);
    expect(result.matchedPolicies).toHaveLength(1);
    expect(result.matchedPolicies[0].passed).toBe(true);
  });

  it('should block agent-to-agent purchase with blocked recipient', async () => {
    const policy: Policy = {
      id: 'agent-1',
      name: 'Blocked Agents',
      type: 'agent',
      enabled: true,
      priority: 1,
      transactionTypes: ['agent-to-agent'],
      conditions: {},
      rules: {
        blockedRecipientAgents: ['agent://suspicious.agent/v1'],
      },
    };
    db.setMockPolicies([policy]);

    const request: PurchaseRequest = {
      userId: 'user-1',
      productId: 'service-scrape',
      price: 1.0,
      merchant: 'agent://suspicious.agent/v1',
      category: 'scraping',
      transactionType: 'agent-to-agent',
      recipientAgentId: 'agent://suspicious.agent/v1',
      serviceType: 'scrape',
    };

    const result = await policyService.checkPurchase(request);
    
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('blocked');
  });

  it('should apply budget limits to agent-to-agent transactions', async () => {
    const policy: Policy = {
      id: 'budget-agent',
      name: 'Agent Service Budget',
      type: 'budget',
      enabled: true,
      priority: 1,
      transactionTypes: ['agent-to-agent'],
      conditions: {},
      rules: {
        maxAmount: 10,
        period: 'daily',
      },
    };
    db.setMockPolicies([policy]);

    const request: PurchaseRequest = {
      userId: 'user-1',
      productId: 'service-expensive',
      price: 50,
      merchant: 'agent://seller.scraper/v1',
      category: 'data-analysis',
      transactionType: 'agent-to-agent',
      serviceType: 'data-analysis',
    };

    const result = await policyService.checkPurchase(request);
    
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('budget');
  });

  it('should block specific service types', async () => {
    const policy: Policy = {
      id: 'service-1',
      name: 'Blocked Service Types',
      type: 'category',
      enabled: true,
      priority: 1,
      transactionTypes: ['agent-to-agent'],
      conditions: {},
      rules: {
        blockedCategories: ['cryptocurrency-trading', 'high-risk-services'],
      },
    };
    db.setMockPolicies([policy]);

    const request: PurchaseRequest = {
      userId: 'user-1',
      productId: 'service-crypto',
      price: 5,
      merchant: 'agent://crypto.trader/v1',
      category: 'cryptocurrency-trading',
      transactionType: 'agent-to-agent',
      serviceType: 'cryptocurrency-trading',
    };

    const result = await policyService.checkPurchase(request);
    
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('blocked');
  });
});

describe('PolicyService - Transaction Type Filtering', () => {
  let db: MockDB;
  let policyService: PolicyService;

  beforeEach(() => {
    db = new MockDB();
    policyService = new PolicyService(db);
  });

  it('should only apply merchant policies to merchant transactions', async () => {
    const policy: Policy = {
      id: 'merchant-only',
      name: 'Merchant Budget',
      type: 'budget',
      enabled: true,
      priority: 1,
      transactionTypes: ['agent-to-merchant'],
      conditions: {},
      rules: {
        maxAmount: 100,
        period: 'daily',
      },
    };
    db.setMockPolicies([policy]);

    // Agent-to-agent transaction should not be affected
    const request: PurchaseRequest = {
      userId: 'user-1',
      productId: 'service-1',
      price: 500,
      merchant: 'agent://seller/v1',
      transactionType: 'agent-to-agent',
    };

    const result = await policyService.checkPurchase(request);
    
    // Should be denied because no applicable policies (no agent-to-agent policies configured)
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('No policies configured');
  });

  it('should apply "all" policies to both transaction types', async () => {
    const policy: Policy = {
      id: 'universal-budget',
      name: 'Universal Budget',
      type: 'budget',
      enabled: true,
      priority: 1,
      transactionTypes: ['all'],
      conditions: {},
      rules: {
        maxAmount: 100,
        period: 'daily',
      },
    };
    db.setMockPolicies([policy]);

    // Test merchant transaction
    const merchantRequest: PurchaseRequest = {
      userId: 'user-1',
      productId: 'prod-1',
      price: 50,
      merchant: 'Amazon',
      transactionType: 'agent-to-merchant',
    };

    const merchantResult = await policyService.checkPurchase(merchantRequest);
    expect(merchantResult.allowed).toBe(true);

    // Test agent transaction
    const agentRequest: PurchaseRequest = {
      userId: 'user-1',
      productId: 'service-1',
      price: 50,
      merchant: 'agent://seller/v1',
      transactionType: 'agent-to-agent',
    };

    const agentResult = await policyService.checkPurchase(agentRequest);
    expect(agentResult.allowed).toBe(true);
  });
});
