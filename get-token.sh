#!/bin/bash
# Quick script to create a user and get JWT token

echo "📝 Creating test user and generating JWT token..."
echo ""

# Create user via API (no auth required for user creation in dev)
USER_EMAIL="test-$(date +%s)@example.com"

# Generate JWT using Node
docker exec agentic-commerce-api-1 node -e "
const jwt = require('jsonwebtoken');
const userId = 'test-user-$(date +%s)';
const email = '$USER_EMAIL';
const token = jwt.sign(
  { userId: userId, email: email },
  process.env.JWT_SECRET || 'dev-secret-key-change-in-production',
  { expiresIn: '7d' }
);
console.log('');
console.log('✅ JWT Token Generated:');
console.log('');
console.log(token);
console.log('');
console.log('📋 User Details:');
console.log('  User ID:', userId);
console.log('  Email:', email);
console.log('');
console.log('🧪 Test with:');
console.log('');
console.log('export JWT_TOKEN=\"' + token + '\"');
console.log('');
console.log('curl -X POST http://localhost:3000/api/policy/check \\\\');
console.log('  -H \"Authorization: Bearer \$JWT_TOKEN\" \\\\');
console.log('  -H \"Content-Type: application/json\" \\\\');
console.log('  -d \\'{ \"user_id\": \"' + userId + '\", \"product_id\": \"prod-laptop-001\", \"price\": 2499.00, \"merchant\": \"Apple Store\", \"category\": \"Electronics\", \"transactionType\": \"agent-to-merchant\" }\\'');
console.log('');
"
