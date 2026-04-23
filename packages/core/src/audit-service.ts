import { randomUUID } from 'crypto';
import type { DB } from '@agentic-commerce/database';

export type AuditEventType =
  | 'escrow.created'
  | 'escrow.funded'
  | 'escrow.released'
  | 'escrow.refunded'
  | 'escrow.expired'
  | 'escrow.deposit.confirmed'
  | 'escrow.deposit.failed'
  | 'escrow.settlement.completed'
  | 'payment.initiated'
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
  orgId?: string;
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
  orgId?: string;
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

export class AuditService {
  private db: DB | null = null;

  setDB(db: DB): void {
    this.db = db;
  }

  async log(params: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry> {
    const entry: AuditEntry = {
      id: `aud_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      timestamp: new Date().toISOString(),
      ...params,
    };

    const icon = entry.outcome === 'success' ? '\u2705' : entry.outcome === 'failure' ? '\u274c' : '\u23f3';
    console.log(
      `[Audit] ${icon} ${entry.eventType} | ${entry.actor} -> ${entry.resource}${
        entry.resourceId ? `#${entry.resourceId}` : ''
      } | ${entry.action} (${entry.outcome})`
    );

    if (this.db) {
      try {
        await this.db.pool.query(
          `INSERT INTO audit_entries
             (id, org_id, correlation_id, event_type, actor, actor_type, resource, resource_id,
              action, outcome, details, ip_address, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            entry.id, entry.orgId ?? null, entry.correlationId ?? null,
            entry.eventType, entry.actor, entry.actorType,
            entry.resource, entry.resourceId ?? null,
            entry.action, entry.outcome,
            JSON.stringify(entry.details), entry.ipAddress ?? null,
            entry.timestamp,
          ],
        );
      } catch (err: any) {
        console.error('[AuditService] Failed to persist audit entry:', err.message);
      }
    }

    return entry;
  }

  async query(filters: AuditQuery): Promise<{ entries: AuditEntry[]; total: number }> {
    if (!this.db) return { entries: [], total: 0 };

    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (filters.orgId) { conditions.push(`org_id = $${idx++}`); params.push(filters.orgId); }
    if (filters.eventType) { conditions.push(`event_type = $${idx++}`); params.push(filters.eventType); }
    if (filters.actor) { conditions.push(`actor = $${idx++}`); params.push(filters.actor); }
    if (filters.resource) { conditions.push(`resource = $${idx++}`); params.push(filters.resource); }
    if (filters.outcome) { conditions.push(`outcome = $${idx++}`); params.push(filters.outcome); }
    if (filters.correlationId) { conditions.push(`correlation_id = $${idx++}`); params.push(filters.correlationId); }
    if (filters.since) { conditions.push(`created_at >= $${idx++}`); params.push(new Date(filters.since)); }
    if (filters.until) { conditions.push(`created_at <= $${idx++}`); params.push(new Date(filters.until)); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await this.db.pool.query(`SELECT COUNT(*) FROM audit_entries ${where}`, params);
    const total = Number(countRes.rows[0].count);

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    params.push(limit, offset);

    const { rows } = await this.db.pool.query(
      `SELECT * FROM audit_entries ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      params,
    );

    return { entries: rows.map(mapAuditRow), total };
  }

  async getEntry(id: string): Promise<AuditEntry | null> {
    if (!this.db) return null;
    const { rows } = await this.db.pool.query('SELECT * FROM audit_entries WHERE id = $1', [id]);
    return rows[0] ? mapAuditRow(rows[0]) : null;
  }

  async getStats(orgId?: string): Promise<{
    totalEntries: number;
    byEventType: Record<string, number>;
    byOutcome: Record<string, number>;
    last24h: number;
    lastHour: number;
  }> {
    if (!this.db) {
      return { totalEntries: 0, byEventType: {}, byOutcome: {}, last24h: 0, lastHour: 0 };
    }

    const orgFilter = orgId ? 'WHERE org_id = $1' : '';
    const params = orgId ? [orgId] : [];

    const [totalRes, typeRes, outcomeRes, dayRes, hourRes] = await Promise.all([
      this.db.pool.query(`SELECT COUNT(*) FROM audit_entries ${orgFilter}`, params),
      this.db.pool.query(`SELECT event_type, COUNT(*) FROM audit_entries ${orgFilter} GROUP BY event_type`, params),
      this.db.pool.query(`SELECT outcome, COUNT(*) FROM audit_entries ${orgFilter} GROUP BY outcome`, params),
      this.db.pool.query(
        `SELECT COUNT(*) FROM audit_entries ${orgFilter ? orgFilter + ' AND' : 'WHERE'} created_at >= NOW() - INTERVAL '24 hours'`,
        params,
      ),
      this.db.pool.query(
        `SELECT COUNT(*) FROM audit_entries ${orgFilter ? orgFilter + ' AND' : 'WHERE'} created_at >= NOW() - INTERVAL '1 hour'`,
        params,
      ),
    ]);

    const byEventType: Record<string, number> = {};
    for (const r of typeRes.rows) byEventType[r.event_type] = Number(r.count);

    const byOutcome: Record<string, number> = {};
    for (const r of outcomeRes.rows) byOutcome[r.outcome] = Number(r.count);

    return {
      totalEntries: Number(totalRes.rows[0].count),
      byEventType,
      byOutcome,
      last24h: Number(dayRes.rows[0].count),
      lastHour: Number(hourRes.rows[0].count),
    };
  }

  async getTransactionTrace(correlationId: string): Promise<AuditEntry[]> {
    if (!this.db) return [];
    const { rows } = await this.db.pool.query(
      'SELECT * FROM audit_entries WHERE correlation_id = $1 ORDER BY created_at ASC',
      [correlationId],
    );
    return rows.map(mapAuditRow);
  }
}

function mapAuditRow(row: any): AuditEntry {
  return {
    id: row.id,
    timestamp: row.created_at,
    orgId: row.org_id,
    eventType: row.event_type,
    actor: row.actor,
    actorType: row.actor_type,
    resource: row.resource,
    resourceId: row.resource_id,
    action: row.action,
    outcome: row.outcome,
    details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details || {},
    ipAddress: row.ip_address,
    correlationId: row.correlation_id,
  };
}
