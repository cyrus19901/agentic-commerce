import { DB } from '../packages/database/src/index.js';

const db = new DB('./data/shopping.db');

const userEmail = process.argv[2] || 'cyrus19901@gmail.com';

(async () => {
  try {
    // Get user
    const user = await db.getUserByEmail(userEmail);
    if (!user) {
      console.log(`❌ User not found: ${userEmail}`);
      return;
    }
    console.log(`✅ Found user: ${user.email} (ID: ${user.id})`);
    
    // Get all policies
    const allPolicies = db.db.prepare('SELECT id, name FROM policies').all() as any[];
    console.log(`\n📋 Found ${allPolicies.length} policies`);
    
    // Assign all policies to user
    let assignedCount = 0;
    for (const policy of allPolicies) {
      try {
        db.db.prepare('INSERT OR IGNORE INTO user_policies (user_id, policy_id, active) VALUES (?, ?, 1)')
          .run(user.id, policy.id);
        console.log(`✓ Assigned: ${policy.name}`);
        assignedCount++;
      } catch (e: any) {
        console.log(`✗ Error assigning ${policy.name}:`, e.message);
      }
    }
    
    console.log(`\n✅ Assigned ${assignedCount} policies to ${user.email}`);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
