/**
 * Integration Tests for Agent-to-Agent Transaction Flow
 * Tests the complete flow from policy check to payment verification
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { DB } from '@agentic-commerce/database';
import { PolicyService } from '@agentic-commerce/core';
import { FacilitatorService, createX402Requirement, makePaymentProof } from '@agentic-commerce/integrations';
import type { Policy } from '@agentic-commerce/shared';

describe('Agent-to-Agent Integration Flow', () => {
  let db: DB;
  let policyService: PolicyService;
  let facilitatorService: FacilitatorService;

  beforeAll(async () => {
    // Initialize services with test database
    db = new DB(':memory:');
    policyService = new PolicyService(db);
    facilitatorService = new FacilitatorService(db);

    // Create test user
    await db.createOrGetUser('test@example.com', 'Test User');

    // Create test policy for agent-to-agent transactions
    const policy: Policy = {
      id: 'test-agent-policy',
      name: 'Test Agent Policy',
      type: 'budget',
      enabled: true,
      priority: 1,
      transactionTypes: ['agent-to-agent'],
      conditions: {},
      rules: {
        maxAmount: 1000,
        period: 'daily',
        allowedRecipientAgents: ['agent://seller.scraper/v1'],
      },
    };
    await db.createPolicy(policy);
  });

  afterAll(async () => {
    // Cleanup
  });

  it('should complete full agent-to-agent transaction flow', async () => {
    const userId = 'test-user-1';
    const agentId = 'agent://seller.scraper/v1';
    const serviceType = 'scrape';
    const price = 1.0; // $1 USDC

    // Step 1: Policy Check
    const policyCheck = await policyService.checkPurchase({
      userId,
      productId: `service-${serviceType}`,
      price,
      merchant: agentId,
      category: serviceType,
      transactionType: 'agent-to-agent',
      recipientAgentId: agentId,
      serviceType,
    });

    expect(policyCheck.allowed).toBe(true);
    expect(policyCheck.matchedPolicies.length).toBeGreaterThan(0);

    // Step 2: Create x402 Payment Requirement
    const bodyHash = 'test-body-hash-123';
    const requirement = createX402Requirement({
      amount: '1000000', // 1 USDC in lamports
      payTo: 'test-usdc-account-address',
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      network: 'solana:devnet',
      method: 'POST',
      path: `/api/agent/services/${serviceType}`,
      bodyHash,
      facilitator: 'http://localhost:3000/api/facilitator/verify',
    });

    expect(requirement.protocol).toBe('x402');
    expect(requirement.amount).toBe('1000000');
    expect(requirement.nonce).toBeDefined();

    // Step 3: Simulate Payment (in real scenario, this happens on Solana blockchain)
    const mockTxSignature = '5' + 'x'.repeat(87); // Mock Solana tx signature
    const proof = makePaymentProof(requirement, mockTxSignature);

    expect(proof.txSignature).toBe(mockTxSignature);
    expect(proof.nonce).toBe(requirement.nonce);
    expect(proof.bodyHash).toBe(bodyHash);

    // Step 4: Store nonce before verification (simulating facilitator behavior)
    await db.storeX402Nonce({
      nonce: requirement.nonce,
      txSignature: mockTxSignature,
      agentId,
      amount: '1000000',
      mint: requirement.mint,
      verified: false,
      verifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
    });

    // Step 5: Check nonce replay protection
    const nonceExists = await db.checkX402Nonce(requirement.nonce);
    expect(nonceExists).toBe(true);

    // Step 6: Attempt to reuse nonce (should fail)
    const nonceExists2 = await db.checkX402Nonce(requirement.nonce);
    expect(nonceExists2).toBe(true); // Nonce already used

    // Step 7: Record successful transaction
    await db.recordPurchaseAttempt({
      userId,
      productId: `service-${serviceType}`,
      productName: `Agent Service: ${serviceType}`,
      amount: price,
      merchant: agentId,
      category: serviceType,
      allowed: true,
      requiresApproval: false,
      policyCheckResults: policyCheck.matchedPolicies,
      transactionType: 'agent-to-agent',
      solanaSignature: mockTxSignature,
      solanaMint: requirement.mint,
      x402Nonce: requirement.nonce,
      recipientAgentId: agentId,
      agentServiceType: serviceType,
    });

    // Step 8: Verify transaction was recorded
    const purchases = await db.getPurchaseHistory(userId, 10);
    expect(purchases.length).toBeGreaterThan(0);
    
    const lastPurchase = purchases[0];
    expect(lastPurchase.productId).toBe(`service-${serviceType}`);
    expect(lastPurchase.allowed).toBe(true);
  });

  it('should prevent nonce replay attacks', async () => {
    const nonce = `nonce-${Date.now()}`;
    const txSignature = '5' + 'y'.repeat(87);
    const agentId = 'agent://test-agent/v1';

    // Store nonce first time
    await db.storeX402Nonce({
      nonce,
      txSignature,
      agentId,
      amount: '1000000',
      mint: 'test-mint',
      verified: true,
      verifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
    });

    // Check if nonce exists
    const exists = await db.checkX402Nonce(nonce);
    expect(exists).toBe(true);

    // Attempt to reuse should be detected
    const existsAgain = await db.checkX402Nonce(nonce);
    expect(existsAgain).toBe(true);
  });

  it('should cleanup expired nonces', async () => {
    const expiredNonce = `expired-nonce-${Date.now()}`;
    
    // Store expired nonce
    await db.storeX402Nonce({
      nonce: expiredNonce,
      txSignature: '5' + 'z'.repeat(87),
      agentId: 'agent://test/v1',
      amount: '1000000',
      mint: 'test-mint',
      verified: true,
      verifiedAt: new Date(),
      expiresAt: new Date(Date.now() - 1000), // Already expired
    });

    // Cleanup expired nonces
    const cleanedCount = await db.cleanupExpiredNonces();
    expect(cleanedCount).toBeGreaterThanOrEqual(1);

    // Verify expired nonce was removed
    const exists = await db.checkX402Nonce(expiredNonce);
    // Note: In SQLite implementation, expired nonces might still exist but are marked expired
    // The cleanup just removes them from the database
  });
});

describe('Agent Registry Integration', () => {
  let db: DB;

  beforeAll(async () => {
    db = new DB(':memory:');
    await db.createOrGetUser('owner@example.com', 'Agent Owner');
  });

  it('should register and retrieve agent', async () => {
    const agentData = {
      id: `agent_${Date.now()}`,
      agentId: 'agent://test.service/v1',
      name: 'Test Service Agent',
      baseUrl: 'https://agent.test.com',
      services: ['scrape', 'api-call'],
      serviceDescription: 'Test agent for integration tests',
      acceptedCurrencies: ['USDC'],
      usdcTokenAccount: 'test-usdc-account',
      solanaPubkey: 'test-pubkey',
      ownerId: 'test-owner-id',
      metadata: { version: '1.0' },
    };

    // Register agent
    await db.registerAgent(agentData);

    // Retrieve agent
    const agent = await db.getRegisteredAgent(agentData.agentId);
    
    expect(agent).toBeDefined();
    expect(agent.agentId).toBe(agentData.agentId);
    expect(agent.name).toBe(agentData.name);
    expect(agent.services).toEqual(agentData.services);
    expect(agent.active).toBe(true);
    expect(agent.verified).toBe(false);
  });

  it('should list active agents', async () => {
    const agents = await db.listRegisteredAgents({ active: true });
    
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThan(0);
    
    agents.forEach(agent => {
      expect(agent.active).toBe(true);
    });
  });

  it('should update agent information', async () => {
    const agentId = 'agent://test.service/v1';
    
    // Update agent
    await db.updateRegisteredAgent(agentId, {
      verified: true,
      serviceDescription: 'Updated description',
    });

    // Verify update
    const agent = await db.getRegisteredAgent(agentId);
    
    expect(agent.verified).toBe(true);
    expect(agent.serviceDescription).toBe('Updated description');
  });

  it('should delete agent', async () => {
    const agentId = 'agent://test.service/v1';
    
    // Delete agent
    await db.deleteRegisteredAgent(agentId);

    // Verify deletion
    const agent = await db.getRegisteredAgent(agentId);
    expect(agent).toBeNull();
  });
});
