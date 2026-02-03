#!/usr/bin/env tsx

/**
 * Script to create a user in the database and generate a JWT token
 * Usage:
 *   npm run create-user -- <email> [name]
 *   OR
 *   tsx scripts/create-user-and-token.ts <email> [name]
 */
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'test';

async function createUserAndToken() {
  const email = process.argv[2];
  const name = process.argv[3];

  if (!email) {
    console.error('\n❌ Error: Email is required\n');
    console.log('Usage:');
    console.log('  npm run create-user -- <email> [name]');
    console.log('  OR');
    console.log('  tsx scripts/create-user-and-token.ts <email> [name]');
    console.log('\nExample:');
    console.log('  npm run create-user -- user@example.com "John Doe"');
    process.exit(1);
  }

  try {
    // Generate unique user ID
    const userId = `user-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    console.log(`\n📝 Creating user for: ${email}`);
    console.log(`✓ User ID: ${userId}`);
    console.log(`✓ Email: ${email}`);
    if (name) console.log(`✓ Name: ${name}`);

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: userId,
        email: email,
        iat: Math.floor(Date.now() / 1000),
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log('\n=== JWT Token Generated ===');
    console.log(`User ID: ${userId}`);
    console.log(`Email: ${email}`);
    if (name) console.log(`Name: ${name}`);
    console.log(`Token: ${token}`);
    console.log('\n📋 Copy this token and use it in ChatGPT OpenAPI schema authentication.');
    console.log('   Authentication Type: Bearer Token');
    console.log('   Token: [paste token above]\n');
    console.log('⚠️  Note: User will be created in database when backend processes this token\n');

    // Also save to a file for easy access
    const fs = await import('fs');
    const safeUserId = userId.replace(/[^a-zA-Z0-9]/g, '_');
    const tokenFile = `token-${safeUserId}.txt`;
    fs.writeFileSync(
      tokenFile,
      `User ID: ${userId}\nEmail: ${email}\nName: ${name || 'N/A'}\nToken: ${token}\n`
    );
    console.log(`💾 Token also saved to: ${tokenFile}\n`);

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

createUserAndToken();
