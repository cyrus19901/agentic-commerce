/**
 * End-to-End Test: Agent-to-Agent Communication with Real Solana Transactions
 *
 * This test simulates a complete x402 payment flow between two agents using:
 * - Real Solana devnet transactions
 * - Actual USDC transfers
 * - Production-ready x402 protocol
 *
 * Note: The test does NOT call the API wallet endpoint. Verification uses
 * getParsedTransaction(signature), not getTokenAccountBalance. So "test passes"
 * proves tx fetch works; balance display uses getTokenAccountBalance and can
 * fail for some accounts on public RPC (devnet) even when the tx is on-chain.
 * ATA derivation is identical everywhere: getAssociatedTokenAddress(mint, owner, false).
 *
 * Prerequisites:
 * - Solana CLI installed
 * - Devnet SOL for gas fees
 * - USDC devnet tokens
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import fetch from 'node-fetch';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Solana devnet (same as API: use env so Docker and test match)
const SOLANA_DEVNET_RPC = process.env.SOLANA_RPC_DEVNET || process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
const USDC_DEVNET_MINT = new PublicKey(process.env.USDC_MINT_DEVNET || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

// API Configuration
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Test Configuration
const BUYER_AGENT_ID = 'agent://buyer-test/v1';
const SELLER_AGENT_ID = 'agent://seller-test/v1';
// Amount comes from API 402 response (requirement.amount); API uses calculateServicePrice (e.g. 100_000 for data-scraping)

/**
 * Load or create keypairs from file (so we can reuse funded accounts)
 */
function loadOrCreateKeypairs(): { buyerKeypair: Keypair; sellerKeypair: Keypair } {
  const keypairDir = path.join(__dirname, '.keypairs');
  const buyerPath = path.join(keypairDir, 'buyer.json');
  const sellerPath = path.join(keypairDir, 'seller.json');
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(keypairDir)) {
    fs.mkdirSync(keypairDir, { recursive: true });
  }
  
  let buyerKeypair: Keypair;
  let sellerKeypair: Keypair;
  
  // Load or create buyer keypair
  if (fs.existsSync(buyerPath)) {
    const buyerSecret = JSON.parse(fs.readFileSync(buyerPath, 'utf-8'));
    buyerKeypair = Keypair.fromSecretKey(Uint8Array.from(buyerSecret));
    console.log('  ✓ Loaded existing buyer keypair');
  } else {
    buyerKeypair = Keypair.generate();
    fs.writeFileSync(buyerPath, JSON.stringify(Array.from(buyerKeypair.secretKey)));
    console.log('  ✓ Created new buyer keypair');
  }
  
  // Load or create seller keypair
  if (fs.existsSync(sellerPath)) {
    const sellerSecret = JSON.parse(fs.readFileSync(sellerPath, 'utf-8'));
    sellerKeypair = Keypair.fromSecretKey(Uint8Array.from(sellerSecret));
    console.log('  ✓ Loaded existing seller keypair');
  } else {
    sellerKeypair = Keypair.generate();
    fs.writeFileSync(sellerPath, JSON.stringify(Array.from(sellerKeypair.secretKey)));
    console.log('  ✓ Created new seller keypair');
  }
  
  return { buyerKeypair, sellerKeypair };
}

/**
 * Setup: Create Solana keypairs and fund accounts
 */
