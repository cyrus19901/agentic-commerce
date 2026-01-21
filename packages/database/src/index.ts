// TODO: Uncomment when migrating to PostgreSQL + Prisma
// export { prisma } from './prisma-client.js';
// export { PolicyEngine } from './policy-engine.js';

// Legacy DB class (currently in use with SQLite)
import Database from 'better-sqlite3';
import { Policy } from '@agentic-commerce/shared';

export class DB {
  private db: any;

  constructor(path: string = './data/shopping.db') {
    this.db = new Database(path);
    this.initialize();
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 0,
        conditions TEXT NOT NULL,
        rules TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS purchase_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        amount REAL NOT NULL,
        merchant TEXT NOT NULL,
        category TEXT,
        allowed INTEGER NOT NULL,
        policy_results TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_user_timestamp 
        ON purchase_attempts(user_id, timestamp);
    `);
  }

  async getActivePolicies(userId?: string): Promise<Policy[]> {
    const rows = this.db.prepare('SELECT * FROM policies WHERE enabled = 1 ORDER BY priority DESC').all();
    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      enabled: row.enabled === 1,
      priority: row.priority,
      conditions: JSON.parse(row.conditions),
      rules: JSON.parse(row.rules),
    }));
  }

  async getUserSpending(userId: string, period: 'daily' | 'weekly' | 'monthly'): Promise<number> {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'daily':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'weekly':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    const result = this.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM purchase_attempts
      WHERE user_id = ? AND allowed = 1 AND timestamp >= ?
    `).get(userId, startDate.toISOString());

    return result.total;
  }

  async recordPurchaseAttempt(attempt: any): Promise<void> {
    this.db.prepare(`
      INSERT INTO purchase_attempts 
      (user_id, product_id, amount, merchant, category, allowed, policy_results, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      attempt.userId,
      attempt.productId,
      attempt.amount,
      attempt.merchant,
      attempt.category || null,
      attempt.allowed ? 1 : 0,
      JSON.stringify(attempt.policyCheckResults),
      new Date().toISOString()
    );
  }

  async createPolicy(policy: Policy): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO policies (id, name, type, enabled, priority, conditions, rules, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      policy.id,
      policy.name,
      policy.type,
      policy.enabled ? 1 : 0,
      policy.priority,
      JSON.stringify(policy.conditions),
      JSON.stringify(policy.rules),
      now,
      now
    );
  }
}

export default DB;
