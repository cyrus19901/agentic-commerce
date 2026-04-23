import { Pool, PoolClient } from 'pg';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { Policy } from '@agentic-commerce/shared';

// ── Wallet crypto helpers ─────────────────────────────────────────────────────

function getWalletKey(): Buffer {
  const hex = process.env.WALLET_ENCRYPTION_KEY ?? '';
  if (hex.length !== 64) {
    throw new Error('WALLET_ENCRYPTION_KEY must be set to 32 bytes (64 hex chars)');
  }
  return Buffer.from(hex, 'hex');
}

/** AES-256-GCM encrypt. Output: "gcm:<base64(iv|tag|ciphertext)>" */
function encryptWallet(plaintext: string): string {
  const key = getWalletKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'gcm:' + Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/** Decrypt. Falls back to raw base64→utf8 for legacy Solana rows. */
function decryptWallet(stored: string): string {
  if (!stored.startsWith('gcm:')) {
    return Buffer.from(stored, 'base64').toString('utf-8');
  }
  const key = getWalletKey();
  const buf = Buffer.from(stored.slice(4), 'base64');
  const iv  = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString('utf8') + decipher.final('utf8');
}

// ── Wallet record type ────────────────────────────────────────────────────────

export interface UserWalletRecord {
  userId: string;
  /** Primary EVM address (hex, checksum) — used for x402 on Base / EVM chains */
  evmAddress: string;
  evmPrivateKey: string;  // 0x-prefixed hex
  /** Optional Solana keypair preserved for backwards-compat / future use */
  solanaPublicKey?: string;
  solanaSecretKey?: number[];
}

// Convert SQLite-style `?` placeholders to PostgreSQL `$1, $2, ...`
function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export class DB {
  public pool: Pool;

  constructor(connectionString?: string) {
    const dbUrl = connectionString || process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    this.pool = new Pool({
      connectionString: dbUrl,
      ssl: dbUrl.includes('render.com') || dbUrl.includes('neon.tech') || dbUrl.includes('supabase.com')
        ? { rejectUnauthorized: false }
        : undefined,
    });
    console.log('📊 Database pool initialised');
  }

  // ── Query helpers ────────────────────────────────────────────────────────────

  private async all(sql: string, params: any[] = []): Promise<any[]> {
    const { rows } = await this.pool.query(toPg(sql), params);
    return rows;
  }

  private async one(sql: string, params: any[] = []): Promise<any | null> {
    const rows = await this.all(sql, params);
    return rows[0] ?? null;
  }

  private async run(sql: string, params: any[] = []): Promise<{ rowCount: number }> {
    const result = await this.pool.query(toPg(sql), params);
    return { rowCount: result.rowCount ?? 0 };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // ── Policy methods ───────────────────────────────────────────────────────────

  async getActivePolicies(userId?: string): Promise<Policy[]> {
    // If a user has explicit assignments, prefer those.
    if (userId) {
      const userRows = await this.all(
        `SELECT p.*
         FROM policies p
         INNER JOIN user_policies up ON p.id = up.policy_id
         WHERE up.user_id = ? AND p.enabled = true
         ORDER BY p.priority DESC, p.created_at DESC`,
        [userId],
      );
      if (userRows.length > 0) return userRows.map(mapPolicy);
    }

    const rows = await this.all(
      'SELECT * FROM policies WHERE enabled = true ORDER BY priority DESC'
    );
    return rows.map(mapPolicy);
  }

  async getActivePoliciesByOrg(orgId: string): Promise<Policy[]> {
    const rows = await this.all(
      'SELECT * FROM policies WHERE enabled = true AND org_id = ? ORDER BY priority DESC',
      [orgId],
    );
    if (rows.length > 0) return rows.map(mapPolicy);
    return this.getActivePolicies();
  }

  async getActivePoliciesForAgent(agentId: string, orgId?: string): Promise<Policy[]> {
    // Agent-specific assignments take precedence.
    const assignedRows = await this.all(
      `SELECT p.*
       FROM policies p
       INNER JOIN agent_policies ap ON p.id = ap.policy_id
       WHERE ap.agent_id = ? AND p.enabled = true
       ORDER BY p.priority DESC, p.created_at DESC`,
      [agentId],
    );
    if (assignedRows.length > 0) return assignedRows.map(mapPolicy);

    if (orgId) {
      return this.getActivePoliciesByOrg(orgId);
    }
    return this.getActivePolicies();
  }

  async getAllPolicies(): Promise<Policy[]> {
    const rows = await this.all(
      'SELECT * FROM policies ORDER BY priority DESC, created_at DESC'
    );
    return rows.map(mapPolicy);
  }

  async getPoliciesByOrg(orgId: string): Promise<Policy[]> {
    const rows = await this.all(
      'SELECT * FROM policies WHERE org_id = ? ORDER BY priority DESC, created_at DESC',
      [orgId],
    );
    return rows.map(mapPolicy);
  }

  async getPolicyById(id: string): Promise<Policy | null> {
    const row = await this.one('SELECT * FROM policies WHERE id = ?', [id]);
    return row ? mapPolicy(row) : null;
  }

  async createPolicy(policy: Policy, orgId?: string): Promise<void> {
    const now = new Date();
    const transactionTypes = policy.conditions?.transactionType || ['agent-to-merchant'];
    await this.run(
      `INSERT INTO policies (id, name, type, enabled, priority, transaction_types, conditions, rules, org_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        policy.id, policy.name, policy.type, policy.enabled, policy.priority,
        JSON.stringify(transactionTypes),
      JSON.stringify(policy.conditions),
      JSON.stringify(policy.rules),
        orgId ?? null,
        now, now,
      ]
    );
  }

  async updatePolicy(policy: Policy): Promise<void> {
    const transactionTypes = policy.conditions?.transactionType || ['agent-to-merchant'];
    await this.run(
      `UPDATE policies
       SET name = ?, type = ?, enabled = ?, priority = ?, transaction_types = ?,
           conditions = ?, rules = ?, updated_at = ?
       WHERE id = ?`,
      [
        policy.name, policy.type, policy.enabled, policy.priority,
        JSON.stringify(transactionTypes),
      JSON.stringify(policy.conditions),
      JSON.stringify(policy.rules),
        new Date(), policy.id,
      ]
    );
  }

  async deletePolicy(id: string): Promise<void> {
    await this.run('DELETE FROM policies WHERE id = ?', [id]);
  }

  // ── User-policy assignment ───────────────────────────────────────────────────

  async getUserPolicies(userId: string): Promise<Policy[]> {
    const rows = await this.all(
      `SELECT p.*
      FROM policies p
      INNER JOIN user_policies up ON p.id = up.policy_id
      WHERE up.user_id = ?
       ORDER BY p.priority DESC, p.created_at DESC`,
      [userId]
    );
    return rows.map(mapPolicy);
  }

  async assignPolicyToUser(userId: string, policyId: string): Promise<void> {
    const id = `user-policy-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    await this.run(
      `INSERT INTO user_policies (id, user_id, policy_id, created_at)
      VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, policy_id) DO NOTHING`,
      [id, userId, policyId, new Date()]
    );
  }

  async removePolicyFromUser(userId: string, policyId: string): Promise<void> {
    await this.run(
      'DELETE FROM user_policies WHERE user_id = ? AND policy_id = ?',
      [userId, policyId]
    );
  }

  // ── Agent-policy assignment ──────────────────────────────────────────────────

  async getAgentPolicies(agentId: string): Promise<Policy[]> {
    const rows = await this.all(
      `SELECT p.*
       FROM policies p
       INNER JOIN agent_policies ap ON p.id = ap.policy_id
       WHERE ap.agent_id = ?
       ORDER BY p.priority DESC, p.created_at DESC`,
      [agentId],
    );
    return rows.map(mapPolicy);
  }

  async assignPolicyToAgent(agentId: string, policyId: string): Promise<void> {
    const id = `agent-policy-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    await this.run(
      `INSERT INTO agent_policies (id, agent_id, policy_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (agent_id, policy_id) DO NOTHING`,
      [id, agentId, policyId, new Date()],
    );
  }

  async removePolicyFromAgent(agentId: string, policyId: string): Promise<void> {
    await this.run(
      'DELETE FROM agent_policies WHERE agent_id = ? AND policy_id = ?',
      [agentId, policyId],
    );
  }

  // ── Spending analytics ────────────────────────────────────────────────────────

  async getUserSpending(
    userId: string,
    period: 'daily' | 'weekly' | 'monthly',
    transactionType?: 'agent-to-merchant' | 'agent-to-agent'
  ): Promise<number> {
    const startDate = periodStart(period);
    let sql = `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM purchase_attempts
      WHERE user_id = ? AND allowed = true AND timestamp >= ?`;
    const params: any[] = [userId, startDate];
    if (transactionType) {
      sql += ' AND transaction_type = ?';
      params.push(transactionType);
    }
    const row = await this.one(sql, params);
    return Number(row?.total ?? 0);
  }

  async getSpendingByTransactionType(userId: string, period: 'daily' | 'weekly' | 'monthly'): Promise<{
    agentToMerchant: number; agentToAgent: number; total: number;
  }> {
    const [a2m, a2a, total] = await Promise.all([
      this.getUserSpending(userId, period, 'agent-to-merchant'),
      this.getUserSpending(userId, period, 'agent-to-agent'),
      this.getUserSpending(userId, period),
    ]);
    return { agentToMerchant: a2m, agentToAgent: a2a, total };
  }

  async getSpendingByCategory(userId: string, period: 'daily' | 'weekly' | 'monthly'): Promise<
    Array<{ category: string; amount: number; transactionCount: number }>
  > {
    const startDate = periodStart(period);
    const rows = await this.all(
      `SELECT
         COALESCE(category, 'Uncategorized') AS category,
         SUM(amount)  AS amount,
         COUNT(*)     AS "transactionCount"
      FROM purchase_attempts
       WHERE user_id = ? AND allowed = true AND timestamp >= ?
       GROUP BY COALESCE(category, 'Uncategorized')
       ORDER BY amount DESC`,
      [userId, startDate]
    );
    return rows.map(r => ({ category: r.category, amount: Number(r.amount), transactionCount: Number(r.transactionCount) }));
  }

  // ── Purchase attempts ─────────────────────────────────────────────────────────

  async recordPurchaseAttempt(attempt: any): Promise<number> {
    const row = await this.one(
      `INSERT INTO purchase_attempts
         (user_id, product_id, product_name, amount, merchant, category, allowed,
          requires_approval, approval_status, policy_results, checkout_method,
          transaction_type, payment_method, blockchain_tx_signature, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [
        attempt.userId,
        attempt.productId,
        attempt.productName ?? null,
        attempt.amount,
        attempt.merchant,
        attempt.category ?? null,
        attempt.allowed,
        attempt.requiresApproval ?? false,
        attempt.approvalStatus ?? null,
        JSON.stringify(attempt.policyCheckResults || []),
        attempt.checkoutMethod || 'traditional',
        attempt.transactionType || 'agent-to-merchant',
        attempt.paymentMethod || 'stripe',
        attempt.blockchainTxSignature ?? null,
        new Date(),
      ]
    );
    return Number(row?.id);
  }

  async getPurchaseHistory(userId?: string, limit = 50): Promise<any[]> {
    let sql = `
      SELECT id, user_id, product_id, product_name, amount, merchant, category,
             allowed, requires_approval, approval_status, checkout_method,
             policy_results, timestamp
      FROM purchase_attempts`;
    const params: any[] = [];
    if (userId) { sql += ' WHERE user_id = ?'; params.push(userId); }
    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);
    const rows = await this.all(sql, params);
    return rows.map(mapPurchase);
  }

  async getPurchaseById(purchaseId: number): Promise<any | null> {
    const row = await this.one(
      `SELECT id, user_id, product_id, product_name, amount, merchant, category,
              allowed, requires_approval, approval_status, policy_results, timestamp,
              checkout_method, product_url, product_image_url
       FROM purchase_attempts WHERE id = ?`,
      [purchaseId]
    );
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      productId: row.product_id,
      productName: row.product_name || row.product_id,
      amount: Number(row.amount),
      merchant: row.merchant,
      category: row.category,
      allowed: row.allowed,
      requiresApproval: row.requires_approval,
      approval_status: row.approval_status,
      policyResults: JSON.parse(row.policy_results || '[]'),
      timestamp: row.timestamp,
      checkoutMethod: row.checkout_method,
      productUrl: row.product_url,
      productImageUrl: row.product_image_url,
    };
  }

  // ── Approvals ─────────────────────────────────────────────────────────────────

  async getPendingApprovals(userId?: string): Promise<any[]> {
    let sql = `
      SELECT id, user_id, product_id, product_name, amount, merchant, category,
             requires_approval, approval_status, policy_results, timestamp
      FROM purchase_attempts
      WHERE requires_approval = true
        AND (approval_status IS NULL OR approval_status = 'pending')`;
    const params: any[] = [];
    if (userId) { sql += ' AND user_id = ?'; params.push(userId); }
    sql += ' ORDER BY timestamp DESC';
    const rows = await this.all(sql, params);
    return rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      productId: r.product_id,
      productName: r.product_name || r.product_id,
      amount: Number(r.amount),
      merchant: r.merchant,
      category: r.category,
      requiresApproval: r.requires_approval,
      approvalStatus: r.approval_status ?? 'pending',
      policyResults: JSON.parse(r.policy_results || '[]'),
      timestamp: r.timestamp,
    }));
  }

  async approvePurchase(purchaseId: number): Promise<void> {
    await this.run(
      `UPDATE purchase_attempts SET allowed = true, approval_status = 'approved' WHERE id = ?`,
      [purchaseId]
    );
  }

  async rejectPurchase(purchaseId: number, _reason?: string): Promise<void> {
    await this.run(
      `UPDATE purchase_attempts SET allowed = false, approval_status = 'rejected' WHERE id = ?`,
      [purchaseId]
    );
  }

  // ── Approval accuracy ─────────────────────────────────────────────────────────

  async getApprovalAccuracy(userId?: string): Promise<{
    totalSuggestions: number; accepted: number; rejected: number;
    requiresApproval: number; accuracy: number;
  }> {
    let sql = `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN allowed = true THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE WHEN allowed = false THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN requires_approval = true THEN 1 ELSE 0 END) AS requires_approval_count
      FROM purchase_attempts`;
    const params: any[] = [];
    if (userId) { sql += ' WHERE user_id = ?'; params.push(userId); }
    const result = await this.one(sql, params);
    const total = Number(result?.total ?? 0);
    const accepted = Number(result?.accepted ?? 0);
    const rejected = Number(result?.rejected ?? 0);
    const requiresApproval = Number(result?.requires_approval_count ?? 0);
    const accuracy = requiresApproval > 0
      ? Math.round((accepted / requiresApproval) * 100)
      : total > 0 ? Math.round((accepted / total) * 100) : 0;
    return { totalSuggestions: total, accepted, rejected, requiresApproval, accuracy };
  }

  // ── Policy compliance stats ───────────────────────────────────────────────────

  async getPolicyComplianceStats(userId?: string): Promise<{
    totalSpend: number; inPolicySpend: number; outOfPolicySpend: number;
    compliancePercentage: number; totalTransactions: number;
    approvedTransactions: number; deniedTransactions: number;
    pendingApprovals: number; trend: number;
  }> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const baseSelect = `
      SELECT 
        COALESCE(SUM(amount), 0) AS total_spend,
        COALESCE(SUM(CASE WHEN allowed = true OR approval_status = 'approved' THEN amount ELSE 0 END), 0) AS in_policy_spend,
        COALESCE(SUM(CASE WHEN allowed = false AND (approval_status IS NULL OR approval_status != 'approved') THEN amount ELSE 0 END), 0) AS out_policy_spend,
        COUNT(*) AS total_transactions,
        SUM(CASE WHEN approval_status = 'approved' OR (allowed = true AND requires_approval = false) THEN 1 ELSE 0 END) AS approved_transactions,
        SUM(CASE WHEN approval_status = 'rejected' OR (allowed = false AND requires_approval = false) THEN 1 ELSE 0 END) AS denied_transactions,
        SUM(CASE WHEN requires_approval = true AND (approval_status IS NULL OR approval_status = 'pending') THEN 1 ELSE 0 END) AS pending_approvals
      FROM purchase_attempts WHERE timestamp >= ?`;

    const currentParams: any[] = [startOfMonth];
    let currentSql = baseSelect;
    if (userId) { currentSql += ' AND user_id = ?'; currentParams.push(userId); }
    const current = await this.one(currentSql, currentParams);

    let lastMonthSql = `
      SELECT COALESCE(SUM(amount), 0) AS total_spend
      FROM purchase_attempts WHERE timestamp >= ? AND timestamp <= ?`;
    const lastMonthParams: any[] = [startOfLastMonth, endOfLastMonth];
    if (userId) { lastMonthSql += ' AND user_id = ?'; lastMonthParams.push(userId); }
    const lastMonth = await this.one(lastMonthSql, lastMonthParams);

    const totalSpend = Number(current?.total_spend ?? 0);
    const inPolicySpend = Number(current?.in_policy_spend ?? 0);
    const compliancePercentage = totalSpend > 0 ? (inPolicySpend / totalSpend) * 100 : 100;
    const lastMonthSpend = Number(lastMonth?.total_spend ?? 0);
    const trend = lastMonthSpend > 0 ? ((totalSpend - lastMonthSpend) / lastMonthSpend) * 100 : 0;

    return {
      totalSpend,
      inPolicySpend,
      outOfPolicySpend: Number(current?.out_policy_spend ?? 0),
      compliancePercentage: Math.round(compliancePercentage * 10) / 10,
      totalTransactions: Number(current?.total_transactions ?? 0),
      approvedTransactions: Number(current?.approved_transactions ?? 0),
      deniedTransactions: Number(current?.denied_transactions ?? 0),
      pendingApprovals: Number(current?.pending_approvals ?? 0),
      trend: Math.round(trend * 10) / 10,
    };
  }

  async getPolicyAnalytics(policyId: string, userId?: string): Promise<{
    policyId: string; policyName: string; totalChecks: number;
    passed: number; failed: number; successRate: number; impactedSpend: number;
  }> {
    const policy = await this.getPolicyById(policyId);
    if (!policy) throw new Error(`Policy ${policyId} not found`);

    // Use text LIKE on the JSON stored as text
    let sql = `
      SELECT
        COUNT(*) AS total_checks,
        SUM(CASE WHEN policy_results LIKE ? THEN 1 ELSE 0 END) AS passed,
        SUM(CASE WHEN policy_results LIKE ? THEN 1 ELSE 0 END) AS failed,
        COALESCE(SUM(CASE WHEN policy_results LIKE ? THEN amount ELSE 0 END), 0) AS impacted_spend
      FROM purchase_attempts`;
    const likeAll    = `%"id":"${policyId}"%`;
    const likePass   = `%"id":"${policyId}"%"passed":true%`;
    const likeFail   = `%"id":"${policyId}"%"passed":false%`;
    const params: any[] = [likePass, likeFail, likeAll];
    if (userId) { sql += ' WHERE user_id = ?'; params.push(userId); }
    const stats = await this.one(sql, params);

    const totalChecks = Number(stats?.total_checks ?? 0);
    const passed = Number(stats?.passed ?? 0);
    return {
      policyId,
      policyName: policy.name,
      totalChecks,
      passed,
      failed: Number(stats?.failed ?? 0),
      successRate: totalChecks > 0 ? Math.round((passed / totalChecks) * 100 * 10) / 10 : 0,
      impactedSpend: Number(stats?.impacted_spend ?? 0),
    };
  }

  // ── User management ───────────────────────────────────────────────────────────

  async createOrGetUser(email: string, name?: string): Promise<{ id: string; email: string; name?: string }> {
    const existing = await this.one('SELECT * FROM users WHERE email = ?', [email]);
    if (existing) {
      if (name && name !== existing.name) {
        await this.run('UPDATE users SET name = ?, updated_at = ? WHERE id = ?', [name, new Date(), existing.id]);
        return { id: existing.id, email: existing.email, name };
      }
      return { id: existing.id, email: existing.email, name: existing.name ?? undefined };
    }
    const userId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date();
    try {
      await this.run(
        'INSERT INTO users (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [userId, email, name ?? null, now, now]
      );
      return { id: userId, email, name: name ?? undefined };
    } catch (error: any) {
      if (error.code === '23505') {
        const row = await this.one('SELECT * FROM users WHERE email = ?', [email]);
        if (row) return { id: row.id, email: row.email, name: row.name ?? undefined };
      }
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<{ id: string; email: string; name?: string; role?: string } | null> {
    const row = await this.one('SELECT * FROM users WHERE email = ?', [email]);
    if (!row) return null;
    return { id: row.id, email: row.email, name: row.name ?? undefined, role: row.role ?? undefined };
  }

  async getUserById(id: string): Promise<{ id: string; email: string; name?: string; role?: string } | null> {
    const row = await this.one('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) return null;
    return { id: row.id, email: row.email, name: row.name ?? undefined, role: row.role ?? undefined };
  }

  async getAllUsers(): Promise<{ id: string; email: string; name?: string }[]> {
    const rows = await this.all('SELECT * FROM users ORDER BY created_at DESC');
    return rows.map(r => ({ id: r.id, email: r.email, name: r.name ?? undefined }));
  }

  async cleanupDuplicateUsers(): Promise<{
    duplicatesFound: Array<{ email: string; userIds: string[] }>;
    usersDeleted: string[]; policiesMigrated: number;
    purchasesMigrated: number; errors: string[];
  }> {
    const results = {
      duplicatesFound: [] as Array<{ email: string; userIds: string[] }>,
      usersDeleted: [] as string[],
      policiesMigrated: 0,
      purchasesMigrated: 0,
      errors: [] as string[],
    };

    const dupes = await this.all(
      `SELECT email, COUNT(*) AS cnt, STRING_AGG(id, ',') AS user_ids
       FROM users GROUP BY email HAVING COUNT(*) > 1`
    );

    for (const dup of dupes) {
      const userIds = dup.user_ids.split(',');
      results.duplicatesFound.push({ email: dup.email, userIds });
      const users = await this.all('SELECT * FROM users WHERE email = ? ORDER BY created_at ASC', [dup.email]);
      if (users.length < 2) continue;
      const keepUser = users[0];
      for (const delUser of users.slice(1)) {
        const policies = await this.all('SELECT * FROM user_policies WHERE user_id = ?', [delUser.id]);
        for (const p of policies) {
          try {
            const existing = await this.one(
              'SELECT 1 FROM user_policies WHERE user_id = ? AND policy_id = ?',
              [keepUser.id, p.policy_id]
            );
            if (!existing) {
              await this.run('UPDATE user_policies SET user_id = ? WHERE id = ?', [keepUser.id, p.id]);
              results.policiesMigrated++;
            } else {
              await this.run('DELETE FROM user_policies WHERE id = ?', [p.id]);
            }
          } catch (e: any) {
            results.errors.push(`Policy migration error: ${e.message}`);
          }
        }
        const count = await this.one('SELECT COUNT(*) AS cnt FROM purchase_attempts WHERE user_id = ?', [delUser.id]);
        if (Number(count?.cnt) > 0) {
          await this.run('UPDATE purchase_attempts SET user_id = ? WHERE user_id = ?', [keepUser.id, delUser.id]);
          results.purchasesMigrated += Number(count.cnt);
        }
        await this.run('DELETE FROM users WHERE id = ?', [delUser.id]);
        results.usersDeleted.push(delUser.id);
      }
    }
    return results;
  }

  // ── x402 Nonces ───────────────────────────────────────────────────────────────

  async checkX402Nonce(nonce: string): Promise<boolean> {
    const row = await this.one('SELECT id FROM x402_nonces WHERE nonce = ?', [nonce]);
    return !!row;
  }

  async storeX402Nonce(params: {
    nonce: string; txSignature: string; agentId: string; buyerUserId?: string;
    amount: string; mint: string; verified: boolean; verifiedAt: Date; expiresAt: Date;
  }): Promise<void> {
    await this.run(
      `INSERT INTO x402_nonces
         (nonce, tx_signature, agent_id, buyer_user_id, amount, mint,
          verified, verified_at, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (nonce) DO NOTHING`,
      [
        params.nonce, params.txSignature, params.agentId,
        params.buyerUserId ?? null, params.amount, params.mint,
        params.verified, params.verifiedAt, params.expiresAt, new Date(),
      ]
    );
  }

  async cleanupExpiredNonces(): Promise<number> {
    const result = await this.run('DELETE FROM x402_nonces WHERE expires_at < ?', [new Date()]);
    return result.rowCount;
  }

  // ── Agent Registry ────────────────────────────────────────────────────────────

  async registerAgent(params: {
    id: string; agentId: string; name: string; baseUrl: string;
    services: string[]; serviceDescription?: string; acceptedCurrencies: string[];
    usdcTokenAccount?: string; solanaPubkey?: string; ownerId: string; metadata?: any;
  }): Promise<void> {
    const now = new Date();
    await this.run(
      `INSERT INTO registered_agents
         (id, agent_id, name, base_url, services, service_description,
          accepted_currencies, usdc_token_account, solana_pubkey,
          active, verified, owner_id, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, true, false, ?, ?, ?, ?)`,
      [
        params.id, params.agentId, params.name, params.baseUrl,
        JSON.stringify(params.services), params.serviceDescription ?? null,
        JSON.stringify(params.acceptedCurrencies),
        params.usdcTokenAccount ?? null, params.solanaPubkey ?? null,
        params.ownerId, params.metadata ? JSON.stringify(params.metadata) : null,
        now, now,
      ]
    );
  }

  async getRegisteredAgent(agentId: string): Promise<any | null> {
    const row = await this.one('SELECT * FROM registered_agents WHERE agent_id = ?', [agentId]);
    return row ? mapAgent(row) : null;
  }

  async listRegisteredAgents(filters?: { active?: boolean; verified?: boolean; ownerId?: string }): Promise<any[]> {
    let sql = 'SELECT * FROM registered_agents WHERE 1=1';
    const params: any[] = [];
    if (filters?.active !== undefined) { sql += ' AND active = ?'; params.push(filters.active); }
    if (filters?.verified !== undefined) { sql += ' AND verified = ?'; params.push(filters.verified); }
    if (filters?.ownerId) { sql += ' AND owner_id = ?'; params.push(filters.ownerId); }
    sql += ' ORDER BY created_at DESC';
    const rows = await this.all(sql, params);
    return rows.map(mapAgent);
  }

  async updateRegisteredAgent(agentId: string, updates: {
    name?: string; baseUrl?: string; services?: string[]; serviceDescription?: string;
    usdcTokenAccount?: string; solanaPubkey?: string; active?: boolean; verified?: boolean;
    metadata?: any;
  }): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    if (updates.name !== undefined)               { fields.push('name = ?');                 values.push(updates.name); }
    if (updates.baseUrl !== undefined)            { fields.push('base_url = ?');              values.push(updates.baseUrl); }
    if (updates.services !== undefined)           { fields.push('services = ?');              values.push(JSON.stringify(updates.services)); }
    if (updates.serviceDescription !== undefined) { fields.push('service_description = ?');   values.push(updates.serviceDescription); }
    if (updates.usdcTokenAccount !== undefined)   { fields.push('usdc_token_account = ?');    values.push(updates.usdcTokenAccount); }
    if (updates.solanaPubkey !== undefined)       { fields.push('solana_pubkey = ?');         values.push(updates.solanaPubkey); }
    if (updates.active !== undefined)             { fields.push('active = ?');                values.push(updates.active); }
    if (updates.verified !== undefined)           { fields.push('verified = ?');              values.push(updates.verified); }
    if (updates.metadata !== undefined)           { fields.push('metadata = ?');              values.push(updates.metadata ? JSON.stringify(updates.metadata) : null); }
    if (!fields.length) return;
    fields.push('updated_at = ?');
    values.push(new Date());
    values.push(agentId);
    await this.run(`UPDATE registered_agents SET ${fields.join(', ')} WHERE agent_id = ?`, values);
  }

  async deleteRegisteredAgent(agentId: string): Promise<void> {
    await this.run('DELETE FROM registered_agents WHERE agent_id = ?', [agentId]);
  }

  // ── User Wallets ──────────────────────────────────────────────────────────────

  async getUserWallet(userId: string): Promise<UserWalletRecord | null> {
    const row = await this.one('SELECT * FROM user_wallets WHERE user_id = ?', [userId]);
    if (!row) return null;

    try {
      const plaintext = decryptWallet(row.encrypted_secret);
      const parsed = JSON.parse(plaintext);

      if (parsed.version === 2) {
        return {
          userId: row.user_id,
          evmAddress: parsed.evm.address,
          evmPrivateKey: parsed.evm.privateKey,
          solanaPublicKey: parsed.solana?.publicKey,
          solanaSecretKey: parsed.solana?.secretKey,
        };
      }

      // Legacy row: plaintext was a raw secretKey number[] (Solana, no EVM).
      // Return null so the caller regenerates with an EVM wallet.
      return null;
    } catch {
      return null;
    }
  }

  async saveUserWallet(wallet: UserWalletRecord): Promise<void> {
    const payload = JSON.stringify({
      version: 2,
      evm: { address: wallet.evmAddress, privateKey: wallet.evmPrivateKey },
      ...(wallet.solanaPublicKey
        ? { solana: { publicKey: wallet.solanaPublicKey, secretKey: wallet.solanaSecretKey } }
        : {}),
    });
    const encryptedSecret = encryptWallet(payload);
    const id = `wallet_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    await this.run(
      `INSERT INTO user_wallets (id, user_id, public_key, encrypted_secret, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE
         SET public_key = EXCLUDED.public_key,
             encrypted_secret = EXCLUDED.encrypted_secret`,
      [id, wallet.userId, wallet.evmAddress, encryptedSecret, new Date()],
    );
  }

  // ── Funding Accounts / Ledger (treasury subaccounts) ────────────────────────

  async getFundingAccountByUserId(userId: string): Promise<{
    id: string;
    userId: string;
    organizationId?: string | null;
    currency: string;
    status: string;
    balanceAvailable: number;
    balanceReserved: number;
    metadata?: any;
  } | null> {
    const row = await this.one('SELECT * FROM funding_accounts WHERE user_id = ?', [userId]);
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      organizationId: row.organization_id || null,
      currency: row.currency,
      status: row.status,
      balanceAvailable: Number(row.balance_available || 0),
      balanceReserved: Number(row.balance_reserved || 0),
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    };
  }

  async createOrGetFundingAccountForUser(userId: string, currency = 'USDC'): Promise<{
    id: string;
    userId: string;
    organizationId?: string | null;
    currency: string;
    status: string;
    balanceAvailable: number;
    balanceReserved: number;
  }> {
    const existing = await this.getFundingAccountByUserId(userId);
    if (existing) return existing;
    const id = `fund_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await this.run(
      `INSERT INTO funding_accounts
         (id, user_id, currency, status, balance_available, balance_reserved, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 0, 0, ?, ?)
       ON CONFLICT (user_id) DO NOTHING`,
      [id, userId, currency, new Date(), new Date()]
    );
    const created = await this.getFundingAccountByUserId(userId);
    if (!created) throw new Error('Failed to create funding account');
    return created;
  }

  async topUpFundingAccount(params: {
    userId: string;
    amount: number;
    currency?: string;
    idempotencyKey?: string;
    referenceType?: string;
    referenceId?: string;
    metadata?: any;
  }): Promise<{ accountId: string; balanceAvailable: number; balanceReserved: number; ledgerEntryId: string }> {
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      throw new Error('Top up amount must be a positive number');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const account = await this.createOrGetFundingAccountForUser(params.userId, params.currency || 'USDC');
      const locked = await client.query(
        'SELECT * FROM funding_accounts WHERE id = $1 FOR UPDATE',
        [account.id]
      );
      const row = locked.rows[0];
      const nextAvailable = Number(row.balance_available || 0) + params.amount;
      await client.query(
        'UPDATE funding_accounts SET balance_available = $1, updated_at = $2 WHERE id = $3',
        [nextAvailable, new Date(), account.id]
      );
      const ledgerEntryId = `ledger_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      await client.query(
        `INSERT INTO funding_ledger_entries
           (id, account_id, entry_type, amount, currency, reference_type, reference_id, idempotency_key, status, metadata, created_at)
         VALUES ($1,$2,'credit',$3,$4,$5,$6,$7,'posted',$8,$9)`,
        [
          ledgerEntryId,
          account.id,
          params.amount,
          params.currency || account.currency,
          params.referenceType || 'manual-topup',
          params.referenceId || null,
          params.idempotencyKey || null,
          params.metadata ? JSON.stringify(params.metadata) : null,
          new Date(),
        ]
      );
      await client.query('COMMIT');
      return {
        accountId: account.id,
        balanceAvailable: nextAvailable,
        balanceReserved: Number(row.balance_reserved || 0),
        ledgerEntryId,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reserveFundingAmount(params: {
    userId: string;
    amount: number;
    currency?: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey?: string;
    metadata?: any;
  }): Promise<{ reserved: boolean; reason?: string; reservationEntryId?: string; accountId?: string; balanceAvailable?: number; balanceReserved?: number }> {
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      throw new Error('Reserve amount must be a positive number');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const account = await this.createOrGetFundingAccountForUser(params.userId, params.currency || 'USDC');
      const locked = await client.query(
        'SELECT * FROM funding_accounts WHERE id = $1 FOR UPDATE',
        [account.id]
      );
      const row = locked.rows[0];
      const available = Number(row.balance_available || 0);
      const reserved = Number(row.balance_reserved || 0);
      if (available < params.amount) {
        await client.query('COMMIT');
        return {
          reserved: false,
          reason: `Insufficient funding balance. Need ${params.amount.toFixed(6)} ${account.currency}, have ${available.toFixed(6)}.`,
          accountId: account.id,
          balanceAvailable: available,
          balanceReserved: reserved,
        };
      }
      const nextAvailable = available - params.amount;
      const nextReserved = reserved + params.amount;
      await client.query(
        'UPDATE funding_accounts SET balance_available = $1, balance_reserved = $2, updated_at = $3 WHERE id = $4',
        [nextAvailable, nextReserved, new Date(), account.id]
      );
      const reservationEntryId = `ledger_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      await client.query(
        `INSERT INTO funding_ledger_entries
           (id, account_id, entry_type, amount, currency, reference_type, reference_id, idempotency_key, status, metadata, created_at)
         VALUES ($1,$2,'reserve',$3,$4,$5,$6,$7,'posted',$8,$9)`,
        [
          reservationEntryId,
          account.id,
          params.amount,
          params.currency || account.currency,
          params.referenceType,
          params.referenceId,
          params.idempotencyKey || null,
          params.metadata ? JSON.stringify(params.metadata) : null,
          new Date(),
        ]
      );
      await client.query('COMMIT');
      return {
        reserved: true,
        reservationEntryId,
        accountId: account.id,
        balanceAvailable: nextAvailable,
        balanceReserved: nextReserved,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseFundingReservation(params: {
    reservationEntryId: string;
    reason?: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const reservationRes = await client.query(
        `SELECT * FROM funding_ledger_entries WHERE id = $1 AND entry_type = 'reserve'`,
        [params.reservationEntryId]
      );
      const reservation = reservationRes.rows[0];
      if (!reservation) throw new Error('Reservation entry not found');
      const amount = Number(reservation.amount || 0);
      const accountId = reservation.account_id;
      const locked = await client.query('SELECT * FROM funding_accounts WHERE id = $1 FOR UPDATE', [accountId]);
      const account = locked.rows[0];
      const nextAvailable = Number(account.balance_available || 0) + amount;
      const nextReserved = Math.max(0, Number(account.balance_reserved || 0) - amount);
      await client.query(
        'UPDATE funding_accounts SET balance_available = $1, balance_reserved = $2, updated_at = $3 WHERE id = $4',
        [nextAvailable, nextReserved, new Date(), accountId]
      );
      await client.query(
        `INSERT INTO funding_ledger_entries
           (id, account_id, entry_type, amount, currency, reference_type, reference_id, status, metadata, created_at)
         VALUES ($1,$2,'release',$3,$4,'reservation-release',$5,'posted',$6,$7)`,
        [
          `ledger_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          accountId,
          amount,
          reservation.currency,
          reservation.id,
          JSON.stringify({ reason: params.reason || 'release' }),
          new Date(),
        ]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async commitFundingReservation(params: {
    reservationEntryId: string;
    referenceType?: string;
    referenceId?: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const reservationRes = await client.query(
        `SELECT * FROM funding_ledger_entries WHERE id = $1 AND entry_type = 'reserve'`,
        [params.reservationEntryId]
      );
      const reservation = reservationRes.rows[0];
      if (!reservation) throw new Error('Reservation entry not found');
      const amount = Number(reservation.amount || 0);
      const accountId = reservation.account_id;
      const locked = await client.query('SELECT * FROM funding_accounts WHERE id = $1 FOR UPDATE', [accountId]);
      const account = locked.rows[0];
      const nextReserved = Math.max(0, Number(account.balance_reserved || 0) - amount);
      await client.query(
        'UPDATE funding_accounts SET balance_reserved = $1, updated_at = $2 WHERE id = $3',
        [nextReserved, new Date(), accountId]
      );
      await client.query(
        `INSERT INTO funding_ledger_entries
           (id, account_id, entry_type, amount, currency, reference_type, reference_id, status, metadata, created_at)
         VALUES ($1,$2,'debit',$3,$4,$5,$6,'posted',$7,$8)`,
        [
          `ledger_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          accountId,
        amount,
          reservation.currency,
          params.referenceType || 'reservation-commit',
          params.referenceId || reservation.id,
          JSON.stringify({ reservationEntryId: reservation.id }),
          new Date(),
        ]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getIdempotentRequest(params: {
    userId: string;
    endpoint: string;
    idempotencyKey: string;
  }): Promise<{
    status: string;
    requestHash: string;
    responseCode?: number;
    responseJson?: any;
    errorMessage?: string;
  } | null> {
    const row = await this.one(
      `SELECT status, request_hash, response_code, response_json, error_message
       FROM request_idempotency
       WHERE user_id = ? AND endpoint = ? AND idempotency_key = ?`,
      [params.userId, params.endpoint, params.idempotencyKey]
    );
    if (!row) return null;
    return {
      status: row.status,
      requestHash: row.request_hash,
      responseCode: row.response_code ?? undefined,
      responseJson: row.response_json ? JSON.parse(row.response_json) : undefined,
      errorMessage: row.error_message ?? undefined,
    };
  }

  async createPendingIdempotentRequest(params: {
    userId: string;
    endpoint: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<void> {
    await this.run(
      `INSERT INTO request_idempotency
         (id, user_id, endpoint, idempotency_key, request_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT (user_id, endpoint, idempotency_key) DO NOTHING`,
      [
        `idem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        params.userId,
        params.endpoint,
        params.idempotencyKey,
        params.requestHash,
        new Date(),
        new Date(),
      ]
    );
  }

  async completeIdempotentRequest(params: {
    userId: string;
    endpoint: string;
    idempotencyKey: string;
    responseCode: number;
    responseJson: any;
  }): Promise<void> {
    await this.run(
      `UPDATE request_idempotency
       SET status = 'completed', response_code = ?, response_json = ?, error_message = NULL, updated_at = ?
       WHERE user_id = ? AND endpoint = ? AND idempotency_key = ?`,
      [
        params.responseCode,
        params.responseJson ? JSON.stringify(params.responseJson) : null,
        new Date(),
        params.userId,
        params.endpoint,
        params.idempotencyKey,
      ]
    );
  }

  async failIdempotentRequest(params: {
    userId: string;
    endpoint: string;
    idempotencyKey: string;
    errorMessage: string;
    responseCode?: number;
  }): Promise<void> {
    await this.run(
      `UPDATE request_idempotency
       SET status = 'failed', response_code = ?, error_message = ?, updated_at = ?
       WHERE user_id = ? AND endpoint = ? AND idempotency_key = ?`,
      [
        params.responseCode ?? null,
        params.errorMessage,
        new Date(),
        params.userId,
        params.endpoint,
        params.idempotencyKey,
      ]
    );
  }

  // ── Organizations / Multi-tenant Treasury ───────────────────────────────────

  async createOrganization(params: {
    name: string;
    slug: string;
    ownerUserId: string;
    metadata?: any;
  }): Promise<{ id: string; name: string; slug: string; status: string }> {
    const id = `org_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await this.run(
      `INSERT INTO organizations (id, name, slug, status, metadata, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      [id, params.name, params.slug, params.metadata ? JSON.stringify(params.metadata) : null, new Date(), new Date()]
    );
    await this.addOrganizationMember({
      orgId: id,
      userId: params.ownerUserId,
      role: 'owner',
      status: 'active',
    });
    const created = await this.one('SELECT * FROM organizations WHERE id = ?', [id]);
    return {
      id: created.id,
      name: created.name,
      slug: created.slug,
      status: created.status,
    };
  }

  async getOrganizationById(orgId: string): Promise<any | null> {
    const row = await this.one('SELECT * FROM organizations WHERE id = ?', [orgId]);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getUserOrganizations(userId: string): Promise<any[]> {
    const rows = await this.all(
      `SELECT o.*, m.role as membership_role, m.status as membership_status
       FROM organizations o
       INNER JOIN org_memberships m ON o.id = m.org_id
       WHERE m.user_id = ? AND m.status = 'active'
       ORDER BY o.created_at DESC`,
      [userId]
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      role: row.membership_role,
      membershipStatus: row.membership_status,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    }));
  }

  async addOrganizationMember(params: {
    orgId: string;
    userId: string;
    role?: 'owner' | 'admin' | 'manager' | 'member';
    status?: 'active' | 'invited' | 'suspended';
  }): Promise<void> {
    const id = `orgmem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await this.run(
      `INSERT INTO org_memberships (id, org_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (org_id, user_id) DO UPDATE
       SET role = EXCLUDED.role, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
      [
        id,
        params.orgId,
        params.userId,
        params.role || 'member',
        params.status || 'active',
        new Date(),
        new Date(),
      ]
    );
  }

  async getOrganizationMembership(orgId: string, userId: string): Promise<{ role: string; status: string } | null> {
    const row = await this.one(
      `SELECT role, status FROM org_memberships WHERE org_id = ? AND user_id = ?`,
      [orgId, userId]
    );
    if (!row) return null;
    return { role: row.role, status: row.status };
  }

  async createOrGetOrgTreasuryAccount(orgId: string, currency = 'USDC'): Promise<{
    id: string;
    orgId: string;
    currency: string;
    status: string;
    balanceAvailable: number;
    balanceReserved: number;
  }> {
    const existing = await this.one('SELECT * FROM org_treasury_accounts WHERE org_id = ?', [orgId]);
    if (existing) {
    return {
        id: existing.id,
        orgId: existing.org_id,
        currency: existing.currency,
        status: existing.status,
        balanceAvailable: Number(existing.balance_available || 0),
        balanceReserved: Number(existing.balance_reserved || 0),
      };
    }
    const id = `treasury_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await this.run(
      `INSERT INTO org_treasury_accounts
         (id, org_id, currency, status, balance_available, balance_reserved, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 0, 0, ?, ?)
       ON CONFLICT (org_id) DO NOTHING`,
      [id, orgId, currency, new Date(), new Date()]
    );
    const created = await this.one('SELECT * FROM org_treasury_accounts WHERE org_id = ?', [orgId]);
    return {
      id: created.id,
      orgId: created.org_id,
      currency: created.currency,
      status: created.status,
      balanceAvailable: Number(created.balance_available || 0),
      balanceReserved: Number(created.balance_reserved || 0),
    };
  }

  async topUpOrgTreasury(params: {
    orgId: string;
    amount: number;
    currency?: string;
    treasuryWalletId?: string;
    referenceType?: string;
    referenceId?: string;
    idempotencyKey?: string;
    metadata?: any;
  }): Promise<{ treasuryAccountId: string; balanceAvailable: number; balanceReserved: number; ledgerEntryId: string }> {
    if (!Number.isFinite(params.amount) || params.amount <= 0) throw new Error('Top up amount must be positive');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const treasury = await this.createOrGetOrgTreasuryAccount(params.orgId, params.currency || 'USDC');
      const locked = await client.query('SELECT * FROM org_treasury_accounts WHERE id = $1 FOR UPDATE', [treasury.id]);
      const row = locked.rows[0];
      const nextAvailable = Number(row.balance_available || 0) + params.amount;
      await client.query(
        'UPDATE org_treasury_accounts SET balance_available = $1, updated_at = $2 WHERE id = $3',
        [nextAvailable, new Date(), treasury.id]
      );
      const ledgerEntryId = `orgledger_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      await client.query(
        `INSERT INTO org_treasury_ledger_entries
           (id, treasury_account_id, treasury_wallet_id, entry_type, amount, currency, reference_type, reference_id, idempotency_key, status, metadata, created_at)
         VALUES ($1,$2,$3,'credit',$4,$5,$6,$7,$8,'posted',$9,$10)`,
        [
          ledgerEntryId,
          treasury.id,
          params.treasuryWalletId || null,
          params.amount,
          params.currency || treasury.currency,
          params.referenceType || 'manual-topup',
          params.referenceId || null,
          params.idempotencyKey || null,
          params.metadata ? JSON.stringify(params.metadata) : null,
          new Date(),
        ]
      );
      await client.query('COMMIT');
      return {
        treasuryAccountId: treasury.id,
        balanceAvailable: nextAvailable,
        balanceReserved: Number(row.balance_reserved || 0),
        ledgerEntryId,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async allocateOrgTreasuryToUserFunding(params: {
    orgId: string;
    userId: string;
    amount: number;
    currency?: string;
    treasuryWalletId?: string;
    idempotencyKey?: string;
    metadata?: any;
  }): Promise<{
    orgLedgerEntryId: string;
    userLedgerEntryId: string;
    orgBalanceAvailable: number;
    userBalanceAvailable: number;
  }> {
    if (!Number.isFinite(params.amount) || params.amount <= 0) throw new Error('Allocation amount must be positive');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const treasury = await this.createOrGetOrgTreasuryAccount(params.orgId, params.currency || 'USDC');
      const treasuryLocked = await client.query('SELECT * FROM org_treasury_accounts WHERE id = $1 FOR UPDATE', [treasury.id]);
      const treasuryRow = treasuryLocked.rows[0];
      const orgAvailable = Number(treasuryRow.balance_available || 0);
      if (orgAvailable < params.amount) {
        throw new Error(`Insufficient org treasury balance. Need ${params.amount.toFixed(6)}, have ${orgAvailable.toFixed(6)}.`);
      }
      const nextOrgAvailable = orgAvailable - params.amount;
      await client.query(
        'UPDATE org_treasury_accounts SET balance_available = $1, updated_at = $2 WHERE id = $3',
        [nextOrgAvailable, new Date(), treasury.id]
      );

      const funding = await this.createOrGetFundingAccountForUser(params.userId, params.currency || 'USDC');
      await client.query(
        'UPDATE funding_accounts SET organization_id = $1 WHERE id = $2 AND (organization_id IS NULL OR organization_id = $1)',
        [params.orgId, funding.id]
      );
      const fundingLocked = await client.query('SELECT * FROM funding_accounts WHERE id = $1 FOR UPDATE', [funding.id]);
      const fundingRow = fundingLocked.rows[0];
      const nextUserAvailable = Number(fundingRow.balance_available || 0) + params.amount;
      await client.query(
        'UPDATE funding_accounts SET balance_available = $1, updated_at = $2 WHERE id = $3',
        [nextUserAvailable, new Date(), funding.id]
      );

      const orgLedgerEntryId = `orgledger_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      await client.query(
        `INSERT INTO org_treasury_ledger_entries
           (id, treasury_account_id, treasury_wallet_id, entry_type, amount, currency, reference_type, reference_id, idempotency_key, status, metadata, created_at)
         VALUES ($1,$2,$3,'allocation',$4,$5,'user-funding-allocation',$6,$7,'posted',$8,$9)`,
        [
          orgLedgerEntryId,
          treasury.id,
          params.treasuryWalletId || null,
          params.amount,
          params.currency || treasury.currency,
          funding.id,
          params.idempotencyKey || null,
          params.metadata ? JSON.stringify(params.metadata) : null,
          new Date(),
        ]
      );

      const userLedgerEntryId = `ledger_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      await client.query(
        `INSERT INTO funding_ledger_entries
           (id, account_id, entry_type, amount, currency, reference_type, reference_id, idempotency_key, status, metadata, created_at)
         VALUES ($1,$2,'credit',$3,$4,'org-allocation',$5,$6,'posted',$7,$8)`,
        [
          userLedgerEntryId,
          funding.id,
          params.amount,
          params.currency || funding.currency,
          orgLedgerEntryId,
          params.idempotencyKey ? `${params.idempotencyKey}:user` : null,
          params.metadata ? JSON.stringify(params.metadata) : null,
          new Date(),
        ]
      );

      await client.query('COMMIT');
      return {
        orgLedgerEntryId,
        userLedgerEntryId,
        orgBalanceAvailable: nextOrgAvailable,
        userBalanceAvailable: nextUserAvailable,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createOrgTreasuryWallet(params: {
    orgId: string;
    name: string;
    address: string;
    network: string;
    asset: string;
    priority?: number;
    status?: string;
    keyCiphertext?: string;
    kmsKeyId?: string;
    keyVersion?: string;
    routingPolicy?: any;
    metadata?: any;
    createdBy?: string;
  }): Promise<any> {
    const id = `orgw_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await this.run(
      `INSERT INTO org_treasury_wallets
         (id, org_id, name, address, network, asset, status, priority, key_ciphertext, kms_key_id, key_version, routing_policy, metadata, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.orgId,
        params.name,
        params.address,
        params.network,
        params.asset,
        params.status || 'active',
        params.priority ?? 100,
        params.keyCiphertext || null,
        params.kmsKeyId || null,
        params.keyVersion || null,
        params.routingPolicy ? JSON.stringify(params.routingPolicy) : null,
        params.metadata ? JSON.stringify(params.metadata) : null,
        params.createdBy || null,
        new Date(),
        new Date(),
      ]
    );
    return this.getOrgTreasuryWalletById(id);
  }

  async listOrgTreasuryWallets(orgId: string): Promise<any[]> {
    const rows = await this.all(
      `SELECT * FROM org_treasury_wallets
       WHERE org_id = ?
       ORDER BY status = 'active' DESC, priority ASC, created_at ASC`,
      [orgId]
    );
    return rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      name: r.name,
      address: r.address,
      network: r.network,
      asset: r.asset,
      status: r.status,
      priority: Number(r.priority || 100),
      routingPolicy: r.routing_policy ? JSON.parse(r.routing_policy) : null,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
      kmsKeyId: r.kms_key_id,
      keyVersion: r.key_version,
      lastRotatedAt: r.last_rotated_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async getOrgTreasuryWalletById(walletId: string): Promise<any | null> {
    const row = await this.one('SELECT * FROM org_treasury_wallets WHERE id = ?', [walletId]);
    if (!row) return null;
    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      address: row.address,
      network: row.network,
      asset: row.asset,
      status: row.status,
      priority: Number(row.priority || 100),
      keyCiphertext: row.key_ciphertext || null,
      kmsKeyId: row.kms_key_id || null,
      keyVersion: row.key_version || null,
      routingPolicy: row.routing_policy ? JSON.parse(row.routing_policy) : null,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdBy: row.created_by || null,
      lastRotatedAt: row.last_rotated_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async updateOrgTreasuryWallet(walletId: string, updates: {
    name?: string;
    status?: string;
    priority?: number;
    keyCiphertext?: string;
    kmsKeyId?: string;
    keyVersion?: string;
    routingPolicy?: any;
    metadata?: any;
    lastRotatedAt?: Date;
  }): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
    if (updates.keyCiphertext !== undefined) { fields.push('key_ciphertext = ?'); values.push(updates.keyCiphertext); }
    if (updates.kmsKeyId !== undefined) { fields.push('kms_key_id = ?'); values.push(updates.kmsKeyId); }
    if (updates.keyVersion !== undefined) { fields.push('key_version = ?'); values.push(updates.keyVersion); }
    if (updates.routingPolicy !== undefined) { fields.push('routing_policy = ?'); values.push(updates.routingPolicy ? JSON.stringify(updates.routingPolicy) : null); }
    if (updates.metadata !== undefined) { fields.push('metadata = ?'); values.push(updates.metadata ? JSON.stringify(updates.metadata) : null); }
    if (updates.lastRotatedAt !== undefined) { fields.push('last_rotated_at = ?'); values.push(updates.lastRotatedAt); }
    if (!fields.length) return;
    fields.push('updated_at = ?');
    values.push(new Date());
    values.push(walletId);
    await this.run(`UPDATE org_treasury_wallets SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  async addOrgTreasuryWalletAdmin(params: {
    orgId: string;
    walletId: string;
    userId: string;
    role?: string;
    status?: string;
  }): Promise<void> {
    const id = `orgwa_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await this.run(
      `INSERT INTO org_treasury_wallet_admins (id, org_id, wallet_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (wallet_id, user_id) DO UPDATE
       SET role = EXCLUDED.role, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
      [
        id,
        params.orgId,
        params.walletId,
        params.userId,
        params.role || 'admin',
        params.status || 'active',
        new Date(),
        new Date(),
      ]
    );
  }

  async listOrgTreasuryWalletAdmins(walletId: string): Promise<any[]> {
    return this.all(
      `SELECT a.*, u.email, u.name
       FROM org_treasury_wallet_admins a
       INNER JOIN users u ON u.id = a.user_id
       WHERE a.wallet_id = ?
       ORDER BY a.created_at ASC`,
      [walletId]
    );
  }

  async upsertOrgTreasuryPolicy(orgId: string, policy: {
    routingMode?: string;
    allowNetworks?: string[];
    allowAssets?: string[];
    perTxnLimitAtomic?: string | number;
    dailyLimitAtomic?: string | number;
    requireManualApprovalOverAtomic?: string | number;
    metadata?: any;
  }): Promise<void> {
    await this.run(
      `INSERT INTO org_treasury_policies
         (id, org_id, routing_mode, allow_networks, allow_assets, per_txn_limit_atomic, daily_limit_atomic, require_manual_approval_over_atomic, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (org_id) DO UPDATE
       SET routing_mode = EXCLUDED.routing_mode,
           allow_networks = EXCLUDED.allow_networks,
           allow_assets = EXCLUDED.allow_assets,
           per_txn_limit_atomic = EXCLUDED.per_txn_limit_atomic,
           daily_limit_atomic = EXCLUDED.daily_limit_atomic,
           require_manual_approval_over_atomic = EXCLUDED.require_manual_approval_over_atomic,
           metadata = EXCLUDED.metadata,
           updated_at = EXCLUDED.updated_at`,
      [
        `orgpol_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        orgId,
        policy.routingMode || 'priority',
        policy.allowNetworks ? JSON.stringify(policy.allowNetworks) : null,
        policy.allowAssets ? JSON.stringify(policy.allowAssets) : null,
        policy.perTxnLimitAtomic ?? null,
        policy.dailyLimitAtomic ?? null,
        policy.requireManualApprovalOverAtomic ?? null,
        policy.metadata ? JSON.stringify(policy.metadata) : null,
        new Date(),
        new Date(),
      ]
    );
  }

  async getOrgTreasuryPolicy(orgId: string): Promise<any | null> {
    const row = await this.one('SELECT * FROM org_treasury_policies WHERE org_id = ?', [orgId]);
    if (!row) return null;
    return {
      id: row.id,
      orgId: row.org_id,
      routingMode: row.routing_mode,
      allowNetworks: row.allow_networks ? JSON.parse(row.allow_networks) : [],
      allowAssets: row.allow_assets ? JSON.parse(row.allow_assets) : [],
      perTxnLimitAtomic: row.per_txn_limit_atomic,
      dailyLimitAtomic: row.daily_limit_atomic,
      requireManualApprovalOverAtomic: row.require_manual_approval_over_atomic,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      updatedAt: row.updated_at,
    };
  }

  async selectOrgTreasuryWalletForPayment(params: {
    orgId: string;
    network: string;
    asset: string;
    amountAtomic: string;
  }): Promise<any | null> {
    const policy = await this.getOrgTreasuryPolicy(params.orgId);
    const wallets = await this.listOrgTreasuryWallets(params.orgId);
    let filtered = wallets.filter((w) => w.status === 'active');
    if (policy?.allowNetworks?.length) {
      filtered = filtered.filter((w) => policy.allowNetworks.includes(w.network));
    }
    if (policy?.allowAssets?.length) {
      filtered = filtered.filter((w) => policy.allowAssets.includes(w.asset));
    }
    filtered = filtered.filter((w) => w.network === params.network && w.asset === params.asset);
    return filtered[0] || null;
  }

  async createTreasurySignRequest(params: {
    orgId: string;
    walletId?: string;
    userId?: string;
    endpoint: string;
    requestHash: string;
    idempotencyKey?: string;
    network: string;
    asset: string;
    destination: string;
    amountAtomic: string;
    amountUsd?: number;
    metadata?: any;
  }): Promise<string> {
    const id = `tsr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await this.run(
      `INSERT INTO treasury_sign_requests
         (id, org_id, wallet_id, user_id, endpoint, request_hash, idempotency_key, network, asset, destination, amount_atomic, amount_usd, status, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        id,
        params.orgId,
        params.walletId || null,
        params.userId || null,
        params.endpoint,
        params.requestHash,
        params.idempotencyKey || null,
        params.network,
        params.asset,
        params.destination,
        params.amountAtomic,
        params.amountUsd ?? null,
        params.metadata ? JSON.stringify(params.metadata) : null,
        new Date(),
        new Date(),
      ]
    );
    return id;
  }

  async updateTreasurySignRequest(id: string, updates: {
    status?: string;
    txSignature?: string;
    providerStatus?: number;
    errorMessage?: string;
    metadata?: any;
  }): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.txSignature !== undefined) { fields.push('tx_signature = ?'); values.push(updates.txSignature); }
    if (updates.providerStatus !== undefined) { fields.push('provider_status = ?'); values.push(updates.providerStatus); }
    if (updates.errorMessage !== undefined) { fields.push('error_message = ?'); values.push(updates.errorMessage); }
    if (updates.metadata !== undefined) { fields.push('metadata = ?'); values.push(updates.metadata ? JSON.stringify(updates.metadata) : null); }
    if (!fields.length) return;
    fields.push('updated_at = ?');
    values.push(new Date());
    values.push(id);
    await this.run(`UPDATE treasury_sign_requests SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  async listTreasurySignRequests(params: { orgId: string; status?: string; limit?: number }): Promise<any[]> {
    let sql = 'SELECT * FROM treasury_sign_requests WHERE org_id = ?';
    const values: any[] = [params.orgId];
    if (params.status) {
      sql += ' AND status = ?';
      values.push(params.status);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    values.push(params.limit || 100);
    return this.all(sql, values);
  }

  // ── Approval Reviewers ────────────────────────────────────────────────────────

  async getApprovalReviewers(): Promise<Array<{ id: string; email: string; name?: string; role: string; active: boolean }>> {
    const rows = await this.all(
      `SELECT id, email, name, role FROM users
       WHERE role IN ('admin', 'manager', 'reviewer')
       ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, name ASC`
    );
    return rows.map(r => ({ id: r.id, email: r.email, name: r.name ?? undefined, role: r.role, active: true }));
  }

  async addApprovalReviewer(userId: string, role = 'reviewer'): Promise<void> {
    await this.run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [role, new Date(), userId]);
  }

  async removeApprovalReviewer(userId: string): Promise<void> {
    await this.run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', ['user', new Date(), userId]);
  }

  async updateReviewerRole(userId: string, role: string): Promise<void> {
    await this.run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [role, new Date(), userId]);
  }

  // ── OTP ───────────────────────────────────────────────────────────────────────

  async setVerificationCode(email: string, code: string, expiresAt: Date): Promise<void> {
    await this.run(
      'UPDATE users SET verification_code = ?, verification_code_expires = ?, updated_at = ? WHERE email = ?',
      [code, expiresAt, new Date(), email]
    );
  }

  async verifyAndClearCode(email: string, code: string): Promise<{ valid: boolean; reason?: string }> {
    const user = await this.one(
      'SELECT verification_code, verification_code_expires FROM users WHERE email = ?',
      [email]
    );
    if (!user) return { valid: false, reason: 'User not found' };
    if (!user.verification_code || !user.verification_code_expires)
      return { valid: false, reason: 'No verification code found. Please request a new one.' };
    if (new Date(user.verification_code_expires) < new Date())
      return { valid: false, reason: 'Verification code has expired. Please request a new one.' };
    if (user.verification_code !== code)
      return { valid: false, reason: 'Invalid verification code' };

    await this.run(
      'UPDATE users SET verification_code = NULL, verification_code_expires = NULL, updated_at = ? WHERE email = ?',
      [new Date(), email]
    );
    return { valid: true };
  }

  // ── User Event Log (data lake) ─────────────────────────────────────────────────

  logEvent(params: {
    userId: string; eventType: string; sessionId?: string; source?: string;
    rawInput?: string; intent?: string; productName?: string; category?: string;
    merchant?: string; amount?: number; outcome?: string; policyId?: string;
    blockReason?: string; metadata?: Record<string, any>;
  }): void {
    const { randomUUID } = require('crypto');
    this.run(
      `INSERT INTO user_events
         (id, user_id, session_id, event_type, source, raw_input, intent,
          product_name, category, merchant, amount, outcome, policy_id,
          block_reason, metadata, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        randomUUID(), params.userId, params.sessionId ?? null, params.eventType,
        params.source ?? 'api', params.rawInput ?? null, params.intent ?? null,
        params.productName ?? null, params.category ?? null, params.merchant ?? null,
        params.amount ?? null, params.outcome ?? null, params.policyId ?? null,
        params.blockReason ?? null,
        params.metadata ? JSON.stringify(params.metadata) : null,
        new Date(),
      ]
    ).catch(err => console.error('[logEvent] failed silently:', err?.message));
  }

  async getUserEvents(userId: string, options: { limit?: number; eventType?: string; since?: string } = {}): Promise<any[]> {
    const { limit = 200, eventType, since } = options;
    let sql = 'SELECT * FROM user_events WHERE user_id = ?';
    const args: any[] = [userId];
    if (eventType) { sql += ' AND event_type = ?'; args.push(eventType); }
    if (since)     { sql += ' AND created_at >= ?'; args.push(since); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    args.push(limit);
    return this.all(sql, args);
  }

  async getAllUserEvents(options: { limit?: number; since?: string } = {}): Promise<any[]> {
    const { limit = 1000, since } = options;
    let sql = 'SELECT * FROM user_events';
    const args: any[] = [];
    if (since) { sql += ' WHERE created_at >= ?'; args.push(since); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    args.push(limit);
    return this.all(sql, args);
  }

  async synthesizeUserProfile(userId: string): Promise<void> {
    try {
    const now = new Date();
      const ago30d = new Date(Date.now() - 30 * 86400000);
      const ago7d  = new Date(Date.now() -  7 * 86400000);

      const events = await this.all('SELECT * FROM user_events WHERE user_id = ?', [userId]);
      if (!events.length) return;

      const purchases   = events.filter(e => e.event_type === 'purchase_completed');
      const blocked     = events.filter(e => e.event_type === 'purchase_blocked');
      const queries     = events.filter(e => e.event_type === 'chatgpt_query');
      const purchases30d = purchases.filter(e => new Date(e.created_at) >= ago30d);
      const purchases7d  = purchases.filter(e => new Date(e.created_at) >= ago7d);

      const totalSpendLifetime = purchases.reduce((s, e) => s + Number(e.amount || 0), 0);
      const totalSpend30d      = purchases30d.reduce((s, e) => s + Number(e.amount || 0), 0);
      const totalSpend7d       = purchases7d.reduce((s, e) => s + Number(e.amount || 0), 0);
      const blockRate          = events.length ? blocked.length / events.length : 0;
      const avgTx              = purchases.length ? totalSpendLifetime / purchases.length : 0;
      const largestPurchase    = purchases.reduce((m, e) => Math.max(m, Number(e.amount || 0)), 0);

      const catCount: Record<string, number> = {};
      purchases.forEach(e => { if (e.category) catCount[e.category] = (catCount[e.category] || 0) + 1; });
      const topCategories = Object.entries(catCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);

      const merCount: Record<string, number> = {};
      purchases.forEach(e => { if (e.merchant) merCount[e.merchant] = (merCount[e.merchant] || 0) + 1; });
      const topMerchants = Object.entries(merCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);

      const reasonCount: Record<string, number> = {};
      blocked.forEach(e => { if (e.block_reason) reasonCount[e.block_reason] = (reasonCount[e.block_reason] || 0) + 1; });
      const topReason = Object.entries(reasonCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      const firstSeen = events[events.length - 1]?.created_at ?? now;
      const daysSince = Math.max(1, (Date.now() - new Date(firstSeen).getTime()) / 86400000);
      const queriesPerDay = queries.length / daysSince;
      const lastActive = events[0]?.created_at ?? now;

      await this.run(
        `INSERT INTO user_profiles
           (user_id, total_spend_lifetime, total_spend_30d, total_spend_7d,
            total_queries, total_purchases, total_blocked, block_rate,
            avg_transaction_amount, largest_purchase, top_categories, top_merchants,
            most_common_block_reason, queries_per_day, first_seen, last_active,
            last_synthesized_at, event_count)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (user_id) DO UPDATE SET
           total_spend_lifetime     = EXCLUDED.total_spend_lifetime,
           total_spend_30d          = EXCLUDED.total_spend_30d,
           total_spend_7d           = EXCLUDED.total_spend_7d,
           total_queries            = EXCLUDED.total_queries,
           total_purchases          = EXCLUDED.total_purchases,
           total_blocked            = EXCLUDED.total_blocked,
           block_rate               = EXCLUDED.block_rate,
           avg_transaction_amount   = EXCLUDED.avg_transaction_amount,
           largest_purchase         = EXCLUDED.largest_purchase,
           top_categories           = EXCLUDED.top_categories,
           top_merchants            = EXCLUDED.top_merchants,
           most_common_block_reason = EXCLUDED.most_common_block_reason,
           queries_per_day          = EXCLUDED.queries_per_day,
           first_seen               = EXCLUDED.first_seen,
           last_active              = EXCLUDED.last_active,
           last_synthesized_at      = EXCLUDED.last_synthesized_at,
           event_count              = EXCLUDED.event_count`,
        [
          userId, totalSpendLifetime, totalSpend30d, totalSpend7d,
          queries.length, purchases.length, blocked.length, blockRate,
          avgTx, largestPurchase,
          JSON.stringify(topCategories), JSON.stringify(topMerchants),
          topReason, queriesPerDay, firstSeen, lastActive, now, events.length,
        ]
      );
    } catch (err: any) {
      console.error('[synthesizeUserProfile] failed:', err?.message);
    }
  }

  async getUserProfile(userId: string): Promise<any> {
    const profile = await this.one('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
    if (!profile) return null;
    return {
      ...profile,
      top_categories: JSON.parse(profile.top_categories || '[]'),
      top_merchants:  JSON.parse(profile.top_merchants  || '[]'),
    };
  }
}

// ── Row mappers ───────────────────────────────────────────────────────────────

function mapPolicy(row: any): Policy {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    priority: row.priority,
    transactionTypes: row.transaction_types ? JSON.parse(row.transaction_types) : ['agent-to-merchant'],
    conditions: JSON.parse(row.conditions),
    rules: JSON.parse(row.rules),
  };
}

function mapPurchase(row: any): any {
  return {
    id: row.id,
    userId: row.user_id,
    productId: row.product_id,
    productName: row.product_name || row.product_id,
    amount: Number(row.amount),
    merchant: row.merchant,
    category: row.category,
    allowed: row.allowed,
    requiresApproval: row.requires_approval ?? false,
    checkoutMethod: row.checkout_method || 'traditional',
    approvalStatus: row.approval_status,
    policyResults: JSON.parse(row.policy_results || '[]'),
    timestamp: row.timestamp,
  };
}

function mapAgent(row: any): any {
    return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    baseUrl: row.base_url,
    services: JSON.parse(row.services),
    serviceDescription: row.service_description,
    acceptedCurrencies: JSON.parse(row.accepted_currencies),
    usdcTokenAccount: row.usdc_token_account,
    solanaPubkey: row.solana_pubkey,
    active: row.active,
    verified: row.verified,
    ownerId: row.owner_id,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function periodStart(period: 'daily' | 'weekly' | 'monthly'): Date {
  const now = new Date();
  switch (period) {
    case 'daily':   return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'weekly': {
      const d = new Date(now);
      d.setDate(now.getDate() - now.getDay());
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case 'monthly': return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}

export default DB;