async function setupSolanaAccounts(connection: Connection) {
  console.log('🔑 Setting up Solana accounts on devnet...');
  
  // Load or create keypairs (so they persist between runs)
  const { buyerKeypair, sellerKeypair } = loadOrCreateKeypairs();
  
  console.log(`  Buyer: ${buyerKeypair.publicKey.toBase58()}`);
  console.log(`  Seller: ${sellerKeypair.publicKey.toBase58()}`);
  
  // Check balances
  console.log('\n💰 Checking SOL balances...');
  const buyerBalance = await connection.getBalance(buyerKeypair.publicKey);
  const sellerBalance = await connection.getBalance(sellerKeypair.publicKey);
  
  console.log(`  Buyer: ${buyerBalance / LAMPORTS_PER_SOL} SOL`);
  console.log(`  Seller: ${sellerBalance / LAMPORTS_PER_SOL} SOL`);
  
  // Check if we need funding
  const needsFunding: string[] = [];
  if (buyerBalance < 0.1 * LAMPORTS_PER_SOL) {
    needsFunding.push(`Buyer (${buyerKeypair.publicKey.toBase58()})`);
  }
  if (sellerBalance < 0.1 * LAMPORTS_PER_SOL) {
    needsFunding.push(`Seller (${sellerKeypair.publicKey.toBase58()})`);
  }
  
  if (needsFunding.length > 0) {
    console.log('\n⚠️  Accounts need funding!');
    console.log('\n📝 Fund these addresses:');
    if (buyerBalance < 0.1 * LAMPORTS_PER_SOL) {
      console.log(`  Buyer:  ${buyerKeypair.publicKey.toBase58()}`);
      console.log(`          solana airdrop 1 ${buyerKeypair.publicKey.toBase58()} --url devnet`);
    }
    if (sellerBalance < 0.1 * LAMPORTS_PER_SOL) {
      console.log(`  Seller: ${sellerKeypair.publicKey.toBase58()}`);
      console.log(`          solana airdrop 1 ${sellerKeypair.publicKey.toBase58()} --url devnet`);
    }
    console.log('\n🌐 Or use the faucet: https://faucet.solana.com');
    throw new Error('Accounts need SOL funding. See instructions above.');
  }
  
  console.log('  ✅ Both accounts have sufficient SOL');
  
  // Get USDC token accounts (same derivation as API)
  const buyerUsdcAccount = await getAssociatedTokenAddress(
    USDC_DEVNET_MINT,
    buyerKeypair.publicKey
  );
  
  const sellerUsdcAccount = await getAssociatedTokenAddress(
    USDC_DEVNET_MINT,
    sellerKeypair.publicKey
  );
  
  // Create token accounts if they don't exist
  console.log('🪙 Setting up USDC token accounts...');
  await createTokenAccountIfNeeded(connection, buyerKeypair, buyerUsdcAccount);
  await createTokenAccountIfNeeded(connection, sellerKeypair, sellerUsdcAccount);

  // Prove ATA derivation is correct (same mint+owner as API); RPC can read this account
  try {
    await getAccount(connection, buyerUsdcAccount);
    console.log(`  ✓ Buyer USDC ATA exists and is readable via RPC`);
  } catch (e: any) {
    console.warn('  ⚠ getAccount(buyer ATA) failed:', e?.message || e);
  }

  console.log('\n📌 For the API to accept this test\'s payments, start the API with:');
  console.log(`   USDC_TOKEN_ACCOUNT=${sellerUsdcAccount.toBase58()}`);
  console.log('   (Same mint/RPC: USDC_MINT_DEVNET, SOLANA_CLUSTER=devnet)\n');

  return {
    buyerKeypair,
    sellerKeypair,
    buyerUsdcAccount,
    sellerUsdcAccount,
  };
}

async function createTokenAccountIfNeeded(
  connection: Connection,
  payer: Keypair,
  tokenAccount: PublicKey
) {
  try {
    await getAccount(connection, tokenAccount);
    console.log(`  ✓ Token account exists: ${tokenAccount.toBase58()}`);
  } catch (error) {
    console.log(`  Creating token account: ${tokenAccount.toBase58()}`);
    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        tokenAccount,
        payer.publicKey,
        USDC_DEVNET_MINT
      )
    );
    await sendAndConfirmTransaction(connection, transaction, [payer]);
    console.log(`  ✓ Token account created`);
  }
}

/**
 * Step 1: Register agents in the registry
 */
