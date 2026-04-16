import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import { randomBytes } from 'crypto';
import { getRpcUrl } from './x402-protocol';

// Lazy-evaluated to ensure dotenv has loaded before we read process.env
let _escrowProgramId: PublicKey | null = null;
let _usdcMint: PublicKey | null = null;

function getEscrowProgramId(): PublicKey {
  if (!_escrowProgramId) {
    _escrowProgramId = new PublicKey(
      process.env.ESCROW_PROGRAM_ID || '5k5ZZHiar9aheemskLMc54Jx5niwKLmKMNySunsCyj9F'
    );
  }
  return _escrowProgramId;
}

function getUsdcMint(): PublicKey {
  if (!_usdcMint) {
    const isDevnet = (process.env.SOLANA_CLUSTER || '').includes('devnet');
    const mintAddr = isDevnet
      ? (process.env.USDC_MINT_DEVNET || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr')
      : (process.env.USDC_MINT_MAINNET || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    _usdcMint = new PublicKey(mintAddr);
    console.log(`[EscrowProgramClient] USDC mint: ${mintAddr} (${isDevnet ? 'devnet' : 'mainnet'})`);
  }
  return _usdcMint;
}

const USDC_DECIMALS = 6;

const DISCRIMINATORS = {
  initializeEscrow: Buffer.from([243, 160, 77, 153, 11, 92, 48, 209]),
  deposit: Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]),
  release: Buffer.from([253, 249, 15, 206, 28, 127, 193, 241]),
  refund: Buffer.from([2, 96, 183, 251, 63, 208, 46, 46]),
  cancel: Buffer.from([232, 219, 223, 41, 219, 236, 220, 190]),
};

export interface EscrowOnChainState {
  payer: string;
  payee: string;
  authority: string;
  mint: string;
  amount: number;
  escrowTokenAccount: string;
  status: string;
  createdAt: number;
  expiresAt: number;
  fundedAt: number;
  settledAt: number;
  nonce: string;
  bump: number;
}

export interface InitializeEscrowParams {
  payerWallet: PublicKey;
  payeeWallet: PublicKey;
  authorityWallet: PublicKey;
  amountUsdc: number;
  expiresInMinutes?: number;
}

export interface InitializeEscrowResult {
  escrowPda: string;
  escrowTokenAccount: string;
  nonce: string;
  transaction: string;
  amount: number;
  amountLamports: string;
  expiresAt: number;
}

export interface DepositResult {
  transaction: string;
  escrowPda: string;
  amount: number;
}

export class EscrowProgramClient {
  private connection: Connection;
  private networkId: string;
  private commitment: 'confirmed' | 'finalized';
  private maxRetries: number;

  constructor(networkId?: string) {
    this.networkId = networkId || process.env.SOLANA_CLUSTER || 'solana:mainnet-beta';
    const rpcUrl = process.env.SOLANA_RPC_MAINNET || getRpcUrl(this.networkId);
    this.commitment = (process.env.SOLANA_COMMITMENT as 'confirmed' | 'finalized') || 'finalized';
    this.maxRetries = parseInt(process.env.SOLANA_MAX_RETRIES || '3', 10);
    this.connection = new Connection(rpcUrl, {
      commitment: this.commitment,
      confirmTransactionInitialTimeout: 60000,
    });
  }

