/**
 * ChatGPT Agent-to-Agent Routes
 * Simplified endpoints for ChatGPT to act as a buyer agent
 * Handles Solana transactions internally so ChatGPT doesn't need to
 */

import { Router } from 'express';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { DB } from '@agentic-commerce/database';
import { PolicyService } from '@agentic-commerce/core';
import { createHash } from 'crypto';
import { PricingService } from './pricing-service';
import { fetchProviderX402Requirement, normalizeProviderConfig } from './archtools-adapter';
import { hydrateProviderSecret } from './provider-security';
import { getTreasuryCustodyProvider } from './treasury-custody';

// Single source of truth: USDC mints (must match E2E test and docker-compose USDC_MINT_DEVNET)
const USDC_MINT_DEVNET = process.env.USDC_MINT_DEVNET || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';
const USDC_MINT_MAINNET = process.env.USDC_MINT_MAINNET || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Only mainnet-beta is mainnet; everything else is devnet. */
function solanaCluster(): string {
  return process.env.SOLANA_CLUSTER === 'mainnet-beta' ? 'mainnet-beta' : 'devnet';
}

/** Derive USDC ATA for a wallet (same formula as E2E test - do not change without updating both). */
function getUsdcMintAndAta(network: string, walletPublicKey: PublicKey): { mint: PublicKey; ata: Promise<PublicKey> } {
  const mint = new PublicKey(network === 'mainnet-beta' ? USDC_MINT_MAINNET : USDC_MINT_DEVNET);
  const ata = getAssociatedTokenAddress(mint, walletPublicKey, false, undefined, undefined);
  return { mint, ata };
}

