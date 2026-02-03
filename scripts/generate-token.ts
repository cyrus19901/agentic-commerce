import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const secret = process.env.JWT_SECRET || 'test';

async function generateToken() {
  const emailOrUserId = process.argv[2];

  if (!emailOrUserId) {
    console.error('\n❌ Error: Email or User ID is required\n');
    console.log('Usage:');
    console.log('  npm run generate-token -- <email-or-user-id>');
    console.log('\nExamples:');
    console.log('  npm run generate-token -- user@example.com');
    console.log('  npm run generate-token -- user-1234567890-abc');
    console.log('\n💡 Note: If using email, user will be created in database when backend starts');
    process.exit(1);
  }

  try {
    let userId: string;
    let email: string | undefined;

    // Check if it's an email or user ID
    if (emailOrUserId.includes('@')) {
      // It's an email - generate consistent user ID from email
      email = emailOrUserId;
      // Generate a consistent user ID from email (same as backend does)
      userId = `user-${crypto.createHash('sha256').update(email).digest('hex').substring(0, 16)}`;
      console.log(`\n📝 Generating token for email: ${email}`);
      console.log(`✓ User ID (generated): ${userId}`);
      console.log(`⚠️  Note: User will be created in database when backend processes this token`);
    } else {
      // It's a user ID - use it directly
      userId = emailOrUserId;
      console.log(`\n📝 Generating token for user ID: ${userId}`);
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: userId,
        email: email,
        iat: Math.floor(Date.now() / 1000),
      },
      secret,
      { expiresIn: '30d' }
    );

    console.log('\n=== JWT Token Generated ===');
    console.log(`User ID: ${userId}`);
    if (email) console.log(`Email: ${email}`);
    console.log(`Token: ${token}`);
    console.log('\n📋 Copy this token and use it in ChatGPT OpenAPI schema authentication.');
    console.log('   Authentication Type: Bearer Token');
    console.log('   Token: [paste token above]\n');

    // Also save to a file for easy access
    const fs = await import('fs');
    const safeUserId = userId.replace(/[^a-zA-Z0-9]/g, '_');
    const tokenFile = `token-${safeUserId}.txt`;
    fs.writeFileSync(
      tokenFile,
      `User ID: ${userId}\nEmail: ${email || 'N/A'}\nToken: ${token}\n`
    );
    console.log(`💾 Token also saved to: ${tokenFile}\n`);

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

generateToken();
