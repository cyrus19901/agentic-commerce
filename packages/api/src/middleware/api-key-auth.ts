import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { DB } from '@agentic-commerce/database';
import { ERROR_CODES } from './error-handler';

export interface OrgContext {
  orgId: string;
  orgName: string;
  apiKeyId: string;
  apiKeyName: string;
  scopes: string[];
}

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function createApiKeyAuth(db: DB) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const headerKey = req.headers['x-api-key'] as string | undefined;
    const bearerKey = req.headers.authorization?.startsWith('Bearer ak_')
      ? req.headers.authorization.slice(7)
      : undefined;
    const raw = headerKey || bearerKey;

    if (!raw) {
      res.status(401).json({
        error: { code: ERROR_CODES.AUTHENTICATION_REQUIRED, message: 'Missing API key. Use X-API-Key header or Authorization: Bearer ak_...' },
      });
      return;
    }

    const keyHash = hashApiKey(raw);

    try {
      const row = await db.pool.query(
        `SELECT k.id, k.org_id, k.name AS key_name, k.scopes, k.rate_limit, k.enabled, k.expires_at,
                o.name AS org_name, o.status AS org_status
         FROM api_keys k
         JOIN organizations o ON o.id = k.org_id
         WHERE k.key_hash = $1`,
        [keyHash],
      );

      const key = row.rows[0];
      if (!key) {
        res.status(401).json({ error: { code: ERROR_CODES.INVALID_API_KEY, message: 'Invalid API key' } });
        return;
      }
      if (!key.enabled) {
        res.status(403).json({ error: { code: ERROR_CODES.API_KEY_DISABLED, message: 'API key is disabled' } });
        return;
      }
      if (key.expires_at && new Date(key.expires_at) < new Date()) {
        res.status(403).json({ error: { code: ERROR_CODES.API_KEY_EXPIRED, message: 'API key has expired' } });
        return;
      }
      if (key.org_status !== 'active') {
        res.status(403).json({ error: { code: ERROR_CODES.ORG_INACTIVE, message: 'Organization is not active' } });
        return;
      }

      req.org = {
        orgId: key.org_id,
        orgName: key.org_name,
        apiKeyId: key.id,
        apiKeyName: key.key_name,
        scopes: JSON.parse(key.scopes || '["*"]'),
      };

      db.pool.query('UPDATE api_keys SET last_used_at = $1 WHERE id = $2', [new Date(), key.id]).catch(() => {});

      next();
    } catch (err: any) {
      console.error('[ApiKeyAuth] Error:', err.message);
      res.status(500).json({ error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'Authentication error' } });
    }
  };
}

export function requireScope(...requiredScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const org = req.org;
    if (!org) {
      res.status(401).json({
        error: { code: ERROR_CODES.AUTHENTICATION_REQUIRED, message: 'Authentication required' },
      });
      return;
    }

    if (org.scopes.includes('*')) {
      return next();
    }

    const hasScope = requiredScopes.some(scope => {
      if (org.scopes.includes(scope)) return true;
      const [resource] = scope.split(':');
      return org.scopes.includes(`${resource}:*`);
    });

    if (!hasScope) {
      res.status(403).json({
        error: {
          code: ERROR_CODES.INSUFFICIENT_SCOPE,
          message: `Insufficient scope. Required: ${requiredScopes.join(' or ')}`,
          details: { required: requiredScopes, granted: org.scopes },
        },
      });
      return;
    }

    next();
  };
}

export function generateApiKey(mode: 'live' | 'test' = 'live'): string {
  const bytes = require('crypto').randomBytes(24);
  return `ak_${mode}_${bytes.toString('base64url')}`;
}

export function isTestKey(raw: string): boolean {
  return raw.startsWith('ak_test_');
}

export { hashApiKey };
