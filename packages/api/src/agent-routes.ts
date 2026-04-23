/**
 * Agent-to-Agent Transaction Routes
 * Implements x402 protocol for micropayments between agents
 */

import { Router } from 'express';
import { createHmac } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
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
import { PricingService } from './pricing-service';
import { executeProviderTool, normalizeProviderConfig } from './archtools-adapter';
import { hydrateProviderSecret } from './provider-security';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_WINDOW = 30;
const requestCounter = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(subject: string): boolean {
  const now = Date.now();
  const current = requestCounter.get(subject);
  if (!current || now - current.windowStart > RATE_LIMIT_WINDOW_MS) {
    requestCounter.set(subject, { count: 1, windowStart: now });
    return false;
  }
  current.count += 1;
  requestCounter.set(subject, current);
  return current.count > RATE_LIMIT_MAX_PER_WINDOW;
}

function signResultEnvelope(payload: any) {
  const secret = process.env.AGENT_RESULT_SIGNING_SECRET;
  if (!secret) {
    return { signed: false as const, payload };
  }
  const serialized = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(serialized).digest('hex');
  return {
    signed: true as const,
    payload,
    signature,
    algorithm: 'hmac-sha256',
    createdAt: new Date().toISOString(),
  };
}

function parseQuoteFromHeader(value: string | undefined): any | null {
  if (!value) return null;
  try {
    return b64urlDecodeJson(value);
  } catch {
    return null;
  }
}

