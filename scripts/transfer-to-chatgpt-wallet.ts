/**
 * Transfer USDC from E2E test buyer to ChatGPT wallet
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import fs from 'fs';
import path from 'path';

const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com';
const USDC_DEVNET_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');
const CHATGPT_WALLET = new PublicKey('HSfxEbPGRqHECxbUvFptSjvKnu3o8Z6njDF3akTLWd8S');
const TRANSFER_AMOUNT = 50_000_000; // 50 USDC (6 decimals)

async function transfer() {
  console.log('💸 Transferring USDC to ChatGPT Wallet\n');
  
  const connection = new Connection(SOLANA_DEVNET_RPC, 'confirmed');
  
  // Load E2E buyer keypair
  const keypairsPath = path.join(__dirname, '..', 'tests', 'e2e', 'keypairs.json');
  if (!fs.existsSync(keypairsPath)) {
    console.log('❌ E2E keypairs not found. Run the E2E test first to generate them.');
    process.exit(1);
  }
  
  const keypairs = JSON.parse(fs.readFileSync(keypairsPath, 'utf-8'));
  const buyerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairs.buyer));
  
  console.log(`From: ${buyerKeypair.publicKey.toBase58()}`);
  console.log(`To:   ${CHATGPT_WALLET.toBase58()}\n`);
  
  // Get token accounts
  const buyerTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, buyerKeypair.publicKey);
  const chatgptTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, CHATGPT_WALLET);
  
  console.log(`From Token Account: ${buyerTokenAccount.toBase58()}`);
  console.log(`To Token Account:   ${chatgptTokenAccount.toBase58()}\n`);
  
  // Check buyer balance
  console.log('💰 Checking balances...');
  let buyerBalance = 0;
  try {
    const buyerAccount = await getAccount(connection, buyerTokenAccount);
    buyerBalance = Number(buyerAccount.amount);
    console.log(`  Buyer USDC: ${buyerBalance / 1_000_000} USDC`);
  } catch (error) {
    console.log('  ❌ Buyer has no USDC token account!');
    console.log('     Run the E2E test and fund it first.');
    process.exit(1);
  }
  
  if (buyerBalance < TRANSFER_AMOUNT) {
    console.log(`  ❌ Insufficient funds. Need ${TRANSFER_AMOUNT / 1_000_000} USDC, have ${buyerBalance / 1_000_000}`);
    process.exit(1);
  }
  
  // Create transaction
  console.log('\n📝 Creating transfer transaction...');
  const transaction = new Transaction();
  
  // Create recipient token account if needed
  try {
    await getAccount(connection, chatgptTokenAccount);
    console.log('  ✓ Recipient token account exists');
  } catch (error) {
    console.log('  Creating recipient token account...');
    transaction.add(
      createAssociatedTokenAccountInstruction(
        buyerKeypair.publicKey,
        chatgptTokenAccount,
        CHATGPT_WALLET,
        USDC_DEVNET_MINT
      )
    );
  }
  
  // Add transfer instruction
  transaction.add(
    createTransferInstruction(
      buyerTokenAccount,
      chatgptTokenAccount,
      buyerKeypair.publicKey,
      TRANSFER_AMOUNT
    )
  );
  
  // Send transaction
  console.log(`\n💸 Transferring ${TRANSFER_AMOUNT / 1_000_000} USDC...`);
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [buyerKeypair],
    { commitment: 'confirmed' }
  );
  
  console.log('\n✅ Transfer successful!');
  console.log(`   Signature: ${signature}`);
  console.log(`   Explorer: https://solscan.io/tx/${signature}?cluster=devnet`);
  console.log(`\n🎉 ChatGPT wallet now has USDC! Ready to test agent-to-agent transactions.\n`);
}

transfer().catch(console.error);
