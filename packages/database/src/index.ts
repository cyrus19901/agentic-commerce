import { Pool, PoolClient } from 'pg';
import { Policy } from '@agentic-commerce/shared';

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

  async getActivePolicies(_userId?: string): Promise<Policy[]> {
    const rows = await this.all(
      'SELECT * FROM policies WHERE enabled = true ORDER BY priority DESC'
    );
    return rows.map(mapPolicy);
  }

  async getAllPolicies(): Promise<Policy[]> {
    const rows = await this.all(
      'SELECT * FROM policies ORDER BY priority DESC, created_at DESC'
    );
    return rows.map(mapPolicy);
  }

  async getPolicyById(id: string): Promise<Policy | null> {
    const row = await this.one('SELECT * FROM policies WHERE id = ?', [id]);
    return row ? mapPolicy(row) : null;
  }

  async createPolicy(policy: Policy): Promise<void> {
    const now = new Date();
    const transactionTypes = policy.conditions?.transactionType || ['agent-to-merchant'];
    await this.run(
      `INSERT INTO policies (id, name, type, enabled, priority, transaction_types, conditions, rules, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        policy.id, policy.name, policy.type, policy.enabled, policy.priority,
        JSON.stringify(transactionTypes),
        JSON.stringify(policy.conditions),
        JSON.stringify(policy.rules),
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

  async getUserByEmail(email: string): Promise<{ id: string; email: string; name?: string } | null> {
    const row = await this.one('SELECT * FROM users WHERE email = ?', [email]);
    if (!row) return null;
    return { id: row.id, email: row.email, name: row.name ?? undefined };
  }

  async getUserById(id: string): Promise<{ id: string; email: string; name?: string } | null> {
    const row = await this.one('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) return null;
    return { id: row.id, email: row.email, name: row.name ?? undefined };
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  async getUserWallet(userId: string): Promise<{ userId: string; publicKey: string; secretKey: number[] } | null> {
    const row = await this.one('SELECT * FROM user_wallets WHERE user_id = ?', [userId]);
    if (!row) return null;
    return {
      userId: row.user_id,
      publicKey: row.public_key,
      secretKey: JSON.parse(Buffer.from(row.encrypted_secret, 'base64').toString('utf-8')),
    };
  }

  async saveUserWallet(wallet: { userId: string; publicKey: string; secretKey: number[] }): Promise<void> {
    const encryptedSecret = Buffer.from(JSON.stringify(wallet.secretKey)).toString('base64');
    const id = `wallet_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    await this.run(
      'INSERT INTO user_wallets (id, user_id, public_key, encrypted_secret, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, wallet.userId, wallet.publicKey, encryptedSecret, new Date()]
    );
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
