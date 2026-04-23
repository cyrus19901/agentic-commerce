/**
 * E2E Tests for Agent-to-Agent API
 * Tests the complete HTTP flow including 402 handshake
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createX402Requirement, makePaymentProof, b64urlEncodeJson } from '@agentic-commerce/integrations';

// Mock HTTP client (replace with actual HTTP client in real tests)
type HTTPClient = {
  post: (url: string, options: any) => Promise<{ status: number; headers: Record<string, string>; data: any }>;
  get: (url: string, options?: any) => Promise<{ status: number; data: any }>;
};

describe('Agent-to-Agent E2E API Tests', () => {
  const API_BASE = process.env.TEST_API_URL || 'http://localhost:3000';
  const TEST_TOKEN = process.env.TEST_JWT_TOKEN || 'test-token';

  let http: HTTPClient;

  beforeAll(() => {
    // Initialize HTTP client
    // In real implementation, use axios or fetch
    http = {
      post: async (url, options) => {
        // Mock implementation
        return {
          status: 200,
          headers: {},
          data: {},
        };
      },
      get: async (url, options) => {
        return {
          status: 200,
          data: {},
        };
      },
    };
  });

  describe('Agent Service with 402 Handshake', () => {
    it('should return 402 on first request without payment', async () => {
      const serviceType = 'scrape';
      const requestBody = {
        url: 'https://example.com',
        mode: 'demo',
      };

      // First request (no payment)
      const response1 = await http.post(
        `${API_BASE}/api/agent/services/${serviceType}`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      // Should return 402 Payment Required
      expect(response1.status).toBe(402);
      expect(response1.headers['payment-required']).toBeDefined();
      expect(response1.data.error).toBe('PAYMENT_REQUIRED');
      expect(response1.data.requirement).toBeDefined();

      // Verify requirement structure
      const requirement = response1.data.requirement;
      expect(requirement.protocol).toBe('x402');
      expect(requirement.version).toBe('v2');
      expect(requirement.nonce).toBeDefined();
      expect(requirement.amount).toBeDefined();
      expect(requirement.payTo).toBeDefined();
    });

    it('should complete transaction with valid payment proof', async () => {
      const serviceType = 'scrape';
      const requestBody = {
        url: 'https://example.com',
        mode: 'demo',
      };

      // Step 1: First request to get payment requirement
      const response1 = await http.post(
        `${API_BASE}/api/agent/services/${serviceType}`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      expect(response1.status).toBe(402);
      const requirement = response1.data.requirement;

      // Step 2: Simulate payment on Solana
      // In real test, this would interact with Solana devnet
      const mockTxSignature = '5' + 'x'.repeat(87);
      const proof = makePaymentProof(requirement, mockTxSignature);

      // Step 3: Retry request with payment proof
      const response2 = await http.post(
        `${API_BASE}/api/agent/services/${serviceType}`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_TOKEN}`,
            'Content-Type': 'application/json',
            'Payment-Signature': b64urlEncodeJson(proof),
          },
          body: JSON.stringify(requestBody),
        }
      );

      // Should return 200 with service response and receipt
      expect(response2.status).toBe(200);
      expect(response2.headers['payment-response']).toBeDefined();
      expect(response2.data.ok).toBe(true);
      expect(response2.data.service).toBe(serviceType);
      expect(response2.data.data).toBeDefined();
    });

    it('should reject invalid payment proof', async () => {
      const serviceType = 'scrape';
      const requestBody = {
        url: 'https://example.com',
      };

      // Invalid payment proof
      const invalidProof = {
        txSignature: 'invalid-signature',
        nonce: 'invalid-nonce',
        bodyHash: 'invalid-hash',
        payTo: 'invalid-account',
        amount: '0',
        mint: 'invalid-mint',
        network: 'invalid-network',
      };

      const response = await http.post(
        `${API_BASE}/api/agent/services/${serviceType}`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_TOKEN}`,
            'Content-Type': 'application/json',
            'Payment-Signature': b64urlEncodeJson(invalidProof),
          },
          body: JSON.stringify(requestBody),
        }
      );

      // Should return 400 or 402 with error
      expect([400, 402]).toContain(response.status);
      expect(response.data.error).toBeDefined();
    });

    it('should reject replay attempts (nonce reuse)', async () => {
      // This test requires coordination with facilitator
      // Skipped in mock implementation
    });
  });

  describe('Agent Registry API', () => {
    it('should register a new agent', async () => {
      const agentData = {
        agentId: `agent://test-${Date.now()}.service/v1`,
        name: 'Test E2E Agent',
        baseUrl: 'https://test-agent.example.com',
        services: ['scrape', 'api-call'],
        serviceDescription: 'Test agent for E2E tests',
        acceptedCurrencies: ['USDC'],
        usdcTokenAccount: 'test-usdc-account',
        solanaPubkey: 'test-solana-pubkey',
      };

      const response = await http.post(
        `${API_BASE}/api/registry/agents`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(agentData),
        }
      );

      expect(response.status).toBe(201);
      expect(response.data.success).toBe(true);
      expect(response.data.agent).toBeDefined();
      expect(response.data.agent.agentId).toBe(agentData.agentId);
    });

    it('should discover registered agent', async () => {
      const agentId = 'agent://test.service/v1';

      const response = await http.get(
        `${API_BASE}/api/registry/agents/${encodeURIComponent(agentId)}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.agentId).toBe(agentId);
      expect(response.data.baseUrl).toBeDefined();
      expect(response.data.services).toBeDefined();
      expect(Array.isArray(response.data.services)).toBe(true);
    });

    it('should list all active agents', async () => {
      const response = await http.get(
        `${API_BASE}/api/registry/agents`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.agents).toBeDefined();
      expect(Array.isArray(response.data.agents)).toBe(true);
      expect(response.data.count).toBeGreaterThanOrEqual(0);
    });

    it('should filter agents by service type', async () => {
      const serviceType = 'scrape';

      const response = await http.get(
        `${API_BASE}/api/registry/agents?service=${serviceType}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data.agents)).toBe(true);
      
      // All agents should offer the requested service
      response.data.agents.forEach((agent: any) => {
        expect(agent.services).toContain(serviceType);
      });
    });
  });

  describe('Facilitator API', () => {
    it('should verify valid payment proof', async () => {
      // Mock valid proof and expected values
      const proof = {
        txSignature: '5' + 'x'.repeat(87),
        nonce: `test-nonce-${Date.now()}`,
        bodyHash: 'a'.repeat(64),
        payTo: 'test-account',
        amount: '1000000',
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        network: 'solana:devnet',
      };

      const expected = {
        mint: proof.mint,
        payTo: proof.payTo,
        network: proof.network,
        bodyHash: proof.bodyHash,
      };

      const response = await http.post(
        `${API_BASE}/api/facilitator/verify`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ proof, expected }),
        }
      );

      // Note: In real test, this would require actual Solana transaction
      // For mock, we expect 404 (tx not found) or success if mocked properly
      expect([200, 404, 502]).toContain(response.status);
    });

    it('should reject proof with nonce reuse', async () => {
      // This test would require storing a nonce first
      // Then attempting to reuse it
      // Skipped in mock implementation
    });
  });
});

describe('Policy Enforcement E2E', () => {
  const API_BASE = process.env.TEST_API_URL || 'http://localhost:3000';
  const TEST_TOKEN = process.env.TEST_JWT_TOKEN || 'test-token';

  it('should enforce budget limits on agent-to-agent transactions', async () => {
    // Test that budget policies work end-to-end
    // This would require:
    // 1. Creating a policy with low budget
    // 2. Attempting expensive agent-to-agent transaction
    // 3. Verifying it's blocked
  });

  it('should enforce recipient agent restrictions', async () => {
    // Test that agent allowlist/blocklist works
  });

  it('should require approval for over-limit transactions', async () => {
    // Test approval workflow for agent-to-agent
  });
});
