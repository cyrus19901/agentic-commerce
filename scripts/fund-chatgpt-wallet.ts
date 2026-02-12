/**
 * Fund ChatGPT Wallet with USDC for Testing
 * Mints test USDC directly to the user's wallet
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createMintToInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
} from '@solana/spl-token';

const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com';
const USDC_DEVNET_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');
const CHATGPT_WALLET = new PublicKey('HSfxEbPGRqHECxbUvFptSjvKnu3o8Z6njDF3akTLWd8S');

async function fundWallet() {
  console.log('💰 Funding ChatGPT Wallet with Test USDC\n');
  
  const connection = new Connection(SOLANA_DEVNET_RPC, 'confirmed');
  
  // Get token account
  const tokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, CHATGPT_WALLET);
  console.log(`Wallet: ${CHATGPT_WALLET.toBase58()}`);
  console.log(`Token Account: ${tokenAccount.toBase58()}\n`);
  
  // Check if account exists
  console.log('📊 Checking account status...');
  try {
    const accountInfo = await getAccount(connection, tokenAccount);
    console.log(`  ✅ Token account exists`);
    console.log(`  Current balance: ${accountInfo.amount} lamports\n`);
  } catch (error) {
    console.log(`  ⚠️  Token account does not exist\n`);
  }
  
  // Check mint info
  console.log('🔍 Checking USDC mint info...');
  try {
    const mintInfo = await getMint(connection, USDC_DEVNET_MINT);
    console.log(`  Mint: ${USDC_DEVNET_MINT.toBase58()}`);
    console.log(`  Decimals: ${mintInfo.decimals}`);
    console.log(`  Mint Authority: ${mintInfo.mintAuthority?.toBase58() || 'None'}`);
    
    if (!mintInfo.mintAuthority) {
      console.log('\n❌ ERROR: This mint has no mint authority!');
      console.log('   Cannot mint new tokens to this mint.');
      console.log('\n📝 You need to fund this manually:');
      console.log(`   1. Get SOL: solana airdrop 1 ${CHATGPT_WALLET.toBase58()} --url devnet`);
      console.log(`   2. Get USDC from a faucet that supports this mint`);
      console.log(`   3. Or transfer from another wallet that has USDC\n`);
      return;
    }
    
    console.log('\n✅ Mint has authority - can mint tokens!');
    console.log('   (This would require the mint authority keypair)');
    
  } catch (error: any) {
    console.log(`  ❌ Error checking mint: ${error.message}\n`);
  }
  
  console.log('\n📋 Manual Funding Instructions:');
  console.log('   Since this is a devnet test mint, you need to:');
  console.log(`   1. Transfer USDC from a funded test wallet`);
  console.log(`   2. Or find a faucet that supports this specific USDC mint`);
  console.log(`\n   spl-token transfer Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr 100 ${tokenAccount.toBase58()} --url devnet --fund-recipient`);
}

fundWallet().catch(console.error);
