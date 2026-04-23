import { AsyncLocalStorage } from 'async_hooks';

interface RequestContext {
  requestId?: string;
  orgId?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

function getContext(): RequestContext {
  return asyncLocalStorage.getStore() || {};
}

function formatMessage(level: string, args: any[]): [string, ...any[]] {
  const ctx = getContext();
  const ts = new Date().toISOString();
  const prefix: Record<string, string> = {};
  prefix.level = level;
  prefix.time = ts;
  if (ctx.requestId) prefix.requestId = ctx.requestId;
  if (ctx.orgId) prefix.orgId = ctx.orgId;

  if (process.env.LOG_FORMAT === 'json') {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    return [JSON.stringify({ ...prefix, msg })];
  }

  const tag = ctx.requestId ? `[${ctx.requestId}]` : '';
  return [`${ts} [${level}]${tag}`, ...args];
}

export const logger = {
  info: (...args: any[]) => console.log(...formatMessage('INFO', args)),
  error: (...args: any[]) => console.error(...formatMessage('ERROR', args)),
  warn: (...args: any[]) => console.warn(...formatMessage('WARN', args)),
  debug: (...args: any[]) => {
    if (process.env.LOG_LEVEL === 'debug') console.debug(...formatMessage('DEBUG', args));
  },
};

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return asyncLocalStorage.run(ctx, fn);
}

export { asyncLocalStorage, type RequestContext };