/** True if s looks like a Solana base58 address (not a placeholder). */
function isRealSolanaAddress(s: string | null | undefined): boolean {
  if (!s || typeof s !== 'string') return false;
  if (s.startsWith('test-') || s.length < 32 || s.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

// FacilitatorService from integrations returns { ok, error }; we accept that shape
interface FacilitatorService {
  verifyPayment(proof: any, expected: any): Promise<{ ok: boolean; error?: string }>;
}

function b64urlEncodeJson(input: any): string {
  return Buffer.from(JSON.stringify(input))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function loadTreasuryKeypair(): Keypair | null {
  const rawJson = process.env.TREASURY_SECRET_KEY_JSON;
  if (rawJson) {
    try {
      const arr = JSON.parse(rawJson);
      if (Array.isArray(arr)) {
        return Keypair.fromSecretKey(Uint8Array.from(arr));
      }
    } catch {
      // continue to other formats
    }
  }
  const rawB64 = process.env.TREASURY_SECRET_KEY_BASE64;
  if (rawB64) {
    try {
      const buf = Buffer.from(rawB64, 'base64');
      return Keypair.fromSecretKey(Uint8Array.from(buf));
    } catch {
      return null;
    }
  }
  return null;
}

function resolveProviderExecuteUrl(provider: any, tool: string): string {
  const baseUrl = String(provider.baseUrl || '').replace(/\/$/, '');
  const tmpl = provider.executePathTemplate || '/v1/tools/{tool}';
  return `${baseUrl}${tmpl.replace('{tool}', encodeURIComponent(tool))}`;
}

function selectProviderAcceptLeg(requirement: any, preferred = (process.env.PREFERRED_PROVIDER_NETWORK || 'solana')): any | null {
  const accepts = Array.isArray(requirement?.accepts) ? requirement.accepts : [];
  if (!accepts.length) return null;
  const pref = preferred.toLowerCase();
  const best =
    accepts.find((a: any) => String(a?.network || '').toLowerCase().includes(pref)) ||
    accepts[0];
  return best || null;
}

function buildPaymentToSign(selectedAccept: any, resourceUrl?: string) {
  if (!selectedAccept) return null;
  return {
    scheme: selectedAccept.scheme,
    network: selectedAccept.network,
    asset: selectedAccept.asset,
    payTo: selectedAccept.payTo,
    amount: selectedAccept.amount,
    maxAmountRequired: selectedAccept.maxAmountRequired,
    maxTimeoutSeconds: selectedAccept.maxTimeoutSeconds,
    resource: selectedAccept.resource || resourceUrl,
    description: selectedAccept.description,
    mimeType: selectedAccept.mimeType,
    extra: selectedAccept.extra || {},
  };
}

async function resolveTreasurySigner(
  db: DB,
  userId: string,
  paymentToSign: any
): Promise<{ keypair: Keypair; walletRecord?: any; orgId?: string }> {
  const fundingAccount = await db.getFundingAccountByUserId(userId);
  const orgId = fundingAccount?.organizationId || undefined;
  if (orgId) {
    const selectedWallet = await db.selectOrgTreasuryWalletForPayment({
      orgId,
      network: String(paymentToSign.network),
      asset: String(paymentToSign.asset),
      amountAtomic: String(paymentToSign.amount),
    });
    if (selectedWallet) {
      if (!selectedWallet.keyCiphertext) {
        throw new Error('Selected org treasury wallet has no signer material configured');
      }
      const custody = getTreasuryCustodyProvider();
      const signer = custody.loadSignerFromCiphertext(selectedWallet.address, selectedWallet.keyCiphertext);
      return { keypair: Keypair.fromSecretKey(signer.secretKey), walletRecord: selectedWallet, orgId };
    }
  }
  const fallback = loadTreasuryKeypair();
  if (!fallback) throw new Error('TREASURY_NOT_CONFIGURED');
  return { keypair: fallback, walletRecord: null, orgId };
}

export function createChatGPTAgentRoutes(
  db: DB,
  policyService: PolicyService,
  facilitatorService: FacilitatorService
) {
  const router = Router();
  const pricingService = new PricingService();

  /**
   * POST /api/chatgpt-agent/service-options
   * Lists available services + live quote previews for chat UX before payment.
   */
  router.post('/service-options', async (req, res) => {
    try {
      const userEmail = req.body?.user_email || (req as any).user?.email;
      const agentId = req.body.agentId || req.body.agent_id;
      const requested = req.body.serviceTypes || req.body.service_types;
      if (!userEmail || !agentId) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'user_email and agent_id are required',
        });
      }
      const user = await db.getUserByEmail(userEmail);
      if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });
      const agent = await db.getRegisteredAgent(agentId);
      if (!agent) return res.status(404).json({ error: 'AGENT_NOT_FOUND' });

      let services: string[] = [];
      if (Array.isArray(requested) && requested.length) {
        services = requested.map((s: any) => String(s)).filter(Boolean);
      } else if (Array.isArray(agent.services) && agent.services.length) {
        services = agent.services.map((s: any) => String(s)).filter(Boolean);
      } else {
        services = ['scrape'];
      }
      services = Array.from(new Set(services)).slice(0, 50);

      const quotes = await Promise.all(
        services.map(async (serviceType) => {
          try {
            const q = await pricingService.quoteForAgent(db, agentId, serviceType);
            return {
              serviceType,
              available: true,
              quote: {
                quoteId: q.quoteId,
                amountUsd: q.amountUsd,
                amountAtomic: q.amountAtomic,
                currency: q.currency,
                expiresAt: q.expiresAt,
                source: q.source,
                toolRef: q.toolRef,
              },
            };
          } catch (error: any) {
            return {
              serviceType,
              available: false,
              error: error?.message || 'quote_failed',
            };
          }
        })
      );

      return res.json({
        success: true,
        mode: process.env.PROVIDER_NATIVE_X402 === 'true' ? 'provider-native-x402' : 'platform-hop-x402',
        requiresConfirmation: process.env.REQUIRE_PAYMENT_CONFIRMATION !== 'false',
        payer: process.env.USE_TREASURY_PAYER === 'true' ? 'treasury' : 'user-wallet',
        agent: {
          agentId,
          name: agent.name,
          baseUrl: agent.baseUrl,
        },
        options: quotes,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'SERVICE_OPTIONS_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/chatgpt-agent/wallet
   * Get or create user's Solana wallet for agent-to-agent payments
   */
  router.post('/wallet', async (req, res) => {
    try {
      const userEmail = req.body?.user_email || (req as any).user?.email;
      if (!userEmail) {
        return res.status(400).json({ 
          error: 'MISSING_EMAIL',
          message: 'Please provide user_email in request' 
        });
      }

      const user = await db.getUserByEmail(userEmail);
      if (!user) {
        return res.status(404).json({ 
          error: 'USER_NOT_FOUND',
          message: 'Please create an account first using /api/auth/create-user' 
        });
      }

      // Check if user has a wallet
      let walletData = await db.getUserWallet(user.id);
      
      if (!walletData) {
        // Create new wallet for user
        const keypair = Keypair.generate();
        walletData = {
          userId: user.id,
          publicKey: keypair.publicKey.toBase58(),
          secretKey: Array.from(keypair.secretKey),
        };
        await db.saveUserWallet(walletData);
      }

      const network = solanaCluster();
      const rpcUrl = network === 'mainnet-beta'
        ? (process.env.SOLANA_RPC_MAINNET || 'https://api.mainnet-beta.solana.com')
        : (process.env.SOLANA_RPC_DEVNET || 'https://solana-devnet.g.alchemy.com/v2/ZJmVXF-LVxv651ws9azjqBr6Upv_l9_5');
      const connection = new Connection(rpcUrl, 'confirmed');
      const publicKey = new PublicKey(walletData.publicKey);
      const { mint: usdcMint, ata } = getUsdcMintAndAta(network, publicKey);
      const tokenAccount = await ata;
      const tokenAccountB58 = tokenAccount.toBase58();

      // Check balances (ATA is derived from wallet + mint; same formula as payments)
      const solBalance = await connection.getBalance(publicKey);
      let usdcBalance = 0;
      let balanceNote: string | undefined;
      let balanceError: string | undefined;
      const maxRetries = 3;
      const retryDelayMs = 2000;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const tokenAccountInfo = await connection.getTokenAccountBalance(tokenAccount);
          usdcBalance = tokenAccountInfo.value.uiAmount ?? 0;
          break;
        } catch (e: any) {
          const errMsg = e?.message || String(e);
          balanceError = errMsg;
          if (process.env.NODE_ENV !== 'production') {
            console.warn(`Wallet USDC balance fetch (attempt ${attempt + 1}/${maxRetries}):`, errMsg, { rpcUrl, tokenAccount: tokenAccountB58 });
          }
          if (attempt < maxRetries - 1) {
            await new Promise((r) => setTimeout(r, retryDelayMs));
          } else {
            balanceNote = 'Transfer succeeded but RPC has not indexed the token account yet. Check the Solscan link below; balance usually appears within 1–2 min.';
          }
        }
      }
      // If still 0, try: (1) list token accounts by owner (derived "ATA" may be owner, e.g. 67Csvx -> Hc44ZL), then (2) finalized + getAccount
      let resolvedTokenAccountB58 = tokenAccountB58;
      if (usdcBalance === 0) {
        // First: derived address might be the owner of the real token account (67Csvx owns Hc44ZL)
        try {
          const parsed = await connection.getParsedTokenAccountsByOwner(tokenAccount, { programId: TOKEN_PROGRAM_ID });
          for (const { pubkey, account } of parsed.value) {
            const info = account.data?.parsed?.info;
            if (info?.mint === usdcMint.toBase58()) {
              const amt = info?.tokenAmount?.uiAmount ?? 0;
              if (amt > 0) {
                usdcBalance = amt;
                resolvedTokenAccountB58 = pubkey.toBase58();
                balanceNote = undefined;
                balanceError = undefined;
                break;
              }
            }
          }
        } catch (fallbackErr: any) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('Wallet USDC getParsedTokenAccountsByOwner fallback failed:', fallbackErr?.message || fallbackErr, { tokenAccount: tokenAccountB58 });
          }
        }
        if (usdcBalance === 0) {
          const connFinalized = new Connection(rpcUrl, 'finalized');
          try {
            const info = await connFinalized.getTokenAccountBalance(tokenAccount);
            usdcBalance = info.value.uiAmount ?? 0;
            if (usdcBalance > 0) balanceNote = undefined;
            if (usdcBalance > 0) balanceError = undefined;
          } catch {
            try {
              const account = await getAccount(connFinalized, tokenAccount);
              usdcBalance = Number(account.amount) / 10 ** 6;
              if (usdcBalance > 0) balanceNote = undefined;
              if (usdcBalance > 0) balanceError = undefined;
            } catch {
              try {
                const parsed = await connFinalized.getParsedTokenAccountsByOwner(tokenAccount, { programId: TOKEN_PROGRAM_ID });
                for (const { pubkey, account } of parsed.value) {
                  const info = account.data?.parsed?.info;
                  if (info?.mint === usdcMint.toBase58() && (info?.tokenAmount?.uiAmount ?? 0) > 0) {
                    usdcBalance = info.tokenAmount.uiAmount ?? 0;
                    resolvedTokenAccountB58 = pubkey.toBase58();
                    balanceNote = undefined;
                    balanceError = undefined;
                    break;
                  }
                }
              } catch (_) {}
            }
          }
        }
      }

      const clusterParam = network === 'mainnet-beta' ? '' : '?cluster=devnet';
      res.json({
        wallet: {
          publicKey: walletData.publicKey,
          tokenAccount: resolvedTokenAccountB58,
          usdcMint: usdcMint.toBase58(),
          network,
          balances: {
            sol: solBalance / 1e9,
            usdc: usdcBalance,
          },
          ...(balanceNote && { balanceNote }),
          ...(balanceError && process.env.NODE_ENV !== 'production' && { balanceError }),
          ...(network !== 'mainnet-beta' && { solscanTokenAccountUrl: `https://solscan.io/account/${resolvedTokenAccountB58}${clusterParam}` }),
          fundingInstructions: {
            sol: `Send SOL to: ${walletData.publicKey}`,
            usdc: network === 'devnet'
              ? `Devnet USDC (mint ${usdcMint.toBase58()}): send to token account ${resolvedTokenAccountB58}`
              : `Send USDC to token account: ${resolvedTokenAccountB58}`,
          }
        }
      });
    } catch (error: any) {
      console.error('Wallet error:', error);
      res.status(500).json({ 
        error: 'WALLET_ERROR',
        message: error.message 
      });
    }
  });

  /**
   * POST /api/chatgpt-agent/request-service
   * Request a service from another agent (handles payment automatically)
   */
  router.post('/request-service', async (req, res) => {
    let idemContext:
      | {
          userId: string;
          endpoint: string;
          idempotencyKey: string;
        }
      | undefined;
    try {
      const userEmail = req.body?.user_email || (req as any).user?.email;
      
      // Accept both snake_case (ChatGPT) and camelCase
      const agentId = req.body.agentId || req.body.agent_id;
      const serviceType = req.body.serviceType || req.body.service_type;
      const serviceParams = req.body.serviceParams || req.body.service_params;
      const idempotencyKey = (req.headers['x-idempotency-key'] as string) || req.body.idempotency_key;

      if (!userEmail) {
        return res.status(400).json({ 
          error: 'MISSING_EMAIL',
          message: 'Please provide user_email in request' 
        });
      }

      if (!agentId || !serviceType) {
        return res.status(400).json({ 
          error: 'INVALID_REQUEST',
          message: 'Missing required fields: agentId or agent_id, serviceType or service_type' 
        });
      }

      const user = await db.getUserByEmail(userEmail);
      if (!user) {
        return res.status(404).json({ 
          error: 'USER_NOT_FOUND',
          message: 'Please create an account first' 
        });
      }
      if (idempotencyKey && String(idempotencyKey).trim().length > 0) {
        const endpoint = '/api/chatgpt-agent/request-service';
        const requestHash = createHash('sha256')
          .update(
            JSON.stringify({
              agentId,
              serviceType,
              serviceParams: serviceParams || {},
            })
          )
          .digest('hex');
        const existing = await db.getIdempotentRequest({
          userId: user.id,
          endpoint,
          idempotencyKey: String(idempotencyKey),
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            return res.status(409).json({
              error: 'IDEMPOTENCY_CONFLICT',
              message: 'Idempotency key already used with a different request payload',
            });
          }
          if (existing.status === 'completed' && existing.responseJson) {
            return res.status(existing.responseCode || 200).json({
              ...existing.responseJson,
              idempotencyReplay: true,
            });
          }
          if (existing.status === 'pending') {
            return res.status(409).json({
              error: 'REQUEST_IN_PROGRESS',
              message: 'A request with this idempotency key is already in progress',
            });
          }
          return res.status(409).json({
            error: 'REQUEST_ALREADY_FAILED',
            message: existing.errorMessage || 'Previous request with this idempotency key failed',
          });
        }
        await db.createPendingIdempotentRequest({
          userId: user.id,
          endpoint,
          idempotencyKey: String(idempotencyKey),
          requestHash,
        });
        idemContext = { userId: user.id, endpoint, idempotencyKey: String(idempotencyKey) };
      }

      // Log the ChatGPT query (fire-and-forget)
      db.logEvent({
        userId: user.id,
        eventType: 'chatgpt_query',
        source: 'chatgpt',
        intent: 'agent_service_request',
        category: serviceType,
        merchant: agentId,
        rawInput: serviceParams ? JSON.stringify(serviceParams) : undefined,
        metadata: { agent_id: agentId, service_type: serviceType, service_params: serviceParams },
      });

      // Get or create user's wallet
      let walletData = await db.getUserWallet(user.id);
      if (!walletData) {
        // Auto-create wallet for user
        const keypair = Keypair.generate();
        walletData = {
          userId: user.id,
          publicKey: keypair.publicKey.toBase58(),
          secretKey: Array.from(keypair.secretKey),
        };
        await db.saveUserWallet(walletData);
        console.log(`✅ Auto-created Solana wallet for user ${user.id}: ${walletData.publicKey}`);
      }

      // Get seller agent info
      const sellerAgent = await db.getRegisteredAgent(agentId);
      if (!sellerAgent) {
        return res.status(404).json({ 
          error: 'AGENT_NOT_FOUND',
          message: `Agent ${agentId} not found in registry` 
        });
      }

      // Fetch agent-native quote (production path: provider quote, fallback: local map).
      const quote = await pricingService.quoteForAgent(db, agentId, serviceType);
      const priceUsd = quote.amountUsd;
      const useFundingLedger = process.env.USE_FUNDING_LEDGER === 'true';
      const useTreasuryPayer = process.env.USE_TREASURY_PAYER === 'true';
      const useProviderNativeX402 = process.env.PROVIDER_NATIVE_X402 === 'true';
      const fundingRef = `svc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      let reservationEntryId: string | undefined;

      // Get wallet balance
      const balanceCheckNetwork = solanaCluster();
      const balanceCheckRpc = balanceCheckNetwork === 'mainnet-beta'
        ? (process.env.SOLANA_RPC_MAINNET || 'https://api.mainnet-beta.solana.com')
        : (process.env.SOLANA_RPC_DEVNET || 'https://solana-devnet.g.alchemy.com/v2/ZJmVXF-LVxv651ws9azjqBr6Upv_l9_5');
      const balanceConnection = new Connection(balanceCheckRpc, 'confirmed');
      const publicKey = new PublicKey(walletData.publicKey);
      const { mint: usdcMintAddress, ata: ataPromise } = getUsdcMintAndAta(balanceCheckNetwork, publicKey);
      const ata = await ataPromise;
      
      let usdcBalance = 0;
      let resolvedTokenAccount = ata;
      
      // Check standard ATA only (derived from wallet + USDC mint)
      console.log(`🔍 Checking balance for ATA: ${ata.toBase58()}`);
      try {
        const tokenAccount = await getAccount(balanceConnection, ata);
        usdcBalance = Number(tokenAccount.amount) / 1_000_000;
        console.log(`✓ ATA exists, balance: ${usdcBalance} USDC`);
      } catch (error: any) {
        console.log(`⚠️  Standard ATA (${ata.toBase58()}) doesn't exist on-chain yet.`);
        console.log(`⚠️  To create it, you need ~0.002 SOL for rent. Fund your wallet with SOL first.`);
        // Don't search for non-standard nested structures - they can't be used for standard payments
      }
      console.log(`💰 Final balance check: ${usdcBalance} USDC at ${resolvedTokenAccount.toBase58()}`);

      // 1. CHECK POLICY FIRST (agent-to-agent transaction)
      // Extract purpose from service params (e.g., URL for scraping, API endpoint, etc.)
      const purpose = serviceParams?.url || serviceParams?.endpoint || serviceParams?.target || 
                     serviceParams?.description || JSON.stringify(serviceParams || {});
      
      // If user is spending from an org-allocated subaccount, ensure org membership is active.
      if (useFundingLedger) {
        const fundingAccount = await db.getFundingAccountByUserId(user.id);
        if (fundingAccount?.organizationId) {
          const membership = await db.getOrganizationMembership(fundingAccount.organizationId, user.id);
          if (!membership || membership.status !== 'active') {
            return res.status(403).json({
              error: 'ORG_MEMBERSHIP_REQUIRED',
              message: 'User must be an active organization member to spend org-allocated funds',
              organizationId: fundingAccount.organizationId,
            });
          }
        }
      }

      const policyCheck = await policyService.checkPurchase({
        userId: user.id,
        productId: `service-${serviceType}`,
        price: priceUsd,
        merchant: agentId,
        category: serviceType,
        transactionType: 'agent-to-agent',
        serviceType: serviceType,
        recipientAgentId: agentId,
        buyerAgentId: 'chatgpt',
        purpose: purpose,
      });

      // Handle policy denial
      if (!policyCheck.allowed && !policyCheck.requiresApproval) {
        return res.status(403).json({
          error: 'POLICY_VIOLATION',
          message: 'This service request violates company policy',
          reason: policyCheck.reason,
          matchedPolicies: policyCheck.matchedPolicies,
        });
      }

      // Handle approval required
      if (policyCheck.requiresApproval) {
        return res.status(403).json({
          error: 'APPROVAL_REQUIRED',
          message: 'This service request requires manager approval',
          reason: policyCheck.reason,
          estimatedCost: priceUsd,
          quoteId: quote.quoteId,
          quoteExpiresAt: quote.expiresAt,
          serviceType,
          agentId,
          matchedPolicies: policyCheck.matchedPolicies,
        });
      }

      if (useProviderNativeX402) {
        const providerRaw = hydrateProviderSecret(sellerAgent?.metadata?.provider);
        const provider = normalizeProviderConfig({
          ...providerRaw,
          apiKey: providerRaw?.apiKey || process.env.ARCH_TOOLS_API_KEY,
          baseUrl: providerRaw?.baseUrl || process.env.ARCH_TOOLS_BASE_URL || providerRaw?.endpoint,
        });
        if (!provider || provider.pricingStrategy !== 'x402') {
          return res.status(400).json({
            error: 'PROVIDER_NATIVE_X402_UNAVAILABLE',
            message: 'Provider-native x402 requires provider pricingStrategy=x402 and provider metadata',
          });
        }
        const providerChallenge = await fetchProviderX402Requirement(serviceType, serviceParams || {}, provider);
        const selectedAccept = selectProviderAcceptLeg(providerChallenge.requirement);
        const paymentToSign = buildPaymentToSign(selectedAccept, providerChallenge.requirement?.resource?.url);
        if (!paymentToSign) {
          return res.status(400).json({
            error: 'PROVIDER_REQUIREMENT_INVALID',
            message: 'Provider requirement did not include an acceptable payment leg',
          });
        }
        const confirmPayment = req.body?.confirm_payment === true;
        const requireConfirmation = process.env.REQUIRE_PAYMENT_CONFIRMATION !== 'false';
        let routedWalletPreview: any = null;
        if (useTreasuryPayer) {
          const fundingAccount = await db.getFundingAccountByUserId(user.id);
          if (fundingAccount?.organizationId) {
            routedWalletPreview = await db.selectOrgTreasuryWalletForPayment({
              orgId: fundingAccount.organizationId,
              network: String(paymentToSign.network),
              asset: String(paymentToSign.asset),
              amountAtomic: String(paymentToSign.amount),
            });
          }
        }

        const previewPayload = {
          mode: 'provider-native-x402',
          requiresConfirmation: requireConfirmation,
          provider: {
            name: provider.name,
            baseUrl: provider.baseUrl,
            tool: providerChallenge.tool,
          },
          quote,
          providerRequirement: providerChallenge.requirement,
          selectedAccept,
          paymentToSign,
          providerPaymentRequiredHeader: providerChallenge.paymentRequiredHeader,
          requirementSource: providerChallenge.source,
          transactionPreview: {
            payer: useTreasuryPayer ? 'treasury' : 'user-wallet',
            treasuryWalletId: routedWalletPreview?.id,
            treasuryWalletAddress: routedWalletPreview?.address,
            network: paymentToSign.network,
            asset: paymentToSign.asset,
            amountAtomic: paymentToSign.amount,
            amountUsd: quote.amountUsd,
            to: paymentToSign.payTo,
            serviceType,
            agentId,
          },
        };

        if (!useTreasuryPayer) {
          return res.status(402).json({
            error: 'PROVIDER_PAYMENT_REQUIRED',
            message: 'Provider-native x402 challenge returned. Treasury auto-pay is disabled.',
            ...previewPayload,
          });
        }

        if (requireConfirmation && !confirmPayment) {
          return res.status(200).json({
            success: false,
            error: 'CONFIRMATION_REQUIRED',
            message: 'Set confirm_payment=true to execute treasury payment for this provider-native transaction.',
            ...previewPayload,
          });
        }

        let treasurySelection: { keypair: Keypair; walletRecord?: any; orgId?: string };
        try {
          treasurySelection = await resolveTreasurySigner(db, user.id, paymentToSign);
        } catch (e: any) {
          if (reservationEntryId) {
            await db.releaseFundingReservation({ reservationEntryId, reason: 'treasury-signer-resolution-failed' });
          }
          return res.status(500).json({
            error: 'TREASURY_NOT_CONFIGURED',
            message: e?.message || 'Treasury signer could not be resolved',
          });
        }
        const treasuryKeypair = treasurySelection.keypair;
        const requestHash = createHash('sha256')
          .update(JSON.stringify({ agentId, serviceType, serviceParams: serviceParams || {}, paymentToSign }))
          .digest('hex');
        const signRequestId = treasurySelection.orgId
          ? await db.createTreasurySignRequest({
              orgId: treasurySelection.orgId,
              walletId: treasurySelection.walletRecord?.id,
              userId: user.id,
              endpoint: '/api/chatgpt-agent/request-service',
              requestHash,
              idempotencyKey: idemContext?.idempotencyKey,
              network: String(paymentToSign.network),
              asset: String(paymentToSign.asset),
              destination: String(paymentToSign.payTo),
              amountAtomic: String(paymentToSign.amount),
              amountUsd: quote.amountUsd,
              metadata: { provider: provider.name, tool: providerChallenge.tool, mode: 'provider-native-x402' },
            })
          : undefined;

        // Reserve user subaccount funds (authorization/accounting) before treasury payment.
        if (useFundingLedger) {
          const reserved = await db.reserveFundingAmount({
            userId: user.id,
            amount: quote.amountUsd,
            currency: 'USDC',
            referenceType: 'provider-native-agent-service',
            referenceId: fundingRef,
            metadata: { agentId, serviceType, quoteId: quote.quoteId, provider: provider.name },
          });
          if (!reserved.reserved) {
            return res.status(402).json({
              error: 'INSUFFICIENT_FUNDING_BALANCE',
              message: reserved.reason || 'Insufficient funding balance',
              funding: {
                accountId: reserved.accountId,
                balanceAvailable: reserved.balanceAvailable,
                balanceReserved: reserved.balanceReserved,
                requiredAmount: quote.amountUsd,
                currency: 'USDC',
              },
            });
          }
          reservationEntryId = reserved.reservationEntryId;
        }

        const providerNetwork = String(paymentToSign.network || '').toLowerCase();
        if (!providerNetwork.startsWith('solana')) {
          if (reservationEntryId) {
            await db.releaseFundingReservation({ reservationEntryId, reason: 'unsupported-provider-network' });
          }
          return res.status(400).json({
            error: 'UNSUPPORTED_PROVIDER_NETWORK',
            message: `Treasury auto-pay currently supports solana legs only. Got: ${paymentToSign.network}`,
          });
        }

        const rpcUrl = providerNetwork.includes('devnet')
          ? (process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com')
          : (process.env.SOLANA_RPC_MAINNET || 'https://api.mainnet-beta.solana.com');
        const connection = new Connection(rpcUrl, 'confirmed');
        const mint = new PublicKey(String(paymentToSign.asset));
        const payTo = new PublicKey(String(paymentToSign.payTo));
        const payerAta = getAssociatedTokenAddressSync(mint, treasuryKeypair.publicKey);

        let treasuryAtomic = 0n;
        try {
          const payerAccount = await getAccount(connection, payerAta);
          treasuryAtomic = payerAccount.amount;
        } catch {
          if (reservationEntryId) {
            await db.releaseFundingReservation({ reservationEntryId, reason: 'treasury-token-account-missing' });
          }
          if (signRequestId) {
            await db.updateTreasurySignRequest(signRequestId, {
              status: 'failed',
              errorMessage: 'TREASURY_TOKEN_ACCOUNT_MISSING',
            });
          }
          return res.status(402).json({
            error: 'TREASURY_TOKEN_ACCOUNT_MISSING',
            message: 'Treasury token account for provider asset not found/funded',
            treasury: { publicKey: treasuryKeypair.publicKey.toBase58(), tokenAccount: payerAta.toBase58(), asset: paymentToSign.asset },
          });
        }

        const amountAtomicBig = BigInt(String(paymentToSign.amount));
        if (treasuryAtomic < amountAtomicBig) {
          if (reservationEntryId) {
            await db.releaseFundingReservation({ reservationEntryId, reason: 'treasury-balance-insufficient' });
          }
          if (signRequestId) {
            await db.updateTreasurySignRequest(signRequestId, {
              status: 'failed',
              errorMessage: 'TREASURY_INSUFFICIENT_FUNDS',
            });
          }
          return res.status(402).json({
            error: 'TREASURY_INSUFFICIENT_FUNDS',
            message: 'Treasury does not have enough balance for provider-native payment',
            treasury: {
              publicKey: treasuryKeypair.publicKey.toBase58(),
              tokenAccount: payerAta.toBase58(),
              balanceAtomic: treasuryAtomic.toString(),
              requiredAtomic: amountAtomicBig.toString(),
              asset: paymentToSign.asset,
            },
          });
        }

        const tx = new Transaction().add(
          createTransferInstruction(
            payerAta,
            payTo,
            treasuryKeypair.publicKey,
            Number(amountAtomicBig)
          )
        );
        let txSignature = '';
        try {
          txSignature = await sendAndConfirmTransaction(connection, tx, [treasuryKeypair], { commitment: 'confirmed' });
        } catch (payErr: any) {
          if (reservationEntryId) {
            await db.releaseFundingReservation({ reservationEntryId, reason: 'treasury-payment-failed' });
          }
          if (signRequestId) {
            await db.updateTreasurySignRequest(signRequestId, {
              status: 'failed',
              errorMessage: payErr?.message || 'payment failed',
            });
          }
          return res.status(500).json({
            error: 'TREASURY_PAYMENT_FAILED',
            message: payErr?.message || 'Failed treasury payment for provider-native flow',
          });
        }
        if (signRequestId) {
          await db.updateTreasurySignRequest(signRequestId, {
            status: 'signed',
            txSignature,
          });
        }

        const proof = {
          protocol: 'x402',
          version: 'v2',
          txSignature,
          network: paymentToSign.network,
          nonce: `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          amount: String(paymentToSign.amount),
          mint: paymentToSign.asset,
          payTo: paymentToSign.payTo,
          bodyHash: createHash('sha256').update(JSON.stringify(serviceParams || {})).digest('hex'),
          timestamp: Date.now(),
        };
        const providerSubmitUrl = resolveProviderExecuteUrl(provider, providerChallenge.tool);
        const providerRes = await fetch(providerSubmitUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Payment-Signature': b64urlEncodeJson(proof),
          },
          body: JSON.stringify(serviceParams || {}),
        });
        const providerText = await providerRes.text();
        let providerJson: any = {};
        try {
          providerJson = providerText ? JSON.parse(providerText) : {};
        } catch {
          providerJson = { raw: providerText };
        }

        if (!providerRes.ok) {
          if (reservationEntryId) {
            await db.releaseFundingReservation({ reservationEntryId, reason: 'provider-rejected-after-payment' });
          }
          if (signRequestId) {
            await db.updateTreasurySignRequest(signRequestId, {
              status: 'failed',
              providerStatus: providerRes.status,
              errorMessage: 'provider rejected execution',
              metadata: providerJson,
            });
          }
          return res.status(providerRes.status).json({
            error: 'PROVIDER_EXECUTION_FAILED',
            message: 'Provider rejected post-payment execution',
            providerStatus: providerRes.status,
            providerResponse: providerJson,
            payment: {
              txSignature,
              network: paymentToSign.network,
              asset: paymentToSign.asset,
              payTo: paymentToSign.payTo,
              amountAtomic: String(paymentToSign.amount),
            },
          });
        }

        if (reservationEntryId) {
          await db.commitFundingReservation({
            reservationEntryId,
            referenceType: 'provider-native-onchain-payment',
            referenceId: txSignature,
          });
        }
        if (signRequestId) {
          await db.updateTreasurySignRequest(signRequestId, {
            status: 'confirmed',
            providerStatus: providerRes.status,
            metadata: providerJson,
          });
        }

        return res.status(200).json({
          success: true,
          mode: 'provider-native-x402',
          confirmed: true,
          payment: {
            payer: 'treasury',
            walletId: treasurySelection.walletRecord?.id,
            from: treasuryKeypair.publicKey.toBase58(),
            fromTokenAccount: payerAta.toBase58(),
            to: paymentToSign.payTo,
            network: paymentToSign.network,
            asset: paymentToSign.asset,
            amountAtomic: String(paymentToSign.amount),
            amountUsd: quote.amountUsd,
            txSignature,
            explorerUrl: providerNetwork.includes('devnet')
              ? `https://solscan.io/tx/${txSignature}?cluster=devnet`
              : `https://solscan.io/tx/${txSignature}`,
          },
          provider: {
            name: provider.name,
            baseUrl: provider.baseUrl,
            tool: providerChallenge.tool,
            status: providerRes.status,
          },
          providerResponse: providerJson,
        });
      }

      // 1.5 OPTIONAL: Funding ledger reserve (gift-card/subaccount style)
      if (useFundingLedger) {
        const reserved = await db.reserveFundingAmount({
          userId: user.id,
          amount: priceUsd,
          currency: 'USDC',
          referenceType: 'agent-service',
          referenceId: fundingRef,
          metadata: { agentId, serviceType, quoteId: quote.quoteId },
        });
        if (!reserved.reserved) {
          return res.status(402).json({
            error: 'INSUFFICIENT_FUNDING_BALANCE',
            message: reserved.reason || 'Insufficient funding balance',
            funding: {
              accountId: reserved.accountId,
              balanceAvailable: reserved.balanceAvailable,
              balanceReserved: reserved.balanceReserved,
              requiredAmount: priceUsd,
              currency: 'USDC',
            },
          });
        }
        reservationEntryId = reserved.reservationEntryId;
      }

      // Check if user has sufficient balance (or treasury balance if enabled)
      let treasuryTokenAccount: PublicKey | undefined;
      let treasuryUsdcBalance: number | undefined;
      if (useTreasuryPayer) {
        const treasuryKp = loadTreasuryKeypair();
        if (!treasuryKp) {
          if (reservationEntryId) {
            await db.releaseFundingReservation({
              reservationEntryId,
              reason: 'treasury-key-missing',
            });
          }
          return res.status(500).json({
            error: 'TREASURY_NOT_CONFIGURED',
            message: 'USE_TREASURY_PAYER=true requires TREASURY_SECRET_KEY_JSON or TREASURY_SECRET_KEY_BASE64',
          });
        }
        const { ata } = getUsdcMintAndAta(balanceCheckNetwork, treasuryKp.publicKey);
        treasuryTokenAccount = await ata;
        try {
          const account = await getAccount(balanceConnection, treasuryTokenAccount);
          treasuryUsdcBalance = Number(account.amount) / 1_000_000;
        } catch {
          treasuryUsdcBalance = 0;
        }
      }

      const effectiveBalance = useTreasuryPayer ? (treasuryUsdcBalance || 0) : usdcBalance;
      if (effectiveBalance < priceUsd) {
        if (reservationEntryId) {
          await db.releaseFundingReservation({
            reservationEntryId,
            reason: useTreasuryPayer ? 'treasury-wallet-insufficient' : 'user-wallet-insufficient',
          });
        }
        const clusterParam = balanceCheckNetwork === 'mainnet-beta' ? '' : '?cluster=devnet';
        return res.status(402).json({
          error: 'INSUFFICIENT_FUNDS',
          message: `Insufficient USDC balance. You need ${priceUsd} USDC but have ${effectiveBalance.toFixed(2)} USDC.`,
          wallet: {
            publicKey: useTreasuryPayer ? (loadTreasuryKeypair()?.publicKey.toBase58() || 'unknown') : walletData.publicKey,
            tokenAccount: useTreasuryPayer ? (treasuryTokenAccount?.toBase58() || 'unknown') : resolvedTokenAccount.toBase58(),
            currentBalance: effectiveBalance,
            requiredAmount: priceUsd,
            fundingInstructions: {
              step1: useTreasuryPayer
                ? 'Fund treasury wallet/subaccount balance via admin top-up path'
                : `Fund your SOL wallet with ~0.01 SOL for transaction fees and rent: ${walletData.publicKey}`,
              step2: useTreasuryPayer
                ? 'Increase treasury USDC available balance'
                : `The USDC token account (ATA) will be auto-created on first USDC transfer`,
              step3: useTreasuryPayer
                ? `Then retry service request`
                : `Then send ${priceUsd} USDC to your wallet (ATA will be derived automatically)`,
              ataAddress: useTreasuryPayer ? treasuryTokenAccount?.toBase58() : resolvedTokenAccount.toBase58(),
              note: useTreasuryPayer
                ? 'Treasury payer mode is enabled; user-level balance checks are enforced by funding ledger.'
                : 'The ATA (Associated Token Account) is deterministically derived from your wallet address. Most wallets handle this automatically.'
            },
            solscanUrl: `https://solscan.io/account/${(useTreasuryPayer ? treasuryTokenAccount : resolvedTokenAccount)?.toBase58()}${clusterParam}`,
          },
          service: {
            agent: agentId,
            serviceType,
            estimatedCost: priceUsd,
            currency: 'USDC',
          },
        });
      }

      // Policy passed and balance sufficient - log and proceed
      console.log(`💰 Proceeding with ${serviceType} from ${agentId}: ${priceUsd} USDC (Balance: ${usdcBalance.toFixed(2)} USDC)`);

      // 2. Build 402 payment requirement
      const solanaNetwork = solanaCluster();
      const usdcMintForRequirement = solanaNetwork === 'mainnet-beta' ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;
      
      // Resolve seller wallet from registered agent first, then env fallback.
      const sellerMainWallet =
        sellerAgent.solanaPubkey ||
        sellerAgent.usdcTokenAccount ||
        process.env.SERVICE_WALLET_PUBKEY ||
        process.env.USDC_TOKEN_ACCOUNT;
      if (!sellerMainWallet) {
        return res.status(500).json({ error: 'AGENT_NOT_CONFIGURED', message: 'Seller wallet not configured. Set USDC_TOKEN_ACCOUNT env var to your main SOL wallet address.' });
      }
      
      // Derive the seller's USDC ATA from their main wallet
      const sellerWalletPubkey = new PublicKey(sellerMainWallet);
      const sellerUsdcAta = getAssociatedTokenAddressSync(
        new PublicKey(usdcMintForRequirement),
        sellerWalletPubkey
      );
      
      const nonce = `nonce_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const requirement = {
        protocol: 'x402',
        version: 'v2',
        network: `solana:${solanaNetwork}`,
        mint: usdcMintForRequirement,
        amount: quote.amountAtomic.toString(),
        payTo: sellerUsdcAta.toBase58(), // Use the derived ATA
        nonce,
        resource: {
          service: serviceType,
          params: serviceParams,
        }
      };

      // 2. Execute payment on behalf of user
      const network = solanaCluster();
      const rpcUrl = network === 'mainnet-beta'
        ? (process.env.SOLANA_RPC_MAINNET || 'https://api.mainnet-beta.solana.com')
        : (process.env.SOLANA_RPC_DEVNET || 'https://solana-devnet.g.alchemy.com/v2/ZJmVXF-LVxv651ws9azjqBr6Upv_l9_5');

      console.log(`🌐 Using Solana RPC: ${rpcUrl.substring(0, 50)}...`);
      const connection = new Connection(rpcUrl, 'confirmed');
      const userKeypair = Keypair.fromSecretKey(Uint8Array.from(walletData.secretKey));
      const treasuryKeypair = useTreasuryPayer ? loadTreasuryKeypair() : null;
      const paymentKeypair = treasuryKeypair || userKeypair;
      const usdcMint = new PublicKey(requirement.mint);
      // Use treasury ATA in treasury mode, otherwise user ATA.
      const buyerTokenAccount = useTreasuryPayer
        ? (treasuryTokenAccount as PublicKey)
        : resolvedTokenAccount;
      
      // Parse seller's USDC account from 402 payment requirement
      const sellerTokenAccount = new PublicKey(requirement.payTo);
      // sellerWalletPubkey is already declared above when building the requirement

      // Check if buyer's token account exists, create if not
      const transaction = new Transaction();
      try {
        await getAccount(connection, buyerTokenAccount);
      } catch (error) {
        // Token account doesn't exist, add instruction to create it
        transaction.add(
          createAssociatedTokenAccountInstruction(
            paymentKeypair.publicKey, // payer
            buyerTokenAccount,      // ata
            paymentKeypair.publicKey, // owner
            usdcMint                // mint
          )
        );
      }

      // Check if seller's token account exists, create if not
      try {
        await getAccount(connection, sellerTokenAccount);
      } catch (error) {
        // Seller's token account doesn't exist, add instruction to create it
        if (!sellerWalletPubkey) {
          throw new Error('Cannot create seller ATA: seller wallet address not configured');
        }
        console.log(`📝 Creating seller's USDC ATA: ${sellerTokenAccount.toBase58()} (owner: ${sellerWalletPubkey.toBase58()})`);
        transaction.add(
          createAssociatedTokenAccountInstruction(
            paymentKeypair.publicKey,     // payer (treasury or buyer pays ATA rent)
            // In treasury mode, treasury pays ATA rent.
            sellerTokenAccount,          // ata address to create
            sellerWalletPubkey,          // owner of the new ATA
            usdcMint                     // mint (USDC)
          )
        );
      }

      // Add transfer instruction
      transaction.add(
        createTransferInstruction(
          buyerTokenAccount,
          sellerTokenAccount,
          paymentKeypair.publicKey,
          parseInt(requirement.amount)
        )
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = paymentKeypair.publicKey;

      console.log(`💸 Sending USDC payment transaction...`);
      
      // Send transaction (don't wait for confirmation to avoid timeout)
      const signature = await connection.sendTransaction(transaction, [paymentKeypair], {
        skipPreflight: false,
        maxRetries: 2,
      });
      
      console.log(`📡 Transaction sent: ${signature}`);
      console.log(`🔗 View on Solscan: https://solscan.io/tx/${signature}?cluster=${network}`);
      
      // Try to confirm with a reasonable timeout (30s for devnet)
      try {
        const confirmation = await Promise.race([
          connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight,
          }, 'confirmed'),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('CONFIRMATION_TIMEOUT')), 30000)
          )
        ]);
        console.log(`✅ Payment confirmed: ${signature}`);
      } catch (confirmError: any) {
        // Transaction was sent but confirmation timed out - this is OK on devnet
        console.log(`⚠️  Confirmation timeout (devnet): ${signature}`);
        console.log(`   Transaction may still succeed - check Solscan`);
        // Don't throw - transaction was still sent successfully
      }

      const serviceRequestPayload = {
        ...(serviceParams || {}),
        user_email: userEmail,
      };

      // 3. Create payment proof
      const bodyHash = createHash('sha256')
        .update(JSON.stringify(serviceRequestPayload))
        .digest('hex');

      const proof = {
        protocol: 'x402',
        version: 'v2',
        txSignature: signature,
        network: requirement.network,
        nonce: requirement.nonce,
        amount: requirement.amount,
        mint: requirement.mint,
        payTo: sellerTokenAccount.toBase58(),
        bodyHash,
        timestamp: Date.now(),
      };

      // Base64url encode the proof
      const encodedProof = Buffer.from(JSON.stringify(proof))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      // 4. Complete service request with payment proof (use internal localhost, not external URL)
      // Use internal URL - port depends on environment (3000 local, 10000 Render)
      const port = process.env.PORT || '3000';
      const internalApiUrl = `http://localhost:${port}`;
      const serviceResponse = await fetch(`${internalApiUrl}/api/agent/services/${serviceType}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${generateInternalToken(user.id)}`,
          'Payment-Signature': encodedProof,
          'X-Agent-Id': agentId,
          'X-Service-Quote': b64urlEncodeJson(quote),
        },
        body: JSON.stringify(serviceRequestPayload),
      });

      if (!serviceResponse.ok) {
        if (reservationEntryId) {
          await db.releaseFundingReservation({
            reservationEntryId,
            reason: 'service-response-not-ok',
          });
        }
        const error = await serviceResponse.text();
        return res.status(serviceResponse.status).json({ 
          error: 'SERVICE_FAILED',
          detail: error 
        });
      }

      const serviceResult = await serviceResponse.json();
      const resultEnvelopeHeader = serviceResponse.headers.get('x-result-envelope');

      // 5. Record the agent-to-agent transaction
      const clusterParam = network === 'mainnet-beta' ? '' : '?cluster=devnet';
      await db.recordPurchaseAttempt({
        userId: user.id,
        productId: `service-${serviceType}`,
        productName: `${serviceType} service from ${agentId}`,
        amount: priceUsd,
        merchant: agentId,
        category: serviceType,
        allowed: true,
        requiresApproval: false,
        policyCheckResults: policyCheck.matchedPolicies,
        transactionType: 'agent-to-agent',
        paymentMethod: 'solana-usdc',
        blockchainTxSignature: signature,
      });

      console.log(`✅ Recorded agent-to-agent transaction: ${signature}`);

      if (reservationEntryId) {
        await db.commitFundingReservation({
          reservationEntryId,
          referenceType: 'onchain-payment',
          referenceId: signature,
        });
      }

      // Calculate remaining balance
      const remainingBalance = usdcBalance - priceUsd;

      const responsePayload = {
        idempotencyKey: idemContext?.idempotencyKey,
        success: true,
        service: serviceType,
        agent: agentId,
        quote: {
          quoteId: quote.quoteId,
          amount: quote.amountUsd,
          amountAtomic: quote.amountAtomic,
          currency: quote.currency,
          expiresAt: quote.expiresAt,
        },
        payment: {
          amount: priceUsd,
          currency: 'USDC',
          txSignature: signature,
          explorerUrl: `https://solscan.io/tx/${signature}${clusterParam}`,
          payer: useTreasuryPayer ? 'treasury' : 'user-wallet',
        },
        wallet: {
          publicKey: useTreasuryPayer ? paymentKeypair.publicKey.toBase58() : walletData.publicKey,
          tokenAccount: useTreasuryPayer ? buyerTokenAccount.toBase58() : ata.toBase58(),
          previousBalance: effectiveBalance,
          paid: priceUsd,
          remainingBalance: effectiveBalance - priceUsd,
          solscanUrl: `https://solscan.io/account/${(useTreasuryPayer ? buyerTokenAccount : ata).toBase58()}${clusterParam}`,
        },
        serviceResult,
        ...(resultEnvelopeHeader && { resultEnvelope: resultEnvelopeHeader }),
        message: `Successfully completed ${serviceType} service and paid ${priceUsd} USDC to ${agentId}. Remaining balance: ${remainingBalance.toFixed(2)} USDC`,
      };
      if (idemContext) {
        await db.completeIdempotentRequest({
          userId: idemContext.userId,
          endpoint: idemContext.endpoint,
          idempotencyKey: idemContext.idempotencyKey,
          responseCode: 200,
          responseJson: {
            success: true,
            service: serviceType,
            agent: agentId,
            quote: {
              quoteId: quote.quoteId,
              amount: quote.amountUsd,
              amountAtomic: quote.amountAtomic,
              currency: quote.currency,
              expiresAt: quote.expiresAt,
            },
            payment: {
              amount: priceUsd,
              currency: 'USDC',
              txSignature: signature,
              explorerUrl: `https://solscan.io/tx/${signature}${clusterParam}`,
              payer: useTreasuryPayer ? 'treasury' : 'user-wallet',
            },
            serviceResult,
            ...(resultEnvelopeHeader && { resultEnvelope: resultEnvelopeHeader }),
          },
        });
      }
      res.json(responsePayload);

    } catch (error: any) {
      console.error('Service request error:', error);
      if (idemContext) {
        await db.failIdempotentRequest({
          userId: idemContext.userId,
          endpoint: idemContext.endpoint,
          idempotencyKey: idemContext.idempotencyKey,
          responseCode: 500,
          errorMessage: error.message || 'Unhandled request-service error',
        });
      }
      res.status(500).json({ 
        error: 'SERVICE_REQUEST_ERROR',
        message: error.message 
      });
    }
  });

  /**
   * POST /api/chatgpt-agent/request-service/provider-native/submit
   * Provider-native x402 helper:
   * - without payment_signature: returns provider requirement + selected leg
   * - with payment_signature: forwards paid call to provider endpoint
   */
  router.post('/request-service/provider-native/submit', async (req, res) => {
    try {
      const userEmail = req.body?.user_email || (req as any).user?.email;
      const agentId = req.body.agentId || req.body.agent_id;
      const serviceType = req.body.serviceType || req.body.service_type;
      const serviceParams = req.body.serviceParams || req.body.service_params || {};
      const paymentSignature = req.body.payment_signature || req.headers['payment-signature'];
      if (!userEmail || !agentId || !serviceType) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'user_email, agent_id, service_type are required',
        });
      }
      const user = await db.getUserByEmail(userEmail);
      if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });
      const sellerAgent = await db.getRegisteredAgent(agentId);
      if (!sellerAgent) return res.status(404).json({ error: 'AGENT_NOT_FOUND' });

      const providerRaw = hydrateProviderSecret(sellerAgent?.metadata?.provider);
      const provider = normalizeProviderConfig({
        ...providerRaw,
        apiKey: providerRaw?.apiKey || process.env.ARCH_TOOLS_API_KEY,
        baseUrl: providerRaw?.baseUrl || process.env.ARCH_TOOLS_BASE_URL || providerRaw?.endpoint,
      });
      if (!provider || provider.pricingStrategy !== 'x402') {
        return res.status(400).json({
          error: 'PROVIDER_NATIVE_X402_UNAVAILABLE',
          message: 'Provider metadata with pricingStrategy=x402 is required',
        });
      }

      const providerChallenge = await fetchProviderX402Requirement(serviceType, serviceParams, provider);
      const selectedAccept = selectProviderAcceptLeg(providerChallenge.requirement);
      const paymentToSign = buildPaymentToSign(selectedAccept, providerChallenge.requirement?.resource?.url);
      if (!paymentSignature) {
        return res.status(402).json({
          error: 'PROVIDER_PAYMENT_REQUIRED',
          mode: 'provider-native-x402',
          provider: { name: provider.name, baseUrl: provider.baseUrl, tool: providerChallenge.tool },
          providerRequirement: providerChallenge.requirement,
          selectedAccept,
          paymentToSign,
          providerPaymentRequiredHeader: providerChallenge.paymentRequiredHeader,
          requirementSource: providerChallenge.source,
        });
      }

      const url = resolveProviderExecuteUrl(provider, providerChallenge.tool);
      const providerRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Payment-Signature': String(paymentSignature),
        },
        body: JSON.stringify(serviceParams),
      });
      const text = await providerRes.text();
      let parsed: any;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = { raw: text };
      }
      return res.status(providerRes.status).json({
        mode: 'provider-native-x402',
        provider: { name: provider.name, baseUrl: provider.baseUrl, tool: providerChallenge.tool },
        selectedAccept,
        paymentToSign,
        providerStatus: providerRes.status,
        providerResponse: parsed,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'PROVIDER_NATIVE_X402_SUBMIT_ERROR',
        message: error.message,
      });
    }
  });

  return router;
}

/**
 * Generate internal JWT for service-to-service communication
 */
function generateInternalToken(userId: string): string {
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'; // Set JWT_SECRET in production
  return jwt.sign({ userId, email: 'internal@system' }, JWT_SECRET, { expiresIn: '5m' });
}
