#!/usr/bin/env npx tsx
/**
 * Derive USDC ATA for a wallet and list token accounts returned by RPC.
 * Usage: npx tsx scripts/derive-ata-and-list-token-accounts.ts [WALLET_PUBKEY]
 * Example: npx tsx scripts/derive-ata-and-list-token-accounts.ts DwyfYM4BUwJmz9yBF4s6ojGUf8xcbtkpso3ApJpduS2q
 *
 * Compares: our derived ATA vs token accounts from getParsedTokenAccountsByOwner.
 * If the RPC returns a USDC account at a different address, ATA derivation may be wrong.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

const USDC_DEVNET_MINT = process.env.USDC_MINT_DEVNET || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';
const RPC = process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com';

async function main() {
  const walletStr = process.argv[2] || 'DwyfYM4BUwJmz9yBF4s6ojGUf8xcbtkpso3ApJpduS2q';
  const wallet = new PublicKey(walletStr);
  const mint = new PublicKey(USDC_DEVNET_MINT);

  console.log('Wallet:', wallet.toBase58());
  console.log('USDC mint (devnet):', USDC_DEVNET_MINT);
  console.log('RPC:', RPC);
  console.log('');

  // 1) Derive ATA (same as API): getAssociatedTokenAddress(mint, owner, false); use true if owner is off-curve (e.g. PDA)
  let derivedAsync: import('@solana/web3.js').PublicKey;
  let derivedSync: import('@solana/web3.js').PublicKey;
  let offCurve = false;
  try {
    derivedAsync = await getAssociatedTokenAddress(mint, wallet, false);
    derivedSync = getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  } catch (e: any) {
    if (e?.name === 'TokenOwnerOffCurveError' || e?.message?.includes('OffCurve')) {
      offCurve = true;
      derivedAsync = await getAssociatedTokenAddress(mint, wallet, true);
      derivedSync = getAssociatedTokenAddressSync(mint, wallet, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      console.log('(Owner is off-curve; used allowOwnerOffCurve: true)');
    } else throw e;
  }
  console.log('Derived ATA (async):', derivedAsync.toBase58());
  console.log('Derived ATA (sync): ', derivedSync.toBase58());
  if (!derivedAsync.equals(derivedSync)) {
    console.log('  ⚠ MISMATCH — async and sync derivation differ!');
  }
  const derivedAta = derivedAsync;
  console.log('');

  const connection = new Connection(RPC, 'confirmed');

  // 2) List all token accounts owned by this wallet (what RPC actually has)
  console.log('Token accounts for this wallet (getParsedTokenAccountsByOwner):');
  try {
    const parsed = await connection.getParsedTokenAccountsByOwner(wallet, {
      programId: TOKEN_PROGRAM_ID,
    });
    if (parsed.value.length === 0) {
      console.log('  (none) — RPC has no token accounts for this owner.');
    } else {
      for (const { pubkey, account } of parsed.value) {
        const data = account.data.parsed?.info;
        const mintAddr = data?.mint ?? '?';
        const amount = data?.tokenAmount?.uiAmount ?? data?.tokenAmount?.amount ?? '?';
        const decimals = data?.tokenAmount?.decimals ?? '?';
        const match = pubkey.equals(derivedAta) ? '  <-- matches derived ATA' : '';
        console.log('  ', pubkey.toBase58(), '| mint:', mintAddr, '| amount:', amount, '| decimals:', decimals, match);
      }
    }
  } catch (e: any) {
    console.log('  Error:', e?.message || e);
  }

  console.log('');
  console.log('If Solscan shows a different token account address for this wallet’s USDC,');
  console.log('then either derivation is wrong or the transfer used a non-ATA account.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
