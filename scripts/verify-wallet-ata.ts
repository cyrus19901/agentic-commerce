#!/usr/bin/env npx tsx
/**
 * Verify USDC ATA derivation and balance for a wallet.
 * Usage: npx tsx scripts/verify-wallet-ata.ts <WALLET_PUBKEY>
 * Example: npx tsx scripts/verify-wallet-ata.ts DwyfYM4BUwJmz9yBF4s6ojGUf8xcbtkpso3ApJpduS2q
 */

import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { Connection } from '@solana/web3.js';

const USDC_DEVNET_MINT = process.env.USDC_MINT_DEVNET || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';
const RPC = process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com';

async function main() {
  const walletPubkeyStr = process.argv[2];
  if (!walletPubkeyStr) {
    console.error('Usage: npx tsx scripts/verify-wallet-ata.ts <WALLET_PUBKEY>');
    process.exit(1);
  }

  const walletPubkey = new PublicKey(walletPubkeyStr);
  const mint = new PublicKey(USDC_DEVNET_MINT);
  const ata = await getAssociatedTokenAddress(mint, walletPubkey, false);

  console.log('Wallet (owner):', walletPubkey.toBase58());
  console.log('USDC mint (devnet):', USDC_DEVNET_MINT);
  console.log('Derived USDC ATA: ', ata.toBase58());
  console.log('');

  const connection = new Connection(RPC, 'confirmed');
  const solBalance = await connection.getBalance(walletPubkey);
  console.log('SOL balance:', solBalance / 1e9, 'SOL');

  try {
    const tokenBalance = await connection.getTokenAccountBalance(ata);
    console.log('USDC balance:', tokenBalance.value.uiAmount ?? 0, 'USDC (raw:', tokenBalance.value.amount, ')');
  } catch (e: any) {
    if (e.message?.includes('could not find account')) {
      console.log('USDC balance: (token account not created yet)');
    } else {
      console.error('USDC balance error:', e.message);
    }
  }

  console.log('\nOn Solscan, the token account', ata.toBase58(), 'should show Owner =', walletPubkey.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
