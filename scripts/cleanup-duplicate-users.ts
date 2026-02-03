#!/usr/bin/env node
/**
 * Script to clean up duplicate users and consolidate policies
 * This ensures only one user exists per email address
 */

import Database from 'better-sqlite3';
import * as path from 'path';

const dbPath = path.resolve('./data/shopping.db');
const db = new Database(dbPath);

interface User {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

async function cleanupDuplicateUsers() {
  console.log('🔍 Scanning for duplicate users...\n');

  // Find all users grouped by email
  const duplicates = db.prepare(`
    SELECT email, COUNT(*) as count, GROUP_CONCAT(id) as user_ids
    FROM users
    GROUP BY email
    HAVING count > 1
  `).all() as Array<{ email: string; count: number; user_ids: string }>;

  if (duplicates.length === 0) {
    console.log('✅ No duplicate users found. Database is clean!\n');
    return;
  }

  console.log(`⚠️  Found ${duplicates.length} email(s) with duplicate users:\n`);

  for (const dup of duplicates) {
    const userIds = dup.user_ids.split(',');
    console.log(`📧 Email: ${dup.email}`);
    console.log(`   Duplicate user IDs: ${userIds.join(', ')}`);
    
    // Get all users with this email
    const users = db.prepare('SELECT * FROM users WHERE email = ?').all(dup.email) as User[];
    
    // Keep the oldest user (first created)
    users.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const keepUser = users[0];
    const deleteUsers = users.slice(1);
    
    console.log(`   ✅ Keeping: ${keepUser.id} (created: ${keepUser.created_at})`);
    
    // Move all policies from duplicate users to the kept user
    for (const delUser of deleteUsers) {
      console.log(`   🔄 Migrating policies from ${delUser.id}...`);
      
      // Get policies for this user
      const policies = db.prepare('SELECT * FROM user_policies WHERE user_id = ?').all(delUser.id) as any[];
      
      for (const policy of policies) {
        try {
          // Check if the kept user already has this policy
          const existing = db.prepare(
            'SELECT * FROM user_policies WHERE user_id = ? AND policy_id = ?'
          ).get(keepUser.id, policy.policy_id);
          
          if (!existing) {
            // Move policy to kept user
            db.prepare('UPDATE user_policies SET user_id = ? WHERE id = ?').run(keepUser.id, policy.id);
            console.log(`      ✓ Moved policy ${policy.policy_id}`);
          } else {
            // Delete duplicate policy assignment
            db.prepare('DELETE FROM user_policies WHERE id = ?').run(policy.id);
            console.log(`      ✓ Removed duplicate policy ${policy.policy_id}`);
          }
        } catch (error) {
          console.log(`      ⚠️  Error migrating policy ${policy.policy_id}:`, error);
        }
      }
      
      // Move purchase history
      const purchases = db.prepare('SELECT COUNT(*) as count FROM purchase_attempts WHERE user_id = ?').get(delUser.id) as { count: number };
      if (purchases.count > 0) {
        db.prepare('UPDATE purchase_attempts SET user_id = ? WHERE user_id = ?').run(keepUser.id, delUser.id);
        console.log(`      ✓ Moved ${purchases.count} purchase records`);
      }
      
      // Delete the duplicate user
      db.prepare('DELETE FROM users WHERE id = ?').run(delUser.id);
      console.log(`   ❌ Deleted duplicate user: ${delUser.id}`);
    }
    
    console.log('');
  }

  console.log('✅ Cleanup complete!\n');
  
  // Verify no duplicates remain
  const remaining = db.prepare(`
    SELECT email, COUNT(*) as count
    FROM users
    GROUP BY email
    HAVING count > 1
  `).all();
  
  if (remaining.length === 0) {
    console.log('✅ Verified: All duplicate users removed successfully!\n');
  } else {
    console.log('⚠️  Warning: Some duplicates still remain.\n');
  }
  
  // Show final user count
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  console.log(`📊 Total unique users: ${totalUsers.count}\n`);
}

// Run cleanup
try {
  cleanupDuplicateUsers();
  db.close();
  process.exit(0);
} catch (error) {
  console.error('❌ Error during cleanup:', error);
  db.close();
  process.exit(1);
}
