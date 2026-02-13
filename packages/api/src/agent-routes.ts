/**
 * Agent-to-Agent Transaction Routes
 * Implements x402 protocol for micropayments between agents
 */

import { Router } from 'express';
import { DB } from '@agentic-commerce/database';
import { PolicyService } from '@agentic-commerce/core';
import { 
  FacilitatorService,
  createX402Requirement,
  b64urlEncodeJson,
  b64urlDecodeJson,
  sha256HexUtf8,
  validatePaymentProof
} from '@agentic-commerce/integrations';
import type { X402PaymentProof } from '@agentic-commerce/shared';

export function createAgentRoutes(
  db: DB,
  policyService: PolicyService,
  facilitatorService: FacilitatorService
) {
  const router = Router();

  /**
   * Agent-to-Agent Service Endpoint (with 402 payment handshake)
   * Example: POST /api/agent/services/scrape
   */
  router.post('/services/:serviceType', async (req, res) => {
    try {
      const { serviceType } = req.params;
      const body = req.body;
      const bodyHash = sha256HexUtf8(JSON.stringify(body));
      
      // Extract user from auth (buyer's human owner)
      const tokenUser = (req as any).user?.userId;
      if (!tokenUser) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Get seller agent configuration
      const sellerAgentId = process.env.AGENT_ID || 'seller-agent-default';
      const usdcTokenAccount = process.env.USDC_TOKEN_ACCOUNT;
      const isMainnet = process.env.SOLANA_CLUSTER === 'mainnet-beta';
      const usdcMint = process.env.USDC_MINT
        || (isMainnet ? (process.env.USDC_MINT_MAINNET || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') : (process.env.USDC_MINT_DEVNET || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'));
      const network = isMainnet ? 'solana:mainnet' : 'solana:devnet';
      const facilitatorUrl = process.env.FACILITATOR_URL || `${process.env.API_URL || 'http://localhost:3000'}/api/facilitator/verify`;

      if (!usdcTokenAccount) {
        return res.status(500).json({ 
          error: 'AGENT_NOT_CONFIGURED',
          message: 'Seller agent USDC account not configured'
        });
      }

      // Check if payment signature provided
      const paymentSigHeader = req.headers['payment-signature'] as string | undefined;

      if (!paymentSigHeader) {
        // No payment yet - return 402 Payment Required
        // Skip policy check - buyer agent handles all policy enforcement
        const price = calculateServicePrice(serviceType, body);

        // Return 402 Payment Required
        const requirement = createX402Requirement({
          amount: price.toString(),
          payTo: usdcTokenAccount,
          mint: usdcMint,
          network,
          method: 'POST',
          path: `/api/agent/services/${serviceType}`,
          bodyHash,
          facilitator: facilitatorUrl,
          expiresInSeconds: 60,
        });

        res.status(402);
        res.header('PAYMENT-REQUIRED', b64urlEncodeJson(requirement));
        return res.json({ 
          error: 'PAYMENT_REQUIRED',
          requirement,
        });
      }

      // Payment signature provided - verify it
      let proof: X402PaymentProof;
      try {
        proof = b64urlDecodeJson(paymentSigHeader);
      } catch (error) {
        return res.status(400).json({ 
          error: 'INVALID_PAYMENT_SIGNATURE',
          message: 'Could not decode payment signature'
        });
      }

      // Basic validation
      const proofValidation = validatePaymentProof(proof);
      if (!proofValidation.valid) {
        return res.status(400).json({
          error: 'INVALID_PROOF',
          message: proofValidation.error,
        });
      }

      // Skip policy check here - buyer agent already checked policies
      // This prevents double-rejection when seller agent ID differs from buyer's request
      console.log('⏭️  Skipping seller policy check (buyer already verified)');

      // Calculate price for verification
      const price = calculateServicePrice(serviceType, body);

      // Verify payment via facilitator
      const verification = await facilitatorService.verifyPayment({
        proof,
        expected: {
          mint: usdcMint,
          payTo: usdcTokenAccount,
          network,
          bodyHash,
          minAmount: price.toString(),
        },
      });

      if (!verification.ok) {
        return res.status(402).json({
          error: 'PAYMENT_INVALID',
          detail: verification.error,
        });
      }

      // Payment verified! Record the transaction
      await db.recordPurchaseAttempt({
        userId: tokenUser,
        productId: `agent-service-${serviceType}`,
        productName: `Agent Service: ${serviceType}`,
        amount: price / 1_000_000,
        merchant: sellerAgentId,
        category: serviceType,
        allowed: true,
        requiresApproval: false,
        policyCheckResults: [], // Buyer agent already checked policies
        // Agent-to-agent specific fields
        transactionType: 'agent-to-agent',
        solanaSignature: proof.txSignature,
        solanaMint: proof.mint,
        x402Nonce: proof.nonce,
        facilitatorReceipt: verification.receipt,
        recipientAgentId: sellerAgentId,
        buyerAgentId: req.headers['user-agent'] || 'unknown',
        agentServiceType: serviceType,
      });

      // Return receipt header
      res.header('PAYMENT-RESPONSE', b64urlEncodeJson(verification.receipt));

      // Execute the service and return response
      const serviceResult = await executeAgentService(serviceType, body);
      return res.json(serviceResult);

    } catch (error: any) {
      console.error('Agent service error:', error);
      return res.status(500).json({
        error: 'SERVICE_ERROR',
        message: error.message,
      });
    }
  });

  return router;
}

/**
 * Calculate price for service (in USDC lamports, 6 decimals)
 */
function calculateServicePrice(serviceType: string, _params: any): number {
  const basePrices: Record<string, number> = {
    'scrape': 100_000, // 0.1 USDC
    'data-scraping': 100_000, // 0.1 USDC (alias for ChatGPT flow)
    'api-call': 100_000,
    'data-analysis': 200_000,
    'default': 100_000,
  };
  return basePrices[serviceType] ?? basePrices.default;
}

/**
 * Execute the agent service. Currently returns in-platform mock data.
 * In production: proxy to the seller agent's baseUrl (e.g. POST baseUrl + /services/:type).
 */
async function executeAgentService(serviceType: string, params: any): Promise<any> {
  const normalizedType = serviceType === 'data-scraping' ? 'scrape' : serviceType;

  switch (normalizedType) {
    case 'scrape':
      return {
        ok: true,
        service: serviceType,
        data: {
          url: params?.url ?? '',
          extractFields: params?.extractFields ?? [],
          content: '[In production, call seller agent at baseUrl to perform real scrape]',
          timestamp: new Date().toISOString(),
        },
        message: 'Service executed successfully',
      };

    case 'api-call':
      return {
        ok: true,
        service: serviceType,
        data: {
          endpoint: params?.endpoint ?? params?.apiUrl,
          result: '[In production, call seller agent to perform real API call]',
          timestamp: new Date().toISOString(),
        },
        message: 'Service executed successfully',
      };

    case 'data-analysis':
      return {
        ok: true,
        service: serviceType,
        data: {
          analysis: '[In production, call seller agent for real analysis]',
          insights: [],
          timestamp: new Date().toISOString(),
        },
        message: 'Service executed successfully',
      };

    default:
      return {
        ok: true,
        service: serviceType,
        data: params ?? {},
        message: 'Service executed successfully',
      };
  }
}
