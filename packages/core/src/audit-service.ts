import { randomUUID } from 'crypto';

export type AuditEventType =
  | 'escrow.created'
  | 'escrow.funded'
  | 'escrow.released'
  | 'escrow.refunded'
  | 'escrow.expired'
  | 'escrow.deposit.confirmed'
  | 'escrow.deposit.failed'
  | 'escrow.settlement.completed'
  | 'payment.x402_challenge'
  | 'payment.x402_settled'
  | 'payment.x402_failed'
  | 'policy.checked'
  | 'policy.violated'
  | 'policy.created'
  | 'policy.updated'
  | 'policy.deleted'
  | 'wallet.created'
  | 'wallet.funded'
  | 'wallet.transfer'
  | 'firecrawl.scrape'
  | 'firecrawl.search'
  | 'firecrawl.x402.payment'
  | 'user.login'
  | 'user.created'
  | 'chat.message';

export interface AuditEntry {
  id: string;
  timestamp: string;
  eventType: AuditEventType;
  actor: string;
  actorType: 'user' | 'agent' | 'system';
  resource: string;
  resourceId?: string;
  action: string;
  outcome: 'success' | 'failure' | 'pending';
  details: Record<string, unknown>;
  ipAddress?: string;
  correlationId?: string;
}

export interface AuditQuery {
  eventType?: AuditEventType;
  actor?: string;
  resource?: string;
  outcome?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
  correlationId?: string;
}

/**
 * Comprehensive audit trail service for all platform operations.
 * Every payment, policy check, escrow action, and web crawl is logged
 * with full traceability for compliance and debugging.
 */
export class AuditService {
  private entries: AuditEntry[] = [];

  log(params: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    const entry: AuditEntry = {
      id: `aud_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      timestamp: new Date().toISOString(),
      ...params,
    };

    this.entries.push(entry);

    const icon = entry.outcome === 'success' ? '\u2705' : entry.outcome === 'failure' ? '\u274c' : '\u23f3';
    console.log(
      `[Audit] ${icon} ${entry.eventType} | ${entry.actor} -> ${entry.resource}${
        entry.resourceId ? `#${entry.resourceId}` : ''
      } | ${entry.action} (${entry.outcome})`
    );

    return entry;
  }

  query(filters: AuditQuery): { entries: AuditEntry[]; total: number } {
    let results = [...this.entries];

    if (filters.eventType) {
      results = results.filter(e => e.eventType === filters.eventType);
    }
    if (filters.actor) {
      results = results.filter(e => e.actor === filters.actor);
    }
    if (filters.resource) {
      results = results.filter(e => e.resource === filters.resource);
    }
    if (filters.outcome) {
      results = results.filter(e => e.outcome === filters.outcome);
    }
    if (filters.correlationId) {
      results = results.filter(e => e.correlationId === filters.correlationId);
    }
    if (filters.since) {
      const since = new Date(filters.since);
      results = results.filter(e => new Date(e.timestamp) >= since);
    }
    if (filters.until) {
      const until = new Date(filters.until);
      results = results.filter(e => new Date(e.timestamp) <= until);
    }

    const total = results.length;
    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const offset = filters.offset || 0;
    const limit = filters.limit || 50;
    results = results.slice(offset, offset + limit);

    return { entries: results, total };
  }

  getEntry(id: string): AuditEntry | null {
    return this.entries.find(e => e.id === id) || null;
  }

  getStats(): {
    totalEntries: number;
    byEventType: Record<string, number>;
    byOutcome: Record<string, number>;
    last24h: number;
    lastHour: number;
  } {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60_000;
    const hourAgo = now - 60 * 60_000;

    const byEventType: Record<string, number> = {};
    const byOutcome: Record<string, number> = {};
    let last24h = 0;
    let lastHour = 0;

    for (const e of this.entries) {
      byEventType[e.eventType] = (byEventType[e.eventType] || 0) + 1;
      byOutcome[e.outcome] = (byOutcome[e.outcome] || 0) + 1;
      const ts = new Date(e.timestamp).getTime();
      if (ts >= dayAgo) last24h++;
      if (ts >= hourAgo) lastHour++;
    }

    return {
      totalEntries: this.entries.length,
      byEventType,
      byOutcome,
      last24h,
      lastHour,
    };
  }

  getTransactionTrace(correlationId: string): AuditEntry[] {
    return this.entries
      .filter(e => e.correlationId === correlationId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }
}
