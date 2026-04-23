import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

type ProviderLike = Record<string, any>;

function getCryptoKey(): Buffer {
  const raw = process.env.PROVIDER_SECRET_KEY || '';
  if (!raw) throw new Error('PROVIDER_SECRET_KEY is required for provider key encryption');
  // Accept either raw string or base64. Normalize to 32-byte AES key.
  const decoded = /^[A-Za-z0-9+/=]+$/.test(raw) ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8');
  if (decoded.length === 32) return decoded;
  return createHash('sha256').update(raw).digest();
}

export function encryptProviderApiKey(apiKey: string): string {
  const iv = randomBytes(12);
  const key = getCryptoKey();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptProviderApiKey(cipherText: string): string {
  const parts = String(cipherText || '').split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('Unsupported encrypted provider key format');
  }
  const [, , ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const key = getCryptoKey();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

export function secureProviderMetadata(metadata: any): any {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const provider: ProviderLike = metadata.provider;
  if (!provider || typeof provider !== 'object') return metadata;
  const cloned = JSON.parse(JSON.stringify(metadata));
  if (cloned.provider?.apiKey) {
    cloned.provider.apiKeyEncrypted = encryptProviderApiKey(cloned.provider.apiKey);
    delete cloned.provider.apiKey;
  }
  return cloned;
}

export function hydrateProviderSecret(provider: any): any {
  if (!provider || typeof provider !== 'object') return provider;
  const p = { ...provider };
  if (!p.apiKey && p.apiKeyEncrypted) {
    try {
      p.apiKey = decryptProviderApiKey(p.apiKeyEncrypted);
    } catch {
      // Keep encrypted value only; caller handles missing key behavior.
    }
  }
  return p;
}

export function redactProviderSecrets(metadata: any): any {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const cloned = JSON.parse(JSON.stringify(metadata));
  if (cloned.provider?.apiKey) delete cloned.provider.apiKey;
  if (cloned.provider?.apiKeyEncrypted) cloned.provider.apiKeyEncrypted = '[encrypted]';
  return cloned;
}

export function validateProviderSchema(provider: any): string[] {
  const errors: string[] = [];
  if (!provider || typeof provider !== 'object') return errors;
  if (!provider.baseUrl || typeof provider.baseUrl !== 'string') {
    errors.push('provider.baseUrl is required and must be a string');
  } else if (!/^https?:\/\//.test(provider.baseUrl)) {
    errors.push('provider.baseUrl must start with http:// or https://');
  }
  if (provider.executePathTemplate && !String(provider.executePathTemplate).includes('{tool}')) {
    errors.push('provider.executePathTemplate must include {tool}');
  }
  if (provider.pricingPathTemplate && !String(provider.pricingPathTemplate).includes('{tool}')) {
    errors.push('provider.pricingPathTemplate must include {tool}');
  }
  if (provider.toolMap && typeof provider.toolMap !== 'object') {
    errors.push('provider.toolMap must be an object');
  }
  if (provider.pricingStrategy && !['x402', 'metadata', 'none'].includes(provider.pricingStrategy)) {
    errors.push('provider.pricingStrategy must be x402, metadata, or none');
  }
  if (provider.apiKey && typeof provider.apiKey !== 'string') {
    errors.push('provider.apiKey must be a string');
  }
  return errors;
}

