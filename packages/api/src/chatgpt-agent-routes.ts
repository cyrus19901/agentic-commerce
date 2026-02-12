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
} from '@solana/spl-token';
import { DB } from '@agentic-commerce/database';
import { PolicyService } from '@agentic-commerce/core';
import { createHash } from 'crypto';

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

export function createChatGPTAgentRoutes(
  db: DB,
  policyService: PolicyService,
  facilitatorService: FacilitatorService
) {
  const router = Router();

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
    try {
      const userEmail = req.body?.user_email || (req as any).user?.email;
      const { agentId, serviceType, serviceParams } = req.body;

      if (!userEmail) {
        return res.status(400).json({ 
          error: 'MISSING_EMAIL',
          message: 'Please provide user_email in request' 
        });
      }

      if (!agentId || !serviceType) {
        return res.status(400).json({ 
          error: 'INVALID_REQUEST',
          message: 'Missing required fields: agentId, serviceType' 
        });
      }

      const user = await db.getUserByEmail(userEmail);
      if (!user) {
        return res.status(404).json({ 
          error: 'USER_NOT_FOUND',
          message: 'Please create an account first' 
        });
      }

      // Get user's wallet
      const walletData = await db.getUserWallet(user.id);
      if (!walletData) {
        return res.status(400).json({ 
          error: 'NO_WALLET',
          message: 'Please create a wallet first using /api/chatgpt-agent/wallet' 
        });
      }

      // Get seller agent info
      const sellerAgent = await db.getRegisteredAgent(agentId);
      if (!sellerAgent) {
        return res.status(404).json({ 
          error: 'AGENT_NOT_FOUND',
          message: `Agent ${agentId} not found in registry` 
        });
      }

      // 1. Build 402 payment requirement (payTo from registry when valid, else env/default)
      const solanaNetwork = solanaCluster();
      const usdcMintForRequirement = solanaNetwork === 'mainnet-beta' ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;
      const payTo = isRealSolanaAddress(sellerAgent.usdcTokenAccount)
        ? sellerAgent.usdcTokenAccount!
        : (process.env.USDC_TOKEN_ACCOUNT || 'Aj3Z8i5HQ1z9poYBfCicYXHCtfzry9ijcQyunPTaoG4g');
      const nonce = `nonce_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const requirement = {
        protocol: 'x402',
        version: 'v2',
        network: `solana:${solanaNetwork}`,
        mint: usdcMintForRequirement,
        amount: '100000', // 0.1 USDC (6 decimals) – could come from agent metadata later
        payTo,
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

      const connection = new Connection(rpcUrl, 'confirmed');
      const buyerKeypair = Keypair.fromSecretKey(Uint8Array.from(walletData.secretKey));
      const usdcMint = new PublicKey(requirement.mint);
      const buyerTokenAccount = await getAssociatedTokenAddress(usdcMint, buyerKeypair.publicKey);
      
      // Parse seller's USDC account from 402 payment requirement
      const sellerTokenAccount = new PublicKey(requirement.payTo);

      // Check if buyer's token account exists, create if not
      const transaction = new Transaction();
      try {
        await getAccount(connection, buyerTokenAccount);
      } catch (error) {
        // Token account doesn't exist, add instruction to create it
        transaction.add(
          createAssociatedTokenAccountInstruction(
            buyerKeypair.publicKey, // payer
            buyerTokenAccount,      // ata
            buyerKeypair.publicKey, // owner
            usdcMint                // mint
          )
        );
      }

      // Add transfer instruction
      transaction.add(
        createTransferInstruction(
          buyerTokenAccount,
          sellerTokenAccount,
          buyerKeypair.publicKey,
          parseInt(requirement.amount)
        )
      );

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = buyerKeypair.publicKey;

      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [buyerKeypair],
        { commitment: 'confirmed' }
      );

      console.log(`✅ Payment executed: ${signature}`);

      // 3. Create payment proof
      const bodyHash = createHash('sha256')
        .update(JSON.stringify(serviceParams || {}))
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

      // 4. Complete service request with payment proof
      const serviceResponse = await fetch(`${process.env.API_URL || 'http://localhost:3000'}/api/agent/services/${serviceType}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${generateInternalToken(user.id)}`,
          'Payment-Signature': encodedProof,
        },
        body: JSON.stringify(serviceParams || {}),
      });

      if (!serviceResponse.ok) {
        const error = await serviceResponse.text();
        return res.status(serviceResponse.status).json({ 
          error: 'SERVICE_FAILED',
          detail: error 
        });
      }

      const serviceResult = await serviceResponse.json();

      res.json({
        success: true,
        service: serviceType,
        agent: agentId,
        payment: {
          amount: parseInt(requirement.amount) / 1_000_000,
          currency: 'USDC',
          txSignature: signature,
          explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${network}`,
        },
        result: serviceResult,
      });

    } catch (error: any) {
      console.error('Service request error:', error);
      res.status(500).json({ 
        error: 'SERVICE_REQUEST_ERROR',
        message: error.message 
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
