/**
 * x402 Protocol Implementation for Solana USDC Payments
 * Ported from a2a-x402 project
 */

import { createHash } from 'crypto';
import type { X402Requirement, X402PaymentProof, X402Receipt } from '@agentic-commerce/shared';

/**
 * Base64 URL encoding for x402 headers
 */
export function b64urlEncodeJson(obj: unknown): string {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
  return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Base64 URL decoding for x402 headers
 */
export function b64urlDecodeJson<T>(s: string): T {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(raw) as T;
}

/**
 * SHA-256 hash of UTF-8 string (hex output)
 */
export function sha256HexUtf8(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Create x402 payment requirement (seller side)
 */
export function createX402Requirement(params: {
  amount: string; // Base units (e.g., USDC lamports)
  payTo: string; // Seller's USDC token account
  mint: string; // USDC mint address
  network: string; // e.g., "solana:devnet"
  method: string; // HTTP method
  path: string; // Request path
  bodyHash: string; // SHA-256 of request body
  facilitator: string; // Facilitator URL
  expiresInSeconds?: number; // Default 60s
}): X402Requirement {
  const now = Math.floor(Date.now() / 1000);
  
  return {
    protocol: 'x402',
    version: 'v2',
    scheme: 'exact',
    network: params.network,
    mint: params.mint,
    amount: params.amount,
    payTo: params.payTo,
    nonce: crypto.randomUUID(),
    expiresAt: now + (params.expiresInSeconds || 60),
    resource: {
      method: params.method,
      path: params.path,
      bodyHash: params.bodyHash,
    },
    facilitator: params.facilitator,
  };
}

/**
 * Create payment proof (buyer side after sending Solana transaction)
 */
export function makePaymentProof(
  requirement: X402Requirement,
  txSignature: string
): X402PaymentProof {
  return {
    txSignature,
    nonce: requirement.nonce,
    bodyHash: requirement.resource.bodyHash,
    payTo: requirement.payTo,
    amount: requirement.amount,
    mint: requirement.mint,
    network: requirement.network,
  };
}

/**
 * Validate payment proof structure (basic validation before facilitator check)
 */
export function validatePaymentProof(proof: X402PaymentProof): { valid: boolean; error?: string } {
  if (!proof.txSignature || proof.txSignature.length < 40) {
    return { valid: false, error: 'Invalid transaction signature' };
  }
  
  if (!proof.nonce || proof.nonce.length < 8) {
    return { valid: false, error: 'Invalid nonce' };
  }
  
  if (!proof.bodyHash || proof.bodyHash.length !== 64) {
    return { valid: false, error: 'Invalid body hash' };
  }
  
  if (!proof.payTo || !proof.mint || !proof.network) {
    return { valid: false, error: 'Missing required fields' };
  }
  
  if (!/^\d+$/.test(proof.amount)) {
    return { valid: false, error: 'Invalid amount format' };
  }
  
  return { valid: true };
}

/**
 * Extract network and cluster from network ID
 */
export function parseNetworkId(networkId: string): { chain: string; cluster: string } {
  const parts = networkId.split(':');
  return {
    chain: parts[0] || 'solana',
    cluster: parts[1] || 'devnet',
  };
}

/**
 * Get RPC URL for network
 */
export function getRpcUrl(networkId: string, customRpc?: string): string {
  if (customRpc) return customRpc;
  
  const { cluster } = parseNetworkId(networkId);
  
  switch (cluster) {
    case 'mainnet':
    case 'mainnet-beta':
      return process.env.SOLANA_MAINNET_RPC || process.env.SOLANA_RPC_MAINNET || 'https://api.mainnet-beta.solana.com';
    case 'devnet':
      return process.env.SOLANA_DEVNET_RPC || process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com';
    case 'testnet':
      return process.env.SOLANA_TESTNET_RPC || 'https://api.testnet.solana.com';
    default:
      return 'https://api.devnet.solana.com';
  }
}
