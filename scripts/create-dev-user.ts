import { DB } from '@agentic-commerce/database';

async function createDevUser() {
  const db = new DB('./data/shopping.db');
  
  const devEmail = 'dev@example.com';
  const existingUser = await db.getUserByEmail(devEmail);
  
  if (existingUser) {
    console.log('✅ Dev user already exists:', existingUser.id);
    console.log('📧 Email:', existingUser.email);
    console.log('👤 Role:', existingUser.role || 'user');
    return;
  }
  
  // Create dev user with admin role
  const newUser = await db.createOrGetUser(devEmail, 'Dev Admin');
  
  // Update user role to admin
  await db.addApprovalReviewer(newUser.id, 'admin');
  
  const finalUser = await db.getUserByEmail(devEmail);
  console.log('✅ Created dev admin user!');
  console.log('📧 Email:', finalUser.email);
  console.log('🆔 ID:', finalUser.id);
  console.log('👤 Role:', finalUser.role);
}

createDevUser()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
