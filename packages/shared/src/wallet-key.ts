/**
 * Normalize a 32-byte secp256k1 private key from env / config.
 * Strips quotes, whitespace, newlines — common causes of OpenSSL
 * `DECODER routines::unsupported` when using viem `privateKeyToAccount`.
 */
export function normalizeHexPrivateKey(raw: string | undefined | null): `0x${string}` | null {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[\r\n\t]/g, '');
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('0x') || s.startsWith('0X')) s = s.slice(2);
  s = s.replace(/\s/g, '');
  if (!/^[a-fA-F0-9]{64}$/.test(s)) return null;
  return (`0x${s.toLowerCase()}`) as `0x${string}`;
}
