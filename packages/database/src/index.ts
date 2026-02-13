// TODO: Uncomment when migrating to PostgreSQL + Prisma
// export { prisma } from './prisma-client.js';
// export { PolicyEngine } from './policy-engine.js';

// Legacy DB class (currently in use with SQLite)
// @ts-ignore - better-sqlite3 types may not be available during build
import Database from 'better-sqlite3';
import { Policy } from '@agentic-commerce/shared';

export class DB {
  public db: any;

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
        transaction_types TEXT NOT NULL DEFAULT '["agent-to-merchant"]',
        conditions TEXT NOT NULL,
        rules TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_policies (
        user_id TEXT NOT NULL,
        policy_id TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, policy_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (policy_id) REFERENCES policies(id)
      );

      CREATE INDEX IF NOT EXISTS idx_user_policies_user ON user_policies(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_policies_policy ON user_policies(policy_id);

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        description TEXT,
        merchant TEXT NOT NULL,
        category TEXT NOT NULL,
        image_url TEXT,
        available INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_products_merchant ON products(merchant);
      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

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
        approval_status TEXT DEFAULT NULL,
        policy_results TEXT NOT NULL,
        checkout_method TEXT DEFAULT 'traditional',
        transaction_type TEXT DEFAULT 'agent-to-merchant',
        payment_method TEXT DEFAULT 'stripe',
        blockchain_tx_signature TEXT,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_user_timestamp 
        ON purchase_attempts(user_id, timestamp);
      
      CREATE INDEX IF NOT EXISTS idx_users_email 
        ON users(email);

      -- NEW: x402 Nonce tracking for anti-replay
      CREATE TABLE IF NOT EXISTS x402_nonces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nonce TEXT UNIQUE NOT NULL,
        tx_signature TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        buyer_user_id TEXT,
        amount TEXT NOT NULL,
        mint TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        verified_at TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_nonce ON x402_nonces(nonce);
      CREATE INDEX IF NOT EXISTS idx_tx_signature ON x402_nonces(tx_signature);
      CREATE INDEX IF NOT EXISTS idx_expires_at ON x402_nonces(expires_at);

      -- NEW: Agent Registry
      CREATE TABLE IF NOT EXISTS registered_agents (
        id TEXT PRIMARY KEY,
        agent_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        services TEXT NOT NULL,
        service_description TEXT,
        accepted_currencies TEXT NOT NULL,
        usdc_token_account TEXT,
        solana_pubkey TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        verified INTEGER NOT NULL DEFAULT 0,
        owner_id TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_id ON registered_agents(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_active ON registered_agents(active, verified);

      -- User Wallets for Solana/USDC payments
      CREATE TABLE IF NOT EXISTS user_wallets (
        id TEXT PRIMARY KEY,
        user_id TEXT UNIQUE NOT NULL,
        public_key TEXT UNIQUE NOT NULL,
        encrypted_secret TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_user_id ON user_wallets(user_id);
      CREATE INDEX IF NOT EXISTS idx_wallet_pubkey ON user_wallets(public_key);
    `);
  }

  async getActivePolicies(userId?: string): Promise<Policy[]> {
    console.log('🔍 DB.getActivePolicies called for userId:', userId);
    const rows = this.db.prepare('SELECT * FROM policies WHERE enabled = 1 ORDER BY priority DESC').all();
    console.log(`🔍 DB.getActivePolicies: Found ${rows.length} enabled policies in database`);
    const mapped = rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      enabled: row.enabled === 1,
      priority: row.priority,
      transactionTypes: row.transaction_types ? JSON.parse(row.transaction_types) : ['agent-to-merchant'],
      conditions: JSON.parse(row.conditions),
      rules: JSON.parse(row.rules),
    }));
    console.log(`🔍 DB.getActivePolicies: Returning ${mapped.length} policies`);
    return mapped;
  }

  async getUserSpending(userId: string, period: 'daily' | 'weekly' | 'monthly', transactionType?: 'agent-to-merchant' | 'agent-to-agent'): Promise<number> {
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

    // Ensure transaction_type column exists
    let hasTransactionType = false;
    try {
      this.db.prepare('SELECT transaction_type FROM purchase_attempts LIMIT 1').get();
      hasTransactionType = true;
    } catch (e) {
      // Column doesn't exist yet, will be created on next recordPurchaseAttempt
    }

    let query = `
      SELECT COALESCE(SUM(amount), 0) as total
      FROM purchase_attempts
      WHERE user_id = ? AND allowed = 1 AND timestamp >= ?
    `;
    
    const params: any[] = [userId, startDate.toISOString()];

    // Filter by transaction type if specified and column exists
    if (transactionType && hasTransactionType) {
      query += ' AND transaction_type = ?';
      params.push(transactionType);
    }

    const result = this.db.prepare(query).get(...params);

    return result.total;
  }

  async recordPurchaseAttempt(attempt: any): Promise<number> {
    // Ensure all new columns exist
    const columnsToAdd = [
      { name: 'requires_approval', def: 'INTEGER DEFAULT 0' },
      { name: 'product_name', def: 'TEXT' },
      { name: 'checkout_method', def: 'TEXT DEFAULT "traditional"' },
      { name: 'approval_status', def: 'TEXT DEFAULT NULL' },
      { name: 'transaction_type', def: 'TEXT DEFAULT "agent-to-merchant"' },
      { name: 'payment_method', def: 'TEXT DEFAULT "stripe"' },
      { name: 'blockchain_tx_signature', def: 'TEXT' },
    ];

    for (const col of columnsToAdd) {
      try {
        this.db.prepare(`SELECT ${col.name} FROM purchase_attempts LIMIT 1`).get();
      } catch (e) {
        try {
          this.db.prepare(`ALTER TABLE purchase_attempts ADD COLUMN ${col.name} ${col.def}`).run();
        } catch (alterError) {
          // Column might already exist, ignore
        }
      }
    }

    const result = this.db.prepare(`
      INSERT INTO purchase_attempts 
      (user_id, product_id, product_name, amount, merchant, category, allowed, requires_approval, approval_status, policy_results, checkout_method, transaction_type, payment_method, blockchain_tx_signature, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      attempt.userId,
      attempt.productId,
      attempt.productName || null,
      attempt.amount,
      attempt.merchant,
      attempt.category || null,
      attempt.allowed ? 1 : 0,
      attempt.requiresApproval ? 1 : 0,
      attempt.approvalStatus || null,
      JSON.stringify(attempt.policyCheckResults || []),
      attempt.checkoutMethod || 'traditional',
      attempt.transactionType || 'agent-to-merchant',
      attempt.paymentMethod || 'stripe',
      attempt.blockchainTxSignature || null,
      new Date().toISOString()
    );

    return result.lastInsertRowid as number;
  }

  async createPolicy(policy: Policy): Promise<void> {
    const now = new Date().toISOString();
    
    // Extract transaction types from conditions if present
    const transactionTypes = policy.conditions?.transactionType || ['agent-to-merchant'];
    
    this.db.prepare(`
      INSERT INTO policies (id, name, type, enabled, priority, transaction_types, conditions, rules, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      policy.id,
      policy.name,
      policy.type,
      policy.enabled ? 1 : 0,
      policy.priority,
      JSON.stringify(transactionTypes),
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
    
    // Extract transaction types from conditions if present
    const transactionTypes = policy.conditions?.transactionType || ['agent-to-merchant'];
    
    this.db.prepare(`
      UPDATE policies 
      SET name = ?, type = ?, enabled = ?, priority = ?, transaction_types = ?, conditions = ?, rules = ?, updated_at = ?
      WHERE id = ?
    `).run(
      policy.name,
      policy.type,
      policy.enabled ? 1 : 0,
      policy.priority,
      JSON.stringify(transactionTypes),
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

  // ============================================================================
  // x402 Nonce Management (Anti-Replay Protection)
  // ============================================================================

  /**
   * Check if an x402 nonce has already been used
   */
  async checkX402Nonce(nonce: string): Promise<boolean> {
    const result = this.db.prepare('SELECT id FROM x402_nonces WHERE nonce = ?').get(nonce);
    return !!result;
  }

  /**
   * Store x402 nonce after verification
   */
  async storeX402Nonce(params: {
    nonce: string;
    txSignature: string;
    agentId: string;
    buyerUserId?: string;
    amount: string;
    mint: string;
    verified: boolean;
    verifiedAt: Date;
    expiresAt: Date;
  }): Promise<void> {
    this.db.prepare(`
      INSERT INTO x402_nonces (
        nonce, tx_signature, agent_id, buyer_user_id, amount, mint,
        verified, verified_at, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.nonce,
      params.txSignature,
      params.agentId,
      params.buyerUserId || null,
      params.amount,
      params.mint,
      params.verified ? 1 : 0,
      params.verifiedAt.toISOString(),
      params.expiresAt.toISOString(),
      new Date().toISOString()
    );
  }

  /**
   * Clean up expired nonces (should run periodically)
   */
  async cleanupExpiredNonces(): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db.prepare('DELETE FROM x402_nonces WHERE expires_at < ?').run(now);
    return result.changes;
  }

  // ============================================================================
  // Agent Registry Management
  // ============================================================================

  /**
   * Register a new agent
   */
  async registerAgent(params: {
    id: string;
    agentId: string;
    name: string;
    baseUrl: string;
    services: string[];
    serviceDescription?: string;
    acceptedCurrencies: string[];
    usdcTokenAccount?: string;
    solanaPubkey?: string;
    ownerId: string;
    metadata?: any;
  }): Promise<void> {
    const now = new Date().toISOString();
    
    this.db.prepare(`
      INSERT INTO registered_agents (
        id, agent_id, name, base_url, services, service_description,
        accepted_currencies, usdc_token_account, solana_pubkey,
        active, verified, owner_id, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)
    `).run(
      params.id,
      params.agentId,
      params.name,
      params.baseUrl,
      JSON.stringify(params.services),
      params.serviceDescription || null,
      JSON.stringify(params.acceptedCurrencies),
      params.usdcTokenAccount || null,
      params.solanaPubkey || null,
      params.ownerId,
      params.metadata ? JSON.stringify(params.metadata) : null,
      now,
      now
    );
  }

  /**
   * Get registered agent by agent ID
   */
  async getRegisteredAgent(agentId: string): Promise<any | null> {
    const row = this.db.prepare('SELECT * FROM registered_agents WHERE agent_id = ?').get(agentId);
    
    if (!row) return null;
    
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
      active: row.active === 1,
      verified: row.verified === 1,
      ownerId: row.owner_id,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * List all active registered agents
   */
  async listRegisteredAgents(filters?: {
    active?: boolean;
    verified?: boolean;
    ownerId?: string;
  }): Promise<any[]> {
    let query = 'SELECT * FROM registered_agents WHERE 1=1';
    const params: any[] = [];
    
    if (filters?.active !== undefined) {
      query += ' AND active = ?';
      params.push(filters.active ? 1 : 0);
    }
    
    if (filters?.verified !== undefined) {
      query += ' AND verified = ?';
      params.push(filters.verified ? 1 : 0);
    }
    
    if (filters?.ownerId) {
      query += ' AND owner_id = ?';
      params.push(filters.ownerId);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const rows = this.db.prepare(query).all(...params);
    
    return rows.map((row: any) => ({
      id: row.id,
      agentId: row.agent_id,
      name: row.name,
      baseUrl: row.base_url,
      services: JSON.parse(row.services),
      serviceDescription: row.service_description,
      acceptedCurrencies: JSON.parse(row.accepted_currencies),
      usdcTokenAccount: row.usdc_token_account,
      solanaPubkey: row.solana_pubkey,
      active: row.active === 1,
      verified: row.verified === 1,
      ownerId: row.owner_id,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Update registered agent
   */
  async updateRegisteredAgent(agentId: string, updates: {
    name?: string;
    baseUrl?: string;
    services?: string[];
    serviceDescription?: string;
    usdcTokenAccount?: string;
    solanaPubkey?: string;
    active?: boolean;
    verified?: boolean;
  }): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    
    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    
    if (updates.baseUrl !== undefined) {
      fields.push('base_url = ?');
      values.push(updates.baseUrl);
    }
    
    if (updates.services !== undefined) {
      fields.push('services = ?');
      values.push(JSON.stringify(updates.services));
    }
    
    if (updates.serviceDescription !== undefined) {
      fields.push('service_description = ?');
      values.push(updates.serviceDescription);
    }
    
    if (updates.usdcTokenAccount !== undefined) {
      fields.push('usdc_token_account = ?');
      values.push(updates.usdcTokenAccount);
    }
    
    if (updates.solanaPubkey !== undefined) {
      fields.push('solana_pubkey = ?');
      values.push(updates.solanaPubkey);
    }
    
    if (updates.active !== undefined) {
      fields.push('active = ?');
      values.push(updates.active ? 1 : 0);
    }
    
    if (updates.verified !== undefined) {
      fields.push('verified = ?');
      values.push(updates.verified ? 1 : 0);
    }
    
    if (fields.length === 0) return;
    
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    
    values.push(agentId);
    
    const query = `UPDATE registered_agents SET ${fields.join(', ')} WHERE agent_id = ?`;
    this.db.prepare(query).run(...values);
  }

  /**
   * Delete registered agent
   */
  async deleteRegisteredAgent(agentId: string): Promise<void> {
    this.db.prepare('DELETE FROM registered_agents WHERE agent_id = ?').run(agentId);
  }

  // ============================================================================
  // User Wallet Methods
  // ============================================================================

  async getUserWallet(userId: string): Promise<{ userId: string; publicKey: string; secretKey: number[] } | null> {
    const row = this.db.prepare('SELECT * FROM user_wallets WHERE user_id = ?').get(userId) as any;
    if (!row) return null;

    // Decrypt the secret key (simple base64 for now - use proper encryption in production)
    const secretKey = JSON.parse(Buffer.from(row.encrypted_secret, 'base64').toString('utf-8'));
    
    return {
      userId: row.user_id,
      publicKey: row.public_key,
      secretKey,
    };
  }

  async saveUserWallet(wallet: { userId: string; publicKey: string; secretKey: number[] }): Promise<void> {
    // Encrypt the secret key (simple base64 for now - use proper encryption in production)
    const encryptedSecret = Buffer.from(JSON.stringify(wallet.secretKey)).toString('base64');
    
    const id = `wallet_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.db.prepare(`
      INSERT INTO user_wallets (id, user_id, public_key, encrypted_secret, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      wallet.userId,
      wallet.publicKey,
      encryptedSecret,
      new Date().toISOString()
    );
  }
}

export default DB;