async function registerAgents(
  buyerPubkey: PublicKey,
  sellerPubkey: PublicKey,
  buyerUsdcAccount: PublicKey,
  sellerUsdcAccount: PublicKey
) {
  console.log('\n📋 Step 1: Registering agents...');
  
  // First, create a user in the database via the API
  console.log('  Creating test user in database...');
  const userResponse = await fetch(`${API_BASE_URL}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'e2e-test@example.com',
      name: 'E2E Test User',
    }),
  });
  
  let userId: string;
  if (userResponse.ok) {
    const userData = await userResponse.json();
    userId = userData.user?.id || 'test-e2e-user';
    console.log(`  ✓ User created: ${userId}`);
  } else {
    userId = 'test-e2e-user';
    console.log(`  Using default user: ${userId}`);
  }
  
  // Generate JWT for authentication
  const jwt = require('jsonwebtoken');
  const token = jwt.sign(
    { userId, email: 'e2e-test@example.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  
  // Register seller agent
  const sellerResponse = await fetch(`${API_BASE_URL}/api/registry/agents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      agentId: SELLER_AGENT_ID,
      name: 'Test Seller Agent',
      baseUrl: 'http://localhost:4001',
      services: ['data-scraping', 'api-calls'],
      serviceDescription: 'E2E test seller agent providing data services',
      acceptedCurrencies: ['USDC'],
      usdcTokenAccount: sellerUsdcAccount.toBase58(),
      solanaPubkey: sellerPubkey.toBase58(),
    }),
  });
  
  if (!sellerResponse.ok) {
    const errorData = await sellerResponse.json();
    if (errorData.error === 'AGENT_EXISTS') {
      console.log('  ⚠️  Seller agent already exists, skipping registration');
    } else {
      throw new Error(`Failed to register seller: ${JSON.stringify(errorData)}`);
    }
  } else {
    console.log('  ✓ Seller agent registered');
  }
  
  // Register buyer agent
  const buyerResponse = await fetch(`${API_BASE_URL}/api/registry/agents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      agentId: BUYER_AGENT_ID,
      name: 'Test Buyer Agent',
      baseUrl: 'http://localhost:4002',
      services: ['autonomous-purchasing'],
      serviceDescription: 'E2E test buyer agent',
      acceptedCurrencies: ['USDC'],
      usdcTokenAccount: buyerUsdcAccount.toBase58(),
      solanaPubkey: buyerPubkey.toBase58(),
    }),
  });
  
  if (!buyerResponse.ok) {
    const errorData = await buyerResponse.json();
    if (errorData.error === 'AGENT_EXISTS') {
      console.log('  ⚠️  Buyer agent already exists, skipping registration');
    } else {
      throw new Error(`Failed to register buyer: ${JSON.stringify(errorData)}`);
    }
  } else {
    console.log('  ✓ Buyer agent registered');
  }
  
  return token;
}

/**
 * Step 2: Buyer requests service from seller (gets 402 Payment Required)
 */
async function requestService(token: string) {
  console.log('\n⚡ Step 2: Buyer requests service from seller...');
  
  const response = await fetch(`${API_BASE_URL}/api/agent/services/data-scraping`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      url: 'https://example.com',
      extractFields: ['title', 'description'],
    }),
  });
  
  console.log(`  Status: ${response.status} ${response.statusText}`);
  
  if (response.status !== 402) {
    const body = await response.text();
    throw new Error(`Expected 402, got ${response.status}: ${body}`);
  }
  
  const paymentHeader = response.headers.get('PAYMENT-REQUIRED');
  const responseBody = await response.json();
  
  console.log('  ✓ Received 402 Payment Required');
  console.log(`  Payment header: ${paymentHeader?.substring(0, 50)}...`);
  
  return responseBody.requirement;
}

/**
 * Step 3: Buyer creates and executes USDC transfer on Solana devnet.
 * Pays to requirement.payTo (from API 402) so verification passes.
 */
async function executePayment(
  connection: Connection,
  buyerKeypair: Keypair,
  buyerUsdcAccount: PublicKey,
  requirement: any
) {
  console.log('\n💸 Step 3: Executing USDC payment on Solana devnet...');
  
  const payTo = new PublicKey(requirement.payTo);
  const amount = parseInt(requirement.amount);
  console.log(`  Amount: ${amount} lamports (${amount / 1_000_000} USDC)`);
  console.log(`  From: ${buyerUsdcAccount.toBase58()}`);
  console.log(`  To: ${requirement.payTo} (from API 402)`);
  
  // Create transfer instruction (destination = API's USDC_TOKEN_ACCOUNT)
  const transferInstruction = createTransferInstruction(
    buyerUsdcAccount,
    payTo,
    buyerKeypair.publicKey,
    amount
  );
  
  // Build transaction
  const transaction = new Transaction().add(transferInstruction);
  
  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = buyerKeypair.publicKey;
  
  // Sign transaction
  transaction.sign(buyerKeypair);
  
  // Send transaction
  console.log('  📤 Sending transaction to Solana devnet...');
  const signature = await connection.sendRawTransaction(transaction.serialize());
  
  console.log(`  Transaction signature: ${signature}`);
  console.log(`  🔗 View on Solana Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  
  // Wait for confirmation
  console.log('  ⏳ Waiting for confirmation...');
  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  });
  
  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  
  console.log('  ✅ Transaction confirmed on devnet!');
  
  return {
    signature,
    transaction: transaction.serialize().toString('base64'),
  };
}

/**
 * Step 4: Create payment proof for x402 protocol.
 * proof.payTo must match requirement.payTo (what the API expects).
 */
async function createPaymentProof(
  signature: string,
  requirement: any,
  buyerKeypair: Keypair
): Promise<any> {
  console.log('\n🔐 Step 4: Creating x402 payment proof...');
  
  const proof = {
    protocol: 'x402',
    version: 'v2',
    txSignature: signature,
    network: requirement.network || 'solana:devnet',
    nonce: requirement.nonce,
    amount: requirement.amount,
    mint: requirement.mint,
    payTo: requirement.payTo, // Must match API's USDC_TOKEN_ACCOUNT for verification
    timestamp: Date.now(),
  };
  
  // Create body hash (what was originally requested)
  const bodyData = JSON.stringify({
    url: 'https://example.com',
    extractFields: ['title', 'description'],
  });
  const bodyHash = crypto
    .createHash('sha256')
    .update(bodyData)
    .digest('hex');
  
  proof['bodyHash'] = bodyHash;
  
  // Sign the proof with buyer's keypair
  const proofString = JSON.stringify(proof);
  const proofSignature = crypto
    .createHmac('sha256', buyerKeypair.secretKey.toString('hex'))
    .update(proofString)
    .digest('hex');
  
  proof['signature'] = proofSignature;
  
  console.log('  ✓ Payment proof created');
  console.log(`  Nonce: ${proof.nonce}`);
  console.log(`  Tx Signature: ${proof.txSignature}`);
  
  return proof;
}

