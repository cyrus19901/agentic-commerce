/**
 * Test ChatGPT Agent-to-Agent Endpoints
 * Verifies the simplified API for ChatGPT integration
 */

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';

async function testChatGPTEndpoints() {
  console.log('🧪 Testing ChatGPT Agent-to-Agent Endpoints\n');
  const testEmail = `chatgpt-test-${Date.now()}@example.com`;

  try {
    // Step 1: Create user account
    console.log('📝 Step 1: Creating user account...');
    const createUserResponse = await fetch(`${API_BASE_URL}/api/auth/create-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        name: 'ChatGPT Test User',
      }),
    });

    if (!createUserResponse.ok) {
      throw new Error(`Failed to create user: ${await createUserResponse.text()}`);
    }

    const userData = await createUserResponse.json();
    console.log(`  ✅ User created: ${userData.user.email}`);
    console.log(`     User ID: ${userData.user.id}\n`);

    // Step 2: Get/Create wallet
    console.log('💰 Step 2: Creating Solana wallet...');
    const walletResponse = await fetch(`${API_BASE_URL}/api/chatgpt-agent/wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_email: testEmail,
      }),
    });

    if (!walletResponse.ok) {
      throw new Error(`Failed to get wallet: ${await walletResponse.text()}`);
    }

    const walletData = await walletResponse.json();
    console.log(`  ✅ Wallet created:`);
    console.log(`     Public Key: ${walletData.wallet.publicKey}`);
    console.log(`     Token Account: ${walletData.wallet.tokenAccount}`);
    console.log(`     Network: ${walletData.wallet.network}`);
    console.log(`     Balances: ${walletData.wallet.balances.sol} SOL, ${walletData.wallet.balances.usdc} USDC`);
    console.log(`\n     📝 Funding Instructions:`);
    console.log(`        SOL: ${walletData.wallet.fundingInstructions.sol}`);
    console.log(`        USDC: ${walletData.wallet.fundingInstructions.usdc}\n`);

    // Step 3: List available agents
    console.log('🤖 Step 3: Listing available agents...');
    const agentsResponse = await fetch(`${API_BASE_URL}/api/registry/agents`);

    if (!agentsResponse.ok) {
      throw new Error(`Failed to list agents: ${await agentsResponse.text()}`);
    }

    const agentsData = await agentsResponse.json();
    console.log(`  ✅ Found ${agentsData.count} registered agents:`);
    agentsData.agents.forEach((agent: any, index: number) => {
      console.log(`     ${index + 1}. ${agent.name} (${agent.agentId})`);
      console.log(`        Services: ${agent.services.join(', ')}`);
      console.log(`        Description: ${agent.serviceDescription}`);
    });

    console.log('\n⚠️  Step 4: Request Service (SKIPPED)');
    console.log('   To test this step, you need to fund the wallet first:');
    console.log(`   1. Send SOL: solana airdrop 1 ${walletData.wallet.publicKey} --url devnet`);
    console.log(`   2. Send USDC to: ${walletData.wallet.tokenAccount}`);
    console.log('   3. Run the full E2E test: npm run test:e2e-chatgpt\n');

    console.log('✅ All endpoint tests passed!');
    console.log('\n📋 Next Steps for ChatGPT Integration:');
    console.log('   1. Import docs/gpt-action-schema.yaml into ChatGPT Actions');
    console.log('   2. Set server URL to http://localhost:3000 (or your deployed URL)');
    console.log('   3. Start chatting with ChatGPT to create users and request services');
    console.log('\n   Example ChatGPT prompts:');
    console.log('   - "Create a user with email chatgpt@example.com"');
    console.log('   - "Get my Solana wallet using email chatgpt@example.com"');
    console.log('   - "Show me all available agents"');
    console.log('   - "Request data-scraping from agent://seller-test/v1"');

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

testChatGPTEndpoints();
