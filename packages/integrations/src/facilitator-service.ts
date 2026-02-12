/**
 * Facilitator Service for x402 Payment Verification
 * Verifies Solana transactions and enforces anti-replay protection
 */

import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import type { X402PaymentProof, X402Receipt } from '@agentic-commerce/shared';
import { DB } from '@agentic-commerce/database';
import { sha256HexUtf8, parseNetworkId, getRpcUrl } from './x402-protocol';

export interface VerificationParams {
  proof: X402PaymentProof;
  expected: {
    mint: string;
    payTo: string;
    network: string;
    bodyHash: string;
    minAmount?: string; // Optional: verify minimum amount
  };
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

export interface VerificationResult {
  ok: boolean;
  code?: number;
  error?: string;
  detail?: string;
  receipt?: X402Receipt;
}

export class FacilitatorService {
  private db: DB;
  private connections: Map<string, Connection> = new Map();

  constructor(db: DB) {
    this.db = db;
  }

  /**
   * Get or create Solana connection for network
   */
  private getConnection(networkId: string, commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'): Connection {
    const key = `${networkId}-${commitment}`;
    
    if (!this.connections.has(key)) {
      const rpcUrl = getRpcUrl(networkId);
      const connection = new Connection(rpcUrl, commitment);
      this.connections.set(key, connection);
    }
    
    return this.connections.get(key)!;
  }

  /**
   * Verify x402 payment proof
   */
  async verifyPayment(params: VerificationParams): Promise<VerificationResult> {
    const { proof, expected, commitment = 'confirmed' } = params;

    // 1. Validate proof structure
    if (!proof.txSignature || !proof.nonce || !proof.bodyHash) {
      return {
        ok: false,
        code: 400,
        error: 'INVALID_PROOF',
        detail: 'Missing required fields in payment proof',
      };
    }

    // 2. Check nonce hasn't been used (anti-replay)
    const existingNonce = await this.db.checkX402Nonce(proof.nonce);
    if (existingNonce) {
      return {
        ok: false,
        code: 409,
        error: 'NONCE_REUSED',
        detail: 'This nonce has already been used',
      };
    }

    // 3. Verify bodyHash matches
    if (proof.bodyHash !== expected.bodyHash) {
      return {
        ok: false,
        code: 400,
        error: 'BODY_HASH_MISMATCH',
        detail: 'Payment is not bound to this request',
      };
    }

    // 4. Verify payment details match expected
    if (proof.mint !== expected.mint) {
      return {
        ok: false,
        code: 400,
        error: 'MINT_MISMATCH',
        detail: `Expected mint ${expected.mint}, got ${proof.mint}`,
      };
    }

    if (proof.payTo !== expected.payTo) {
      return {
        ok: false,
        code: 400,
        error: 'PAYTO_MISMATCH',
        detail: `Expected payTo ${expected.payTo}, got ${proof.payTo}`,
      };
    }

    if (proof.network !== expected.network) {
      return {
        ok: false,
        code: 400,
        error: 'NETWORK_MISMATCH',
        detail: `Expected network ${expected.network}, got ${proof.network}`,
      };
    }

    // 5. Verify Solana transaction on-chain
    const connection = this.getConnection(proof.network, commitment);
    
    let tx: ParsedTransactionWithMeta | null;
    try {
      tx = await connection.getParsedTransaction(proof.txSignature, {
        commitment: commitment as any, // Type compatibility fix for Solana commitment levels
        maxSupportedTransactionVersion: 0,
      });
    } catch (error: any) {
      return {
        ok: false,
        code: 502,
        error: 'RPC_ERROR',
        detail: `Failed to fetch transaction: ${error.message}`,
      };
    }

    if (!tx) {
      return {
        ok: false,
        code: 404,
        error: 'TX_NOT_FOUND',
        detail: 'Transaction not found on-chain',
      };
    }

    if (tx.meta?.err) {
      return {
        ok: false,
        code: 400,
        error: 'TX_FAILED',
        detail: `Transaction failed: ${JSON.stringify(tx.meta.err)}`,
      };
    }

    // 6. Parse and verify the token transfer
    const transferInfo = this.parseTokenTransfer(tx, expected.mint, expected.payTo);
    
    if (!transferInfo.success) {
      return {
        ok: false,
        code: 400,
        error: 'INVALID_TRANSFER',
        detail: transferInfo.error || 'Could not verify token transfer',
      };
    }

    // 7. Verify amount
    const transferAmount = transferInfo.amount!;
    const expectedAmount = BigInt(proof.amount);
    
    if (transferAmount < expectedAmount) {
      return {
        ok: false,
        code: 400,
        error: 'INSUFFICIENT_AMOUNT',
        detail: `Expected ${expectedAmount}, got ${transferAmount}`,
      };
    }

    // 8. Store nonce to prevent replay
    const now = Math.floor(Date.now() / 1000);
    await this.db.storeX402Nonce({
      nonce: proof.nonce,
      txSignature: proof.txSignature,
      agentId: expected.payTo, // Using payTo as agentId for now
      amount: proof.amount,
      mint: proof.mint,
      verified: true,
      verifiedAt: new Date(),
      expiresAt: new Date((now + 3600) * 1000), // 1 hour expiry
    });

    // 9. Create and return receipt
    const receipt: X402Receipt = {
      ok: true,
      txSignature: proof.txSignature,
      amount: proof.amount,
      mint: proof.mint,
      payTo: proof.payTo,
      nonce: proof.nonce,
      verifiedAt: now,
      buyer: transferInfo.buyer,
    };

    return {
      ok: true,
      receipt,
    };
  }

  /**
   * Parse SPL token transfer from parsed transaction
   */
  private parseTokenTransfer(
    tx: ParsedTransactionWithMeta,
    expectedMint: string,
    expectedDestination: string
  ): {
    success: boolean;
    amount?: bigint;
    buyer?: string;
    error?: string;
  } {
    if (!tx.transaction.message.instructions) {
      return { success: false, error: 'No instructions in transaction' };
    }

    // Look for SPL Token transfer instruction
    for (const instruction of tx.transaction.message.instructions) {
      if ('parsed' in instruction && instruction.parsed) {
        const parsed = instruction.parsed;
        
        // Check for transferChecked (preferred) or transfer
        if (parsed.type === 'transferChecked' || parsed.type === 'transfer') {
          const info = parsed.info;
          
          // Verify mint (for transferChecked)
          if (parsed.type === 'transferChecked' && info.mint !== expectedMint) {
            continue;
          }
          
          // Verify destination
          if (info.destination !== expectedDestination) {
            continue;
          }
          
          // Extract amount
          const amount = parsed.type === 'transferChecked'
            ? BigInt(info.tokenAmount?.amount || '0')
            : BigInt(info.amount || '0');
          
          // Extract buyer (source)
          const buyer = info.source || info.authority;
          
          return {
            success: true,
            amount,
            buyer,
          };
        }
      }
    }

    return {
      success: false,
      error: 'No matching SPL token transfer found in transaction',
    };
  }
}
