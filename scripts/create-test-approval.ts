import { DB } from '../packages/database/src/index.js';

async function createTestApproval() {
  const db = new DB('./packages/database/data/shopping.db');
  
  // Directly insert a test approval request
  await db.recordPurchaseAttempt({
    userId: 'user-123',
    productId: 'test-product-789',
    productName: 'Marketing Campaign Budget',
    amount: 2450,
    merchant: 'Google Ads',
    category: 'Advertising',
    allowed: false, // Not yet approved
    requiresApproval: true, // Requires approval!
    policyCheckResults: [{
      id: 'test-policy',
      name: 'High-Value Purchases Require Approval',
      passed: false,
      reason: 'Amount exceeds auto-approval threshold',
    }],
    checkoutMethod: 'chatgpt',
  });
  
  console.log('✅ Test approval request created!');
  console.log('Check your Pending Approvals UI at http://localhost:3001');
}

createTestApproval().catch(console.error);
