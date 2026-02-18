// TODO: Uncomment when migrating to PostgreSQL + Prisma
// export { prisma } from './prisma-client.js';
// export { PolicyEngine } from './policy-engine.js';

// Legacy DB class (currently in use with SQLite)
// @ts-ignore - better-sqlite3 types may not be available during build
import Database from 'better-sqlite3';
import { Policy } from '@agentic-commerce/shared';

export class DB {
  private db: any;

  constructor(path: string = './data/shopping.db') {
    try {
      console.log(`📊 Initializing database at: ${path}`);
      
      // Ensure directory exists
      const fs = require('fs');
      const pathModule = require('path');
      const dir = pathModule.dirname(path);
      
      if (!fs.existsSync(dir)) {
        console.log(`📁 Creating directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
      }
      
      console.log(`🔗 Connecting to database...`);
      this.db = new Database(path);
      console.log(`✓ Database connected successfully`);
      
      this.initialize();
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

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
        product_name TEXT,
        amount REAL NOT NULL,
        merchant TEXT NOT NULL,
        category TEXT,
        allowed INTEGER NOT NULL,
        requires_approval INTEGER DEFAULT 0,
        policy_results TEXT NOT NULL,
        checkout_method TEXT DEFAULT 'traditional',
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_user_timestamp 
        ON purchase_attempts(user_id, timestamp);
      
      CREATE INDEX IF NOT EXISTS idx_users_email 
        ON users(email);
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
    // Check if requires_approval column exists, if not, add it
    try {
      this.db.prepare('SELECT requires_approval FROM purchase_attempts LIMIT 1').get();
    } catch (e) {
      // Column doesn't exist, add it
      try {
        this.db.prepare('ALTER TABLE purchase_attempts ADD COLUMN requires_approval INTEGER DEFAULT 0').run();
        this.db.prepare('ALTER TABLE purchase_attempts ADD COLUMN product_name TEXT').run();
      } catch (alterError) {
        // Column might already exist, ignore
      }
    }

    // Check if checkout_method column exists
    try {
      this.db.prepare('SELECT checkout_method FROM purchase_attempts LIMIT 1').get();
    } catch (e) {
      // Column doesn't exist, add it
      try {
        this.db.prepare('ALTER TABLE purchase_attempts ADD COLUMN checkout_method TEXT DEFAULT "traditional"').run();
      } catch (alterError) {
        // Column might already exist, ignore
      }
    }

    this.db.prepare(`
      INSERT INTO purchase_attempts 
      (user_id, product_id, product_name, amount, merchant, category, allowed, requires_approval, policy_results, checkout_method, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      attempt.userId,
      attempt.productId,
      attempt.productName || null,
      attempt.amount,
      attempt.merchant,
      attempt.category || null,
      attempt.allowed ? 1 : 0,
      attempt.requiresApproval ? 1 : 0,
      JSON.stringify(attempt.policyCheckResults || []),
      attempt.checkoutMethod || 'traditional',
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

  async getAllPolicies(): Promise<Policy[]> {
    const rows = this.db.prepare('SELECT * FROM policies ORDER BY priority DESC, created_at DESC').all();
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

  async getPolicyById(id: string): Promise<Policy | null> {
    const row = this.db.prepare('SELECT * FROM policies WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      enabled: row.enabled === 1,
      priority: row.priority,
      conditions: JSON.parse(row.conditions),
      rules: JSON.parse(row.rules),
    };
  }

  async updatePolicy(policy: Policy): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE policies 
      SET name = ?, type = ?, enabled = ?, priority = ?, conditions = ?, rules = ?, updated_at = ?
      WHERE id = ?
    `).run(
      policy.name,
      policy.type,
      policy.enabled ? 1 : 0,
      policy.priority,
      JSON.stringify(policy.conditions),
      JSON.stringify(policy.rules),
      now,
      policy.id
    );
  }

  async deletePolicy(id: string): Promise<void> {
    this.db.prepare('DELETE FROM policies WHERE id = ?').run(id);
  }

  /**
   * Get all policies assigned to a user
   */
  async getUserPolicies(userId: string): Promise<Policy[]> {
    const rows = this.db.prepare(`
      SELECT p.* 
      FROM policies p
      INNER JOIN user_policies up ON p.id = up.policy_id
      WHERE up.user_id = ?
      ORDER BY p.priority DESC, p.created_at DESC
    `).all(userId) as any[];

    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      enabled: row.enabled === 1,
      priority: row.priority,
      conditions: JSON.parse(row.conditions || '{}'),
      rules: JSON.parse(row.rules || '{}'),
    }));
  }

  /**
   * Assign a policy to a user
   */
  async assignPolicyToUser(userId: string, policyId: string): Promise<void> {
    const id = `user-policy-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();
    
    this.db.prepare(`
      INSERT INTO user_policies (id, user_id, policy_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, userId, policyId, now);
  }

  /**
   * Remove a policy from a user
   */
  async removePolicyFromUser(userId: string, policyId: string): Promise<void> {
    this.db.prepare(`
      DELETE FROM user_policies 
      WHERE user_id = ? AND policy_id = ?
    `).run(userId, policyId);
  }

  async getPurchaseHistory(userId?: string, limit: number = 50): Promise<any[]> {
    // Check if new columns exist
    let hasProductName = false;
    let hasRequiresApproval = false;
    let hasCheckoutMethod = false;
    try {
      const testRow = this.db.prepare('SELECT product_name, requires_approval, checkout_method FROM purchase_attempts LIMIT 1').get();
      hasProductName = testRow !== undefined;
      hasRequiresApproval = testRow !== undefined;
      hasCheckoutMethod = testRow !== undefined;
    } catch (e) {
      // Columns don't exist yet
    }

    let query = `
      SELECT 
        id,
        user_id,
        product_id,
        ${hasProductName ? 'product_name,' : ''}
        amount,
        merchant,
        category,
        allowed,
        ${hasRequiresApproval ? 'requires_approval,' : ''}
        ${hasCheckoutMethod ? 'checkout_method,' : ''}
        policy_results,
        timestamp
      FROM purchase_attempts
    `;
    
    const params: any[] = [];
    if (userId) {
      query += ' WHERE user_id = ?';
      params.push(userId);
    }
    
    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);
    
    const rows = this.db.prepare(query).all(...params);
    return rows.map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      productId: row.product_id,
      productName: row.product_name || row.product_id,
      amount: row.amount,
      merchant: row.merchant,
      category: row.category,
      allowed: row.allowed === 1,
      requiresApproval: hasRequiresApproval ? (row.requires_approval === 1) : false,
      checkoutMethod: hasCheckoutMethod ? (row.checkout_method || 'traditional') : 'traditional',
      policyResults: JSON.parse(row.policy_results || '[]'),
      timestamp: row.timestamp,
    }));
  }

  async getApprovalAccuracy(userId?: string): Promise<{
    totalSuggestions: number;
    accepted: number;
    rejected: number;
    requiresApproval: number;
    accuracy: number;
  }> {
    // Check if requires_approval column exists
    let hasRequiresApproval = false;
    try {
      this.db.prepare('SELECT requires_approval FROM purchase_attempts LIMIT 1').get();
      hasRequiresApproval = true;
    } catch (e) {
      // Column doesn't exist yet
    }

    let query = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN allowed = 1 THEN 1 ELSE 0 END) as accepted,
        SUM(CASE WHEN allowed = 0 THEN 1 ELSE 0 END) as rejected
        ${hasRequiresApproval ? ', SUM(CASE WHEN requires_approval = 1 THEN 1 ELSE 0 END) as requires_approval_count' : ''}
      FROM purchase_attempts
    `;
    
    const params: any[] = [];
    if (userId) {
      query += ' WHERE user_id = ?';
      params.push(userId);
    }
    
    const result = this.db.prepare(query).get(...params) as any;
    
    const total = result.total || 0;
    const accepted = result.accepted || 0;
    const rejected = result.rejected || 0;
    let requiresApprovalCount = hasRequiresApproval ? (result.requires_approval_count || 0) : 0;
    
    // If column doesn't exist, check policy_results for approval requirements
    if (!hasRequiresApproval && total > 0) {
      const allAttempts = await this.getPurchaseHistory(userId, 1000);
      for (const attempt of allAttempts) {
        // Check if any policy result indicates approval was required
        const hasRequiresApproval = attempt.policyResults.some((p: any) => 
          p.reason?.toLowerCase().includes('approval required') ||
          p.reason?.toLowerCase().includes('manual approval') ||
          p.reason?.toLowerCase().includes('no matching conditions')
        );
        if (hasRequiresApproval) {
          requiresApprovalCount++;
        }
      }
    }
    
    // Approval accuracy = (accepted / requiresApproval) * 100
    // Only count transactions that required approval
    const accuracy = requiresApprovalCount > 0 
      ? Math.round((accepted / requiresApprovalCount) * 100) 
      : total > 0 
        ? Math.round((accepted / total) * 100)
        : 0;
    
    return {
      totalSuggestions: total,
      accepted,
      rejected,
      requiresApproval: requiresApprovalCount,
      accuracy,
    };
  }

  // ============================================================================
  // User Management Methods
  // ============================================================================

  /**
   * Create or get a user by email
   * Returns existing user if found, creates new one if not
   */
  async createOrGetUser(email: string, name?: string): Promise<{ id: string; email: string; name?: string }> {
    // Check if user exists
    const existing = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    
    if (existing) {
      // Update name if provided and different
      if (name && name !== existing.name) {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').run(name, now, existing.id);
        return { id: existing.id, email: existing.email, name };
      }
      return { id: existing.id, email: existing.email, name: existing.name };
    }

    // Create new user with try-catch to handle UNIQUE constraint violations
    const userId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();
    
    try {
      this.db.prepare(`
        INSERT INTO users (id, email, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, email, name || null, now, now);

      return { id: userId, email, name: name || undefined };
    } catch (error: any) {
      // If UNIQUE constraint fails, try to get existing user again (race condition)
      if (error.message?.includes('UNIQUE') || error.code === 'SQLITE_CONSTRAINT') {
        const existingAfterError = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
        if (existingAfterError) {
          console.log(`✓ User already exists (race condition caught): ${email}`);
          return { id: existingAfterError.id, email: existingAfterError.email, name: existingAfterError.name };
        }
      }
      throw error;
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<{ id: string; email: string; name?: string } | null> {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    if (!row) return null;
    return { id: row.id, email: row.email, name: row.name || undefined };
  }

  /**
   * Get user by ID
   */
  async getUserById(id: string): Promise<{ id: string; email: string; name?: string } | null> {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!row) return null;
    return { id: row.id, email: row.email, name: row.name || undefined };
  }

  /**
   * List all users
   */
  async getAllUsers(): Promise<{ id: string; email: string; name?: string }[]> {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
    return rows.map((row: any) => ({
      id: row.id,
      email: row.email,
      name: row.name || undefined,
    }));
  }

  /**
   * Clean up duplicate users (keep oldest, merge policies/purchases)
   */
  async cleanupDuplicateUsers(): Promise<{
    duplicatesFound: Array<{ email: string; userIds: string[] }>;
    usersDeleted: string[];
    policiesMigrated: number;
    purchasesMigrated: number;
    errors: string[];
  }> {
    const results = {
      duplicatesFound: [] as Array<{ email: string; userIds: string[] }>,
      usersDeleted: [] as string[],
      policiesMigrated: 0,
      purchasesMigrated: 0,
      errors: [] as string[]
    };

    // Find duplicate emails
    const duplicateEmails = this.db.prepare(`
      SELECT email, COUNT(*) as count, GROUP_CONCAT(id) as user_ids
      FROM users
      GROUP BY email
      HAVING count > 1
    `).all() as Array<{ email: string; count: number; user_ids: string }>;

    for (const dup of duplicateEmails) {
      const userIds = dup.user_ids.split(',');
      results.duplicatesFound.push({ email: dup.email, userIds });
      
      // Get all users with this email, sorted by creation date (keep oldest)
      const users = this.db.prepare('SELECT * FROM users WHERE email = ? ORDER BY created_at ASC').all(dup.email) as any[];
      
      if (users.length < 2) continue;
      
      const keepUser = users[0];
      const deleteUsers = users.slice(1);

      for (const delUser of deleteUsers) {
        // Migrate policies
        const policies = this.db.prepare('SELECT * FROM user_policies WHERE user_id = ?').all(delUser.id) as any[];
        
        for (const policy of policies) {
          try {
            const existing = this.db.prepare(
              'SELECT * FROM user_policies WHERE user_id = ? AND policy_id = ?'
            ).get(keepUser.id, policy.policy_id);
            
            if (!existing) {
              this.db.prepare('UPDATE user_policies SET user_id = ? WHERE id = ?').run(keepUser.id, policy.id);
              results.policiesMigrated++;
            } else {
              this.db.prepare('DELETE FROM user_policies WHERE id = ?').run(policy.id);
            }
          } catch (error: any) {
            results.errors.push(`Policy migration error: ${error.message}`);
          }
        }
        
        // Migrate purchase attempts
        const purchaseCount = this.db.prepare('SELECT COUNT(*) as count FROM purchase_attempts WHERE user_id = ?').get(delUser.id) as { count: number };
        if (purchaseCount.count > 0) {
          this.db.prepare('UPDATE purchase_attempts SET user_id = ? WHERE user_id = ?').run(keepUser.id, delUser.id);
          results.purchasesMigrated += purchaseCount.count;
        }
        
        // Delete duplicate user
        this.db.prepare('DELETE FROM users WHERE id = ?').run(delUser.id);
        results.usersDeleted.push(delUser.id);
      }
    }

    return results;
  }

  // ============================================================================
  // Approval Management Methods
  // ============================================================================

  /**
   * Get pending approvals (purchases that require approval but haven't been decided yet)
   */
  async getPendingApprovals(userId?: string): Promise<any[]> {
    // Check if requires_approval and approval_status columns exist
    let hasRequiresApproval = false;
    let hasApprovalStatus = false;
    try {
      this.db.prepare('SELECT requires_approval FROM purchase_attempts LIMIT 1').get();
      hasRequiresApproval = true;
    } catch (e) {
      // Column doesn't exist
    }

    try {
      this.db.prepare('SELECT approval_status FROM purchase_attempts LIMIT 1').get();
      hasApprovalStatus = true;
    } catch (e) {
      // Column doesn't exist, add it
      try {
        this.db.prepare('ALTER TABLE purchase_attempts ADD COLUMN approval_status TEXT DEFAULT NULL').run();
        hasApprovalStatus = true;
      } catch (alterError) {
        // Ignore if already exists
      }
    }

    if (!hasRequiresApproval) {
      return []; // No approval tracking yet
    }

    let query = `
      SELECT 
        id,
        user_id,
        product_id,
        product_name,
        amount,
        merchant,
        category,
        requires_approval,
        ${hasApprovalStatus ? 'approval_status,' : ''}
        policy_results,
        timestamp
      FROM purchase_attempts
      WHERE requires_approval = 1
    `;

    // Only show pending approvals (not already approved or rejected)
    if (hasApprovalStatus) {
      query += " AND (approval_status IS NULL OR approval_status = 'pending')";
    }

    const params: any[] = [];
    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }

    query += ' ORDER BY timestamp DESC';

    const rows = this.db.prepare(query).all(...params);
    return rows.map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      productId: row.product_id,
      productName: row.product_name || row.product_id,
      amount: row.amount,
      merchant: row.merchant,
      category: row.category,
      requiresApproval: row.requires_approval === 1,
      approvalStatus: hasApprovalStatus ? row.approval_status : 'pending',
      policyResults: JSON.parse(row.policy_results || '[]'),
      timestamp: row.timestamp,
    }));
  }

  /**
   * Get purchase by ID
   */
  async getPurchaseById(purchaseId: number): Promise<any | null> {
    const row = this.db.prepare(`
      SELECT 
        id,
        user_id,
        product_id,
        product_name,
        amount,
        merchant,
        category,
        allowed,
        requires_approval,
        approval_status,
        policy_results,
        timestamp,
        checkout_method,
        product_url,
        product_image_url
      FROM purchase_attempts
      WHERE id = ?
    `).get(purchaseId) as any;

    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      productId: row.product_id,
      productName: row.product_name || row.product_id,
      amount: row.amount,
      merchant: row.merchant,
      category: row.category,
      allowed: row.allowed === 1,
      requiresApproval: row.requires_approval === 1,
      approval_status: row.approval_status,
      policyResults: JSON.parse(row.policy_results || '[]'),
      timestamp: row.timestamp,
      checkoutMethod: row.checkout_method,
      productUrl: row.product_url,
      productImageUrl: row.product_image_url
    };
  }

  /**
   * Approve a purchase that requires approval
   */
  async approvePurchase(purchaseId: number): Promise<void> {
    // Ensure approval_status column exists
    try {
      this.db.prepare('SELECT approval_status FROM purchase_attempts LIMIT 1').get();
    } catch (e) {
      try {
        this.db.prepare('ALTER TABLE purchase_attempts ADD COLUMN approval_status TEXT DEFAULT NULL').run();
      } catch (alterError) {
        // Ignore if already exists
      }
    }

    this.db.prepare(`
      UPDATE purchase_attempts 
      SET allowed = 1, approval_status = 'approved'
      WHERE id = ?
    `).run(purchaseId);
  }

  /**
   * Reject a purchase that requires approval
   */
  async rejectPurchase(purchaseId: number, reason?: string): Promise<void> {
    // Ensure approval_status column exists
    try {
      this.db.prepare('SELECT approval_status FROM purchase_attempts LIMIT 1').get();
    } catch (e) {
      try {
        this.db.prepare('ALTER TABLE purchase_attempts ADD COLUMN approval_status TEXT DEFAULT NULL').run();
      } catch (alterError) {
        // Ignore if already exists
      }
    }

    this.db.prepare(`
      UPDATE purchase_attempts 
      SET allowed = 0, approval_status = 'rejected'
      WHERE id = ?
    `).run(purchaseId);
  }

  // Get policy compliance statistics
  async getPolicyComplianceStats(userId?: string): Promise<{
    totalSpend: number;
    inPolicySpend: number;
    outOfPolicySpend: number;
    compliancePercentage: number;
    totalTransactions: number;
    approvedTransactions: number;
    deniedTransactions: number;
    pendingApprovals: number;
    trend: number; // Percentage change from previous period
  }> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // Current month stats - properly handle approval_status
    const currentQuery = userId 
      ? `SELECT 
          COALESCE(SUM(amount), 0) as total_spend,
          COALESCE(SUM(CASE WHEN allowed = 1 OR approval_status = 'approved' THEN amount ELSE 0 END), 0) as in_policy_spend,
          COALESCE(SUM(CASE WHEN allowed = 0 AND (approval_status IS NULL OR approval_status != 'approved') THEN amount ELSE 0 END), 0) as out_policy_spend,
          COUNT(*) as total_transactions,
          SUM(CASE WHEN approval_status = 'approved' OR (allowed = 1 AND requires_approval = 0) THEN 1 ELSE 0 END) as approved_transactions,
          SUM(CASE WHEN approval_status = 'rejected' OR (allowed = 0 AND requires_approval = 0) THEN 1 ELSE 0 END) as denied_transactions,
          SUM(CASE WHEN requires_approval = 1 AND (approval_status IS NULL OR approval_status = 'pending') THEN 1 ELSE 0 END) as pending_approvals
        FROM purchase_attempts 
        WHERE user_id = ? AND timestamp >= ?`
      : `SELECT 
          COALESCE(SUM(amount), 0) as total_spend,
          COALESCE(SUM(CASE WHEN allowed = 1 OR approval_status = 'approved' THEN amount ELSE 0 END), 0) as in_policy_spend,
          COALESCE(SUM(CASE WHEN allowed = 0 AND (approval_status IS NULL OR approval_status != 'approved') THEN amount ELSE 0 END), 0) as out_policy_spend,
          COUNT(*) as total_transactions,
          SUM(CASE WHEN approval_status = 'approved' OR (allowed = 1 AND requires_approval = 0) THEN 1 ELSE 0 END) as approved_transactions,
          SUM(CASE WHEN approval_status = 'rejected' OR (allowed = 0 AND requires_approval = 0) THEN 1 ELSE 0 END) as denied_transactions,
          SUM(CASE WHEN requires_approval = 1 AND (approval_status IS NULL OR approval_status = 'pending') THEN 1 ELSE 0 END) as pending_approvals
        FROM purchase_attempts 
        WHERE timestamp >= ?`;

    const currentStats = userId
      ? this.db.prepare(currentQuery).get(userId, startOfMonth.toISOString())
      : this.db.prepare(currentQuery).get(startOfMonth.toISOString());

    // Last month stats for trend calculation
    const lastMonthQuery = userId
      ? `SELECT COALESCE(SUM(amount), 0) as total_spend
         FROM purchase_attempts 
         WHERE user_id = ? AND timestamp >= ? AND timestamp <= ?`
      : `SELECT COALESCE(SUM(amount), 0) as total_spend
         FROM purchase_attempts 
         WHERE timestamp >= ? AND timestamp <= ?`;

    const lastMonthStats = userId
      ? this.db.prepare(lastMonthQuery).get(userId, startOfLastMonth.toISOString(), endOfLastMonth.toISOString())
      : this.db.prepare(lastMonthQuery).get(startOfLastMonth.toISOString(), endOfLastMonth.toISOString());

    const totalSpend = currentStats.total_spend || 0;
    const inPolicySpend = currentStats.in_policy_spend || 0;
    const compliancePercentage = totalSpend > 0 ? (inPolicySpend / totalSpend) * 100 : 100;

    // Calculate trend
    const lastMonthSpend = lastMonthStats.total_spend || 0;
    const trend = lastMonthSpend > 0 
      ? ((totalSpend - lastMonthSpend) / lastMonthSpend) * 100 
      : 0;

    return {
      totalSpend,
      inPolicySpend,
      outOfPolicySpend: currentStats.out_policy_spend || 0,
      compliancePercentage: Math.round(compliancePercentage * 10) / 10,
      totalTransactions: currentStats.total_transactions || 0,
      approvedTransactions: currentStats.approved_transactions || 0,
      deniedTransactions: currentStats.denied_transactions || 0,
      pendingApprovals: currentStats.pending_approvals || 0,
      trend: Math.round(trend * 10) / 10,
    };
  }

  // Get policy analytics for a specific policy
  async getPolicyAnalytics(policyId: string, userId?: string): Promise<{
    policyId: string;
    policyName: string;
    totalChecks: number;
    passed: number;
    failed: number;
    successRate: number;
    impactedSpend: number;
  }> {
    const policy = await this.getPolicyById(policyId);
    if (!policy) {
      throw new Error(`Policy ${policyId} not found`);
    }

    const query = userId
      ? `SELECT 
          COUNT(*) as total_checks,
          SUM(CASE WHEN policy_results LIKE '%"id":"${policyId}"%"passed":true%' THEN 1 ELSE 0 END) as passed,
          SUM(CASE WHEN policy_results LIKE '%"id":"${policyId}"%"passed":false%' THEN 1 ELSE 0 END) as failed,
          COALESCE(SUM(CASE WHEN policy_results LIKE '%"id":"${policyId}"%' THEN amount ELSE 0 END), 0) as impacted_spend
         FROM purchase_attempts
         WHERE user_id = ?`
      : `SELECT 
          COUNT(*) as total_checks,
          SUM(CASE WHEN policy_results LIKE '%"id":"${policyId}"%"passed":true%' THEN 1 ELSE 0 END) as passed,
          SUM(CASE WHEN policy_results LIKE '%"id":"${policyId}"%"passed":false%' THEN 1 ELSE 0 END) as failed,
          COALESCE(SUM(CASE WHEN policy_results LIKE '%"id":"${policyId}"%' THEN amount ELSE 0 END), 0) as impacted_spend
         FROM purchase_attempts`;

    const stats = userId
      ? this.db.prepare(query).get(userId)
      : this.db.prepare(query).get();

    const totalChecks = stats.total_checks || 0;
    const passed = stats.passed || 0;
    const successRate = totalChecks > 0 ? (passed / totalChecks) * 100 : 0;

    return {
      policyId,
      policyName: policy.name,
      totalChecks,
      passed,
      failed: stats.failed || 0,
      successRate: Math.round(successRate * 10) / 10,
      impactedSpend: stats.impacted_spend || 0,
    };
  }
}

export default DB;