  private async withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const isRetryable =
          err.message?.includes('blockhash') ||
          err.message?.includes('timeout') ||
          err.message?.includes('429') ||
          err.message?.includes('503');
        if (!isRetryable || attempt === this.maxRetries) throw err;
        const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw lastError || new Error(`${label} failed after ${this.maxRetries} retries`);
  }

  private deriveEscrowPda(payer: PublicKey, nonce: Buffer): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), payer.toBuffer(), nonce],
      getEscrowProgramId()
    );
  }

  async initializeEscrow(
    params: InitializeEscrowParams,
    authorityKeypair: Keypair
  ): Promise<InitializeEscrowResult> {
    const nonce = randomBytes(32);
    const amountLamports = BigInt(Math.round(params.amountUsdc * 10 ** USDC_DECIMALS));
    const expiresAt = Math.floor(Date.now() / 1000) + (params.expiresInMinutes || 60) * 60;

    const [escrowPda, _bump] = this.deriveEscrowPda(params.payerWallet, nonce);

    const escrowTokenAccountKeypair = Keypair.generate();

    const data = Buffer.alloc(8 + 8 + 8 + 32);
    DISCRIMINATORS.initializeEscrow.copy(data, 0);
    data.writeBigUInt64LE(amountLamports, 8);
    data.writeBigInt64LE(BigInt(expiresAt), 16);
    nonce.copy(data, 24);

    const ix = new TransactionInstruction({
      programId: getEscrowProgramId(),
      keys: [
        { pubkey: escrowPda, isSigner: false, isWritable: true },
        { pubkey: escrowTokenAccountKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: getUsdcMint(), isSigner: false, isWritable: false },
        { pubkey: params.payerWallet, isSigner: true, isWritable: true },
        { pubkey: params.payeeWallet, isSigner: false, isWritable: false },
        { pubkey: params.authorityWallet, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = params.payerWallet;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('finalized')).blockhash;
    tx.partialSign(escrowTokenAccountKeypair);

    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

    return {
      escrowPda: escrowPda.toBase58(),
      escrowTokenAccount: escrowTokenAccountKeypair.publicKey.toBase58(),
      nonce: nonce.toString('hex'),
      transaction: serialized,
      amount: params.amountUsdc,
      amountLamports: amountLamports.toString(),
      expiresAt,
    };
  }

  async buildDepositTransaction(
    escrowPda: string,
    payerWallet: string,
    payerTokenAccount?: string
  ): Promise<DepositResult> {
    const escrowPubkey = new PublicKey(escrowPda);
    const payerPubkey = new PublicKey(payerWallet);

    const escrowData = await this.getEscrowState(escrowPda);
    if (!escrowData) throw new Error(`Escrow ${escrowPda} not found on-chain`);
    if (escrowData.status !== 'Created') throw new Error(`Escrow status is ${escrowData.status}, expected Created`);

    const payerAta = payerTokenAccount
      ? new PublicKey(payerTokenAccount)
      : await getAssociatedTokenAddress(getUsdcMint(), payerPubkey);

    const ix = new TransactionInstruction({
      programId: getEscrowProgramId(),
      keys: [
        { pubkey: escrowPubkey, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(escrowData.escrowTokenAccount), isSigner: false, isWritable: true },
        { pubkey: payerAta, isSigner: false, isWritable: true },
        { pubkey: payerPubkey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: DISCRIMINATORS.deposit,
    });

    const tx = new Transaction();
    const ataInfo = await this.connection.getAccountInfo(payerAta);
    if (!ataInfo) {
      tx.add(createAssociatedTokenAccountInstruction(payerPubkey, payerAta, payerPubkey, getUsdcMint()));
    }
    tx.add(ix);
    tx.feePayer = payerPubkey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('finalized')).blockhash;

    return {
      transaction: tx.serialize({ requireAllSignatures: false }).toString('base64'),
      escrowPda,
      amount: escrowData.amount,
    };
  }

  async release(escrowPda: string, authorityKeypair: Keypair): Promise<string> {
    const escrowPubkey = new PublicKey(escrowPda);
    const escrowData = await this.getEscrowState(escrowPda);
    if (!escrowData) throw new Error(`Escrow ${escrowPda} not found`);
    if (escrowData.status !== 'Funded') throw new Error(`Escrow status is ${escrowData.status}, expected Funded`);

    const payeeAta = await getAssociatedTokenAddress(
      getUsdcMint(),
      new PublicKey(escrowData.payee)
    );

    const tx = new Transaction();
    const ataInfo = await this.connection.getAccountInfo(payeeAta);
    if (!ataInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          authorityKeypair.publicKey,
          payeeAta,
          new PublicKey(escrowData.payee),
          getUsdcMint()
        )
      );
    }

    tx.add(
      new TransactionInstruction({
        programId: getEscrowProgramId(),
        keys: [
          { pubkey: escrowPubkey, isSigner: false, isWritable: true },
          { pubkey: new PublicKey(escrowData.escrowTokenAccount), isSigner: false, isWritable: true },
          { pubkey: payeeAta, isSigner: false, isWritable: true },
          { pubkey: authorityKeypair.publicKey, isSigner: true, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: DISCRIMINATORS.release,
      })
    );

    tx.feePayer = authorityKeypair.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('finalized')).blockhash;
    tx.sign(authorityKeypair);

    const sig = await this.withRetry(
      () => this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: this.commitment,
      }),
      'release'
    );

    await this.connection.confirmTransaction(sig, this.commitment);
    return sig;
  }

  async refund(escrowPda: string, authorityKeypair: Keypair): Promise<string> {
    const escrowPubkey = new PublicKey(escrowPda);
    const escrowData = await this.getEscrowState(escrowPda);
    if (!escrowData) throw new Error(`Escrow ${escrowPda} not found`);

    const payerAta = await getAssociatedTokenAddress(
      getUsdcMint(),
      new PublicKey(escrowData.payer)
    );

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: getEscrowProgramId(),
        keys: [
          { pubkey: escrowPubkey, isSigner: false, isWritable: true },
          { pubkey: new PublicKey(escrowData.escrowTokenAccount), isSigner: false, isWritable: true },
          { pubkey: payerAta, isSigner: false, isWritable: true },
          { pubkey: authorityKeypair.publicKey, isSigner: true, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: DISCRIMINATORS.refund,
      })
    );

    tx.feePayer = authorityKeypair.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('finalized')).blockhash;
    tx.sign(authorityKeypair);

    const sig = await this.withRetry(
      () => this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: this.commitment,
      }),
      'refund'
    );

    await this.connection.confirmTransaction(sig, this.commitment);
    return sig;
  }

  async checkExpiredEscrows(escrowPdas: string[]): Promise<string[]> {
    const now = Math.floor(Date.now() / 1000);
    const expired: string[] = [];
    for (const pda of escrowPdas) {
      try {
        const state = await this.getEscrowState(pda);
        if (state && state.status === 'Created' && state.expiresAt < now) {
          expired.push(pda);
        }
      } catch {}
    }
    return expired;
  }

  async getEscrowState(escrowPda: string): Promise<EscrowOnChainState | null> {
    const pubkey = new PublicKey(escrowPda);
    const info = await this.connection.getAccountInfo(pubkey);
    if (!info || !info.data) return null;

    const data = info.data;
    if (data.length < 8 + 32 * 5 + 8 + 1 + 8 * 4 + 64 * 2 + 32 + 1) return null;

    let offset = 8; // discriminator
    const payer = new PublicKey(data.subarray(offset, offset + 32)).toBase58(); offset += 32;
    const payee = new PublicKey(data.subarray(offset, offset + 32)).toBase58(); offset += 32;
    const authority = new PublicKey(data.subarray(offset, offset + 32)).toBase58(); offset += 32;
    const mint = new PublicKey(data.subarray(offset, offset + 32)).toBase58(); offset += 32;
    const amountRaw = data.readBigUInt64LE(offset); offset += 8;
    const escrowTokenAccount = new PublicKey(data.subarray(offset, offset + 32)).toBase58(); offset += 32;
    const statusByte = data[offset]; offset += 1;
    const createdAt = Number(data.readBigInt64LE(offset)); offset += 8;
    const expiresAt = Number(data.readBigInt64LE(offset)); offset += 8;
    const fundedAt = Number(data.readBigInt64LE(offset)); offset += 8;
    const settledAt = Number(data.readBigInt64LE(offset)); offset += 8;
    offset += 64; // deposit_signature
    offset += 64; // settle_signature
    const nonceBytes = data.subarray(offset, offset + 32); offset += 32;
    const bump = data[offset];

    const statusMap: Record<number, string> = {
      0: 'Created', 1: 'Funded', 2: 'Released', 3: 'Refunded', 4: 'Cancelled', 5: 'Expired',
    };

    return {
      payer,
      payee,
      authority,
      mint,
      amount: Number(amountRaw) / 10 ** USDC_DECIMALS,
      escrowTokenAccount,
      status: statusMap[statusByte] || 'Unknown',
      createdAt,
      expiresAt,
      fundedAt,
      settledAt,
      nonce: Buffer.from(nonceBytes).toString('hex'),
      bump,
    };
  }

  getExplorerUrl(signature: string): string {
    const cluster = this.networkId.includes('devnet') ? '?cluster=devnet' : '';
    return `https://solana.fm/tx/${signature}${cluster}`;
  }

  getAddressExplorerUrl(address: string): string {
    const cluster = this.networkId.includes('devnet') ? '?cluster=devnet' : '';
    return `https://solana.fm/address/${address}${cluster}`;
  }

  getProgramId(): string {
    return getEscrowProgramId().toBase58();
  }
}