/**
 * Step 5: Submit payment proof to facilitator for verification
 */
async function verifyPayment(proof: any, requirement: any) {
  console.log('\n✅ Step 5: Verifying payment with facilitator...');
  
  const expected = {
    mint: requirement.mint,
    payTo: requirement.payTo,
    amount: requirement.amount,
    network: requirement.network || 'solana:devnet',
    bodyHash: requirement.resource?.bodyHash || requirement.bodyHash,
  };
  
  const response = await fetch(`${API_BASE_URL}/api/facilitator/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ proof, expected }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Verification failed: ${error}`);
  }
  
  const result = await response.json();
  
  console.log('  ✓ Payment verified by facilitator');
  console.log(`  Valid: ${result.valid}`);
  console.log(`  Receipt ID: ${result.receipt?.id}`);
  
  return result;
}

/**
 * Step 6: Complete the service request with payment proof
 */
async function completeServiceRequest(token: string, proof: any) {
  console.log('\n🎯 Step 6: Completing service request with payment...');
  
  // Base64url encode the proof
  const encodedProof = Buffer.from(JSON.stringify(proof))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  const response = await fetch(`${API_BASE_URL}/api/agent/services/data-scraping`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Payment-Signature': encodedProof,
    },
    body: JSON.stringify({
      url: 'https://example.com',
      extractFields: ['title', 'description'],
    }),
  });
  
  console.log(`  Status: ${response.status} ${response.statusText}`);
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Service request failed: ${error}`);
  }
  
  const result = await response.json();
  console.log('  ✓ Service completed successfully');
  console.log(`  Result:`, JSON.stringify(result, null, 2));
  
  return result;
}

/**
 * Main E2E Test
 */
async function runE2ETest() {
  console.log('🚀 Starting E2E Agent-to-Agent x402 Test (Real Solana Devnet)\n');
  console.log('='.repeat(70));
  
  try {
    // Connect to Solana devnet
    console.log(`\n🌐 Connecting to Solana devnet: ${SOLANA_DEVNET_RPC}`);
    const connection = new Connection(SOLANA_DEVNET_RPC, 'confirmed');
    const version = await connection.getVersion();
    console.log(`  ✓ Connected to Solana ${JSON.stringify(version)}`);
    
    // Setup accounts
    const accounts = await setupSolanaAccounts(connection);
    
    // Register agents
    const token = await registerAgents(
      accounts.buyerKeypair.publicKey,
      accounts.sellerKeypair.publicKey,
      accounts.buyerUsdcAccount,
      accounts.sellerUsdcAccount
    );
    
    // Request service (get 402 payment requirement)
    const requirement = await requestService(token);
    
    // Execute USDC payment on Solana devnet (pay to requirement.payTo = API's USDC_TOKEN_ACCOUNT)
    const payment = await executePayment(
      connection,
      accounts.buyerKeypair,
      accounts.buyerUsdcAccount,
      requirement
    );
    
    // Create payment proof (payTo must match requirement for API verification)
    const proof = await createPaymentProof(
      payment.signature,
      requirement,
      accounts.buyerKeypair
    );
    
    // Complete service request with payment proof
    // (The API server will verify with facilitator internally)
    const result = await completeServiceRequest(token, proof);
    
    console.log('\n' + '='.repeat(70));
    console.log('🎉 E2E TEST PASSED!');
    console.log('='.repeat(70));
    console.log('\n✅ Summary:');
    console.log(`  • Agents registered: Buyer & Seller`);
    console.log(`  • 402 Payment Required: Received`);
    console.log(`  • Solana Transaction: ${payment.signature}`);
    console.log(`  • Payment Verified & Service Completed: ✅`);
    console.log(`\n🔗 View transaction on Solana Explorer:`);
    console.log(`   https://explorer.solana.com/tx/${payment.signature}?cluster=devnet\n`);
    
    // Cleanup info
    console.log('💡 Test accounts (save these if you want to reuse):');
    console.log(`  Buyer: ${accounts.buyerKeypair.publicKey.toBase58()}`);
    console.log(`  Seller: ${accounts.sellerKeypair.publicKey.toBase58()}`);
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    process.exit(1);
  }
}

// Run test if called directly
if (require.main === module) {
  runE2ETest()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { runE2ETest };
