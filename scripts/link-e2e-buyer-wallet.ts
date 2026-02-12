/**
 * Link the ChatGPT user (cyrus19901@gmail.com) to the E2E buyer wallet.
 * The E2E buyer has SOL + USDC; after this, ChatGPT will use that wallet.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const EMAIL = 'cyrus19901@gmail.com';

// Buyer keypair from tests/e2e/.keypairs/buyer.json
const BUYER_SECRET = [
  113, 61, 178, 195, 122, 209, 198, 86, 53, 246, 66, 247, 46, 146, 84, 45,
  252, 227, 175, 214, 136, 48, 200, 117, 170, 182, 102, 3, 93, 170, 217, 139,
  17, 120, 162, 124, 122, 175, 169, 31, 254, 144, 172, 92, 31, 214, 164, 198,
  152, 204, 92, 100, 49, 138, 58, 9, 196, 118, 248, 41, 239, 80, 44, 129,
];

// Public key for buyer (2BCd1R1LPLsutzQ2gBLdFDuoKeakqqyebicvrPSsej1J)
const BUYER_PUBKEY = '2BCd1R1LPLsutzQ2gBLdFDuoKeakqqyebicvrPSsej1J';

function main() {
  const dbPath =
    process.env.DATABASE_PATH ||
    process.env.DATABASE_URL ||
    path.join(process.cwd(), 'data', 'shopping.db');

  if (!fs.existsSync(dbPath)) {
    console.error('Database not found at:', dbPath);
    console.error('Set DATABASE_PATH or run from agentic-commerce with data/shopping.db');
    process.exit(1);
  }

  const db = new Database(dbPath);

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL) as { id: string } | undefined;
  if (!user) {
    console.error('User not found for email:', EMAIL);
    process.exit(1);
  }

  const encryptedSecret = Buffer.from(JSON.stringify(BUYER_SECRET)).toString('base64');
  const walletId = `wallet_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();

  db.prepare('DELETE FROM user_wallets WHERE user_id = ?').run(user.id);
  db.prepare(
    `INSERT INTO user_wallets (id, user_id, public_key, encrypted_secret, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(walletId, user.id, BUYER_PUBKEY, encryptedSecret, now);

  console.log('Linked E2E buyer wallet to', EMAIL);
  console.log('  User ID:', user.id);
  console.log('  Wallet:', BUYER_PUBKEY);
  console.log('  USDC ATA: 33Lz1WUfuvTzZrCSJptw8KVXth8kVT1LPtHW5BkK7bRM');
  console.log('\nChatGPT can now use this wallet (SOL + 1983 USDC).');
}

main();
