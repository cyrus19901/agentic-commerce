import { createHash } from 'crypto';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createTransferInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { DB } from '@agentic-commerce/database';

const API_BASE = process.env.API_URL || 'http://localhost:3001';
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || '';
const AGENT_ID = process.env.AGENT_ID || '';
const SERVICE_TYPE = process.env.SERVICE_TYPE || 'scrape';
const SERVICE_PARAMS = process.env.SERVICE_PARAMS_JSON
  ? JSON.parse(process.env.SERVICE_PARAMS_JSON)
  : { url: 'https://example.com', format: 'markdown' };
const CHALLENGE_ONLY = process.env.CHALLENGE_ONLY === 'true';

function assert(condition: any, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function b64urlEncodeJson(input: any): string {
  return Buffer.from(JSON.stringify(input))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function call(path: string, body: any) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, json };
}

async function loadBuyerKeypairByEmail(email: string): Promise<Keypair> {
  const rawJson = process.env.BUYER_SECRET_KEY_JSON;
  if (rawJson) {
    const arr = JSON.parse(rawJson);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  const rawB64 = process.env.BUYER_SECRET_KEY_BASE64;
  if (rawB64) {
    return Keypair.fromSecretKey(Uint8Array.from(Buffer.from(rawB64, 'base64')));
  }

  // Convenience for local testing: load from DB user wallet by email.
  const db = new DB(process.env.DATABASE_URL);
  try {
    const user = await db.getUserByEmail(email);
    assert(user, `User not found: ${email}`);
    const wallet = await db.getUserWallet(user.id);
    assert(wallet, `No wallet found for user: ${email}`);
    return Keypair.fromSecretKey(Uint8Array.from(wallet.secretKey));
  } finally {
    await db.close();
  }
}

function rpcForProviderNetwork(network: string): string {
  const n = String(network || '').toLowerCase();
  if (n.includes('devnet')) {
    return process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com';
  }
  return process.env.SOLANA_RPC_MAINNET || 'https://api.mainnet-beta.solana.com';
}

async function main() {
  assert(TEST_USER_EMAIL, 'TEST_USER_EMAIL is required');
  assert(AGENT_ID, 'AGENT_ID is required');

  console.log('[1/5] Request provider-native x402 challenge');
  const challenge = await call('/api/chatgpt-agent/request-service/provider-native/submit', {
    user_email: TEST_USER_EMAIL,
    agent_id: AGENT_ID,
    service_type: SERVICE_TYPE,
    service_params: SERVICE_PARAMS,
  });
  assert(challenge.status === 402, `Expected 402 challenge, got ${challenge.status}: ${JSON.stringify(challenge.json)}`);
  const paymentToSign = challenge.json?.paymentToSign;
  assert(paymentToSign, 'Missing paymentToSign in challenge response');
  console.log('[challenge]');
  console.log(
    JSON.stringify(
      {
        mode: challenge.json?.mode,
        provider: challenge.json?.provider,
        selectedAccept: challenge.json?.selectedAccept,
        paymentToSign,
        signerHandoff: {
          chain: paymentToSign.network,
          tokenMintOrAsset: paymentToSign.asset,
          destination: paymentToSign.payTo,
          amountAtomic: paymentToSign.amount,
          resource: paymentToSign.resource,
          timeoutSeconds: paymentToSign.maxTimeoutSeconds,
        },
      },
      null,
      2
    )
  );
  if (CHALLENGE_ONLY) {
    console.log('CHALLENGE_ONLY=true, exiting before payment step.');
    return;
  }

  console.log('[2/5] Load buyer signer');
  const buyer = await loadBuyerKeypairByEmail(TEST_USER_EMAIL);
  console.log(`buyer=${buyer.publicKey.toBase58()}`);

  const network = String(paymentToSign.network || '');
  assert(network.startsWith('solana'), `Only solana provider-native leg is supported by this script. got=${network}`);

  console.log('[3/5] Build and send Solana SPL transfer');
  const rpc = rpcForProviderNetwork(network);
  const connection = new Connection(rpc, 'confirmed');
  const mint = new PublicKey(paymentToSign.asset);
  const payTo = new PublicKey(paymentToSign.payTo);
  const buyerAta = getAssociatedTokenAddressSync(mint, buyer.publicKey);
  const amountAtomic = Number(paymentToSign.amount);
  assert(Number.isFinite(amountAtomic) && amountAtomic > 0, 'Invalid amount in paymentToSign');

  const tx = new Transaction().add(
    createTransferInstruction(
      buyerAta,
      payTo,
      buyer.publicKey,
      amountAtomic
    )
  );

  let txSignature = '';
  try {
    txSignature = await sendAndConfirmTransaction(connection, tx, [buyer], { commitment: 'confirmed' });
  } catch (error: any) {
    throw new Error(`Solana payment failed: ${error?.message || error}`);
  }
  console.log(`tx=${txSignature}`);

  console.log('[4/5] Build provider payment signature packet');
  const bodyHash = createHash('sha256').update(JSON.stringify(SERVICE_PARAMS)).digest('hex');
  const proof = {
    protocol: 'x402',
    version: 'v2',
    txSignature,
    network: paymentToSign.network,
    nonce: `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    amount: String(paymentToSign.amount),
    mint: paymentToSign.asset,
    payTo: paymentToSign.payTo,
    bodyHash,
    timestamp: Date.now(),
  };
  const paymentSignature = b64urlEncodeJson(proof);

  console.log('[5/5] Submit payment signature to provider-native endpoint');
  const submit = await call('/api/chatgpt-agent/request-service/provider-native/submit', {
    user_email: TEST_USER_EMAIL,
    agent_id: AGENT_ID,
    service_type: SERVICE_TYPE,
    service_params: SERVICE_PARAMS,
    payment_signature: paymentSignature,
  });

  console.log(`status=${submit.status}`);
  console.log(JSON.stringify(submit.json, null, 2));
}

main().catch((err) => {
  console.error('\nprovider-native-x402 e2e failed');
  console.error(err);
  process.exit(1);
});

