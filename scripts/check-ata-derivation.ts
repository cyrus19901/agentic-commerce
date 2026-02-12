#!/usr/bin/env npx tsx
/** Derive ATA for two wallets and compare to known addresses. No RPC. */
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

const MINT = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';
const mint = new PublicKey(MINT);

const walletDwyf = new PublicKey('DwyfYM4BUwJmz9yBF4s6ojGUf8xcbtkpso3ApJpduS2q');
const wallet67  = new PublicKey('67CsvxYp2FmMZTqGPyjcjzCVX1zWouR4kXR7rmLzGKao');
const tokenHc44 = 'Hc44ZLwwfWCWUeb9kgAQby8Jv7xeuiVEEVrWCGps3Pjs';

const ataDwyf = getAssociatedTokenAddressSync(mint, walletDwyf, false);
const ata67   = getAssociatedTokenAddressSync(mint, wallet67, false);

console.log('ATA for DwyfYM4... (app wallet):', ataDwyf.toBase58());
console.log('ATA for 67Csvx... (owner on Solscan):', ata67.toBase58());
console.log('Token account on Solscan (200 USDC):', tokenHc44);
console.log('');
console.log('67Csvx ATA === Hc44ZL?', ata67.toBase58() === tokenHc44);
console.log('DwyfYM4 ATA === 67Csvx?', ataDwyf.toBase58() === wallet67.toBase58());