export function createAgentRoutes(
  db: DB,
  policyService: PolicyService,
  facilitatorService: FacilitatorService
) {
  const router = Router();
  const pricingService = new PricingService();

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
      if (isRateLimited(tokenUser)) {
        return res.status(429).json({
          error: 'RATE_LIMITED',
          message: 'Too many service requests. Please retry shortly.',
        });
      }

      // Get seller agent configuration
      const sellerAgentId = process.env.AGENT_ID || 'seller-agent-default';
      const targetAgentId = (req.headers['x-agent-id'] as string | undefined) || sellerAgentId;
      const targetRegisteredAgent = await db.getRegisteredAgent(targetAgentId);
      const isMainnet = process.env.SOLANA_CLUSTER === 'mainnet-beta';
      const usdcMint = process.env.USDC_MINT
        || (isMainnet ? (process.env.USDC_MINT_MAINNET || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') : (process.env.USDC_MINT_DEVNET || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'));
      const network = isMainnet ? 'solana:mainnet' : 'solana:devnet';
      const facilitatorUrl = process.env.FACILITATOR_URL || `${process.env.API_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000'}/api/facilitator/verify`;

      const sellerMainWallet = targetRegisteredAgent?.solanaPubkey || process.env.USDC_TOKEN_ACCOUNT; // Main SOL wallet
      const sellerTokenAccountFromRegistry = targetRegisteredAgent?.usdcTokenAccount; // Optional explicit ATA

      if (!sellerMainWallet && !sellerTokenAccountFromRegistry) {
        return res.status(500).json({ 
          error: 'AGENT_NOT_CONFIGURED',
          message: 'Seller wallet not configured. Set agent.solanaPubkey/usdcTokenAccount in registry or USDC_TOKEN_ACCOUNT env var.'
        });
      }

      // Prefer explicit seller USDC token account from registry, otherwise derive from seller main wallet.
      const usdcTokenAccount = sellerTokenAccountFromRegistry
        ? sellerTokenAccountFromRegistry
        : getAssociatedTokenAddressSync(
            new PublicKey(usdcMint),
            new PublicKey(sellerMainWallet as string)
          ).toBase58();

      // Check if payment signature provided
      const paymentSigHeader = req.headers['payment-signature'] as string | undefined;

      if (!paymentSigHeader) {
        // No payment yet - return 402 Payment Required
        // Skip policy check - buyer agent handles all policy enforcement
        const quote = await pricingService.quoteForAgent(db, targetAgentId, serviceType);

        // Return 402 Payment Required
        const requirement = createX402Requirement({
          amount: quote.amountAtomic.toString(),
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
        res.header('X-SERVICE-QUOTE', b64urlEncodeJson(quote));
        return res.json({ 
          error: 'PAYMENT_REQUIRED',
          quote,
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

      // Calculate price for verification. Prefer buyer-provided quote header when valid.
      const quoteFromHeader = parseQuoteFromHeader(req.headers['x-service-quote'] as string | undefined);
      const quote =
        quoteFromHeader &&
        quoteFromHeader.agentId === targetAgentId &&
        quoteFromHeader.serviceType === serviceType &&
        new Date(quoteFromHeader.expiresAt).getTime() > Date.now()
          ? quoteFromHeader
          : await pricingService.quoteForAgent(db, targetAgentId, serviceType);
      console.log(`💵 Calculated price: ${quote.amountAtomic} atomic (${quote.amountUsd} USDC)`);

      // Replay protection (phase 3): reject any previously used nonce.
      const nonceSeen = await db.checkX402Nonce(proof.nonce);
      if (nonceSeen) {
        return res.status(409).json({
          error: 'NONCE_ALREADY_USED',
          message: 'This x402 proof nonce has already been consumed.',
        });
      }

      // Verify payment via facilitator
      console.log(`🔍 Verifying payment proof with facilitator...`);
      const verification = await facilitatorService.verifyPayment({
        proof,
        expected: {
          mint: usdcMint,
          payTo: usdcTokenAccount,
          network,
          bodyHash,
          minAmount: quote.amountAtomic.toString(),
        },
      });

      if (!verification.ok) {
        console.error(`❌ Payment verification failed: ${verification.error}`);
        return res.status(402).json({
          error: 'PAYMENT_INVALID',
          detail: verification.error,
        });
      }

      console.log(`✅ Payment verified successfully!`);

      // Persist verified nonce/receipt marker for replay prevention.
      await db.storeX402Nonce({
        nonce: proof.nonce,
        txSignature: proof.txSignature,
        agentId: targetAgentId,
        buyerUserId: tokenUser,
        amount: proof.amount,
        mint: proof.mint,
        verified: true,
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      // Payment verified! Record the transaction
      await db.recordPurchaseAttempt({
        userId: tokenUser,
        productId: `agent-service-${serviceType}`,
        productName: `Agent Service: ${serviceType}`,
        amount: quote.amountUsd,
        merchant: targetAgentId,
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
        recipientAgentId: targetAgentId,
        buyerAgentId: req.headers['user-agent'] || 'unknown',
        agentServiceType: serviceType,
      });

      // Return receipt header
      res.header('PAYMENT-RESPONSE', b64urlEncodeJson(verification.receipt));

      // Execute the service and return response
      const serviceResult = await executeAgentService(db, targetAgentId, serviceType, body);
      const envelope = signResultEnvelope({
        targetAgentId,
        quote,
        serviceType,
        bodyHash,
        paymentReceipt: verification.receipt,
        serviceResult,
      });
      res.header('X-RESULT-ENVELOPE', b64urlEncodeJson(envelope));
      return res.json({
        ...serviceResult,
        resultEnvelope: envelope,
      });

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
 * Execute the agent service. Currently returns in-platform mock data.
 * In production: proxy to the seller agent's baseUrl (e.g. POST baseUrl + /services/:type).
 */
async function executeAgentService(db: DB, agentId: string, serviceType: string, params: any): Promise<any> {
  // Prefer provider-driven execution when an agent defines provider metadata.
  const registered = await db.getRegisteredAgent(agentId);
  const providerRaw = hydrateProviderSecret(registered?.metadata?.provider);
  const provider = normalizeProviderConfig({
    ...providerRaw,
    apiKey: providerRaw?.apiKey || process.env.ARCH_TOOLS_API_KEY,
    baseUrl: providerRaw?.baseUrl || process.env.ARCH_TOOLS_BASE_URL || providerRaw?.endpoint,
  });
  if (provider) {
    const live = await executeProviderTool(serviceType, params, provider);
    if (live.ok) {
      return {
        ok: true,
        service: serviceType,
        provider: provider.name,
        data: live.data,
      };
    }
    return {
      ok: false,
      service: serviceType,
      provider: provider.name,
      error: live.error,
      status: live.status,
    };
  }

  // Normalize service types
  let normalizedType = serviceType;
  if (serviceType === 'data-scraping') normalizedType = 'scrape';
  if (serviceType === 'api-calling') normalizedType = 'api-call';

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
        }
      };
    case 'advanced-analysis':
      return {
        ok: true,
        service: serviceType,
        data: {
          analysisType: 'advanced',
          cost: '3.0 USDC',
          result: '[In production, perform advanced data analysis]',
          timestamp: new Date().toISOString(),
        }
      };
    case 'ml-inference':
      return {
        ok: true,
        service: serviceType,
        data: {
          model: params?.model ?? 'default',
          cost: '2.5 USDC',
          result: '[In production, run ML model inference]',
          timestamp: new Date().toISOString(),
        }
      };
    case 'data-pipeline':
      return {
        ok: true,
        service: serviceType,
        data: {
          pipeline: params?.pipeline ?? 'default',
          cost: '5.0 USDC',
          result: '[In production, execute data pipeline]',
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
