import jwt from 'jsonwebtoken';

const userId = process.argv[2] || 'user-123';
const secret = process.env.JWT_SECRET || 'your-secret-key';
const token = jwt.sign({ userId }, secret, { expiresIn: '30d' });

console.log('\n=== JWT Token Generated ===');
console.log(`User ID: ${userId}`);
console.log(`Token: ${token}`);
console.log('\nUse this in ChatGPT GPT authentication.\n');
