import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { Keypair } from '@solana/web3.js';

export type TreasurySignerMaterial = {
  address: string;
  secretKey: Uint8Array;
};

export interface TreasuryCustodyProvider {
  encryptSecretKey(secret: Uint8Array): string;
  decryptSecretKey(ciphertext: string): Uint8Array;
  loadSignerFromCiphertext(address: string, ciphertext: string): TreasurySignerMaterial;
}

function keyFromEnv(): Buffer {
  const raw = process.env.TREASURY_KMS_MOCK_KEY || process.env.PROVIDER_SECRET_KEY || 'dev-only-treasury-key';
  return createHash('sha256').update(raw).digest();
}

function encryptAesGcm(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromEnv(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptAesGcm(blob: string): string {
  const [ivB64, tagB64, dataB64] = String(blob || '').split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', keyFromEnv(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const out = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return out.toString('utf8');
}

export class EnvWrappedTreasuryCustody implements TreasuryCustodyProvider {
  encryptSecretKey(secret: Uint8Array): string {
    return `enc:v1:${encryptAesGcm(Buffer.from(secret).toString('base64'))}`;
  }

  decryptSecretKey(ciphertext: string): Uint8Array {
    if (!ciphertext?.startsWith('enc:v1:')) {
      // Backward compatibility for plain base64 in local/dev only.
      return Uint8Array.from(Buffer.from(ciphertext, 'base64'));
    }
    const raw = decryptAesGcm(ciphertext.substring('enc:v1:'.length));
    return Uint8Array.from(Buffer.from(raw, 'base64'));
  }

  loadSignerFromCiphertext(address: string, ciphertext: string): TreasurySignerMaterial {
    const secret = this.decryptSecretKey(ciphertext);
    const kp = Keypair.fromSecretKey(secret);
    if (kp.publicKey.toBase58() !== address) {
      throw new Error('Treasury wallet address mismatch with decrypted signer key');
    }
    return { address, secretKey: secret };
  }
}

export function getTreasuryCustodyProvider(): TreasuryCustodyProvider {
  // KMS-ready seam: swap this provider with a real KMS adapter.
  return new EnvWrappedTreasuryCustody();
}

