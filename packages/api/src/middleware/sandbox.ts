import { Request, Response, NextFunction } from 'express';

export interface SandboxContext {
  isSandbox: boolean;
}

declare global {
  namespace Express {
    interface Request {
      sandbox?: SandboxContext;
    }
  }
}

export function detectSandbox(req: Request, _res: Response, next: NextFunction): void {
  const apiKey = (req.headers['x-api-key'] as string) ||
    (req.headers.authorization?.startsWith('Bearer ak_') ? req.headers.authorization.slice(7) : '');

  const isSandbox = apiKey.startsWith('ak_test_') || req.body?.sandbox === true;
  req.sandbox = { isSandbox };
  next();
}

export const SANDBOX_ORG_ID = 'org-sandbox-000';
export const SANDBOX_TREASURY_BALANCE = 1000.00;

export function mockProviderResponse(provider: string, action: string, params: Record<string, unknown>) {
  return {
    success: true,
    data: {
      sandbox: true,
      provider,
      action,
      url: params.url || 'https://example.com',
      content: `[SANDBOX] Mock ${action} result from ${provider}. In production, this would contain real scraped data from ${params.url || 'the target URL'}.`,
      statusCode: 200,
    },
    baseTxHash: `0x${'0'.repeat(64)}`,
    paymentAmount: '0.01',
    agentWallet: '0x0000000000000000000000000000000000000000',
  };
}
