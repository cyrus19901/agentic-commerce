#!/usr/bin/env tsx

/**
 * Assign all policies to a specific user
 * Usage: tsx scripts/assign-policies-to-user.ts <user-email>
 */

import { DB } from '@agentic-commerce/database';

const userEmail = process.argv[2];

if (!userEmail) {
  console.error('Usage: tsx scripts/assign-policies-to-user.ts <user-email>');
  process.exit(1);
}

const db = new DB(process.env.DATABASE_URL || './data/shopping.db');

(async () => {
  try {
    // Get user
    const user = await db.getUserByEmail(userEmail);
    if (!user) {
      console.error(`❌ User not found: ${userEmail}`);
      process.exit(1);
    }

    console.log(`✓ Found user: ${user.email} (${user.id})`);

    // Get all policies
    const allPolicies = db.db.prepare('SELECT id, name FROM policies WHERE enabled = 1').all() as any[];
    console.log(`✓ Found ${allPolicies.length} enabled policies`);

    // Assign all policies to user
    let assigned = 0;
    for (const policy of allPolicies) {
      try {
        db.db.prepare('INSERT OR IGNORE INTO user_policies (user_id, policy_id, active) VALUES (?, ?, 1)')
          .run(user.id, policy.id);
        assigned++;
      } catch (e) {
        // Ignore duplicate errors
      }
    }

    console.log(`✅ Assigned ${assigned} policies to ${user.email}`);

    // Verify
    const userPolicies = db.db.prepare('SELECT COUNT(*) as count FROM user_policies WHERE user_id = ?').get(user.id) as any;
    console.log(`✓ User now has ${userPolicies.count} policies`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
})();
