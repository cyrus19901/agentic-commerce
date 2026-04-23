import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { ZodError } from 'zod';

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  INVALID_API_KEY: 'INVALID_API_KEY',
  API_KEY_DISABLED: 'API_KEY_DISABLED',
  API_KEY_EXPIRED: 'API_KEY_EXPIRED',
  ORG_INACTIVE: 'ORG_INACTIVE',
  INSUFFICIENT_SCOPE: 'INSUFFICIENT_SCOPE',
  POLICY_REJECTED: 'POLICY_REJECTED',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  TX_VERIFICATION_FAILED: 'TX_VERIFICATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string) || `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  (req as any).requestId = id;
  next();
}

export function attachRequestId(_req: Request, res: Response, next: NextFunction): void {
  const original = res.json.bind(res);
  res.json = function (body: any) {
    res.setHeader('X-Request-ID', (_req as any).requestId || '');
    return original(body);
  };
  next();
}

export function globalErrorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req as any).requestId || '';

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        request_id: requestId,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Request validation failed',
        details: { issues: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        request_id: requestId,
      },
    });
    return;
  }

  console.error(`[${requestId}] Unhandled error:`, err);
  res.status(500).json({
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
      request_id: requestId,
    },
  });
}
