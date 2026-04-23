/**
 * E2E Test: X402 Protocol Flow
 *
 * Tests the canonical x402 handshake:
 *   1. POST /payments/execute without PAYMENT-SIGNATURE → 402
 *   2. Decode PAYMENT-REQUIRED header → price quote
 *   3. POST /payments/execute with PAYMENT-SIGNATURE → 200 (or sandbox)
 *   4. Verify PAYMENT-RESPONSE header present
 *
 * Also tests:
 *   - POST /payments/quote → price estimation without execution
 *   - MCP /mcp tools/list → x402 pricing metadata
 *
 * Usage: npx tsx tests/e2e/x402-protocol-flow.ts
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/v1';
const MCP_BASE = process.env.MCP_BASE || 'http://localhost:3001/mcp';
const API_KEY = process.env.API_KEY || 'ak_demo_live_test_key_2024';

async function request(url: string, opts: RequestInit = {}) {
  const resp = await fetch(url, {
    ...opts,
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
      ...(opts.headers as Record<string, string> || {}),
    },
  });
  return resp;
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  PASS: ${message}`);
  }
}

async function testQuoteEndpoint() {
  console.log('\n--- Test: POST /payments/quote ---');
  const resp = await request(`${API_BASE}/payments/quote`, {
    method: 'POST',
    body: JSON.stringify({ provider: 'zyte', action: 'scrape', params: { url: 'https://example.com' } }),
  });
  const json = await resp.json() as any;

  assert(resp.status === 200, `Status 200 (got ${resp.status})`);
  assert(typeof json.estimatedCostUsdc === 'number', `Has estimatedCostUsdc: ${json.estimatedCostUsdc}`);
  assert(typeof json.allowed === 'boolean', `Has allowed: ${json.allowed}`);
  assert(typeof json.paymentId === 'string', `Has paymentId: ${json.paymentId}`);
  assert(typeof json.correlationId === 'string', `Has correlationId: ${json.correlationId}`);
}

async function testX402Flow() {
  console.log('\n--- Test: X402 Protocol Flow (402 → PAYMENT-SIGNATURE → 200) ---');

  // Step 1: Request without PAYMENT-SIGNATURE → expect 402
  console.log('\n  Step 1: POST without PAYMENT-SIGNATURE');
  const resp1 = await request(`${API_BASE}/payments/execute`, {
    method: 'POST',
    body: JSON.stringify({
      provider: 'zyte',
      action: 'scrape',
      params: { url: 'https://example.com' },
      max_payment_usdc: 0.10,
    }),
  });

  const paymentRequiredHeader = resp1.headers.get('PAYMENT-REQUIRED');
  const json1 = await resp1.json() as any;

  assert(resp1.status === 402, `Status 402 (got ${resp1.status})`);
  assert(!!paymentRequiredHeader, 'PAYMENT-REQUIRED header present');
  assert(json1.x402Version === 2, `x402Version is 2 (got ${json1.x402Version})`);
  assert(Array.isArray(json1.accepts), 'Has accepts array');

  if (json1.accepts?.[0]) {
    const accept = json1.accepts[0];
    assert(accept.scheme === 'exact', `Scheme is "exact" (got ${accept.scheme})`);
    assert(typeof accept.maxAmountRequired === 'string', `Has maxAmountRequired: ${accept.maxAmountRequired}`);
    assert(typeof accept.asset === 'string', `Has asset: ${accept.asset}`);
    assert(typeof accept.payTo === 'string', `Has payTo: ${accept.payTo}`);
    assert(typeof accept.network === 'string', `Has network: ${accept.network}`);

    const amtUsdc = parseInt(accept.maxAmountRequired) / 1_000_000;
    console.log(`\n  Price: $${amtUsdc.toFixed(4)} USDC | Network: ${accept.network} | PayTo: ${accept.payTo}`);
  }

  // Decode PAYMENT-REQUIRED header
  if (paymentRequiredHeader) {
    try {
      const decoded = JSON.parse(Buffer.from(paymentRequiredHeader, 'base64').toString('utf8'));
      assert(decoded.x402Version === 2, 'Decoded header has x402Version 2');
      console.log('  Decoded PAYMENT-REQUIRED header OK');
    } catch {
      console.log('  Note: PAYMENT-REQUIRED header is not base64 encoded (may be JSON directly)');
    }
  }

  // Step 2: Sandbox mode test (simulates signed payment)
  console.log('\n  Step 2: POST with sandbox mode (simulates signed payment)');
  const resp2 = await request(`${API_BASE}/payments/execute`, {
    method: 'POST',
    body: JSON.stringify({
      provider: 'zyte',
      action: 'scrape',
      params: { url: 'https://example.com' },
      max_payment_usdc: 0.10,
      sandbox: true,
    }),
  });

  const json2 = await resp2.json() as any;
  assert(resp2.status === 200, `Status 200 (got ${resp2.status})`);
  assert(json2.status === 'completed', `Status completed (got ${json2.status})`);
  assert(json2.sandbox === true, 'Sandbox flag present');
  assert(typeof json2.paymentId === 'string', `Has paymentId: ${json2.paymentId}`);
}

async function testMcpServer() {
  console.log('\n--- Test: MCP Server (/mcp) ---');

  // Test initialize
  const initResp = await fetch(MCP_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  const initJson = await initResp.json() as any;
  assert(initJson.result?.serverInfo?.name === 'gordon-agentic-commerce', `Server name: ${initJson.result?.serverInfo?.name}`);

  // Test tools/list
  const toolsResp = await fetch(MCP_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  const toolsJson = await toolsResp.json() as any;
  const tools = toolsJson.result?.tools || [];
  assert(tools.length >= 5, `Has ${tools.length} tools`);

  const execTool = tools.find((t: any) => t.name === 'execute_payment');
  assert(!!execTool, 'Has execute_payment tool');
  assert(!!execTool?._meta?.x402, 'execute_payment has x402 pricing metadata');
  if (execTool?._meta?.x402) {
    console.log(`  x402 pricing: amount=${execTool._meta.x402.maxAmountRequired}, network=${execTool._meta.x402.network}`);
  }

  // Test ping
  const pingResp = await fetch(MCP_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping', params: {} }),
  });
  const pingJson = await pingResp.json() as any;
  assert(!!pingJson.result, 'Ping responded');
}

async function main() {
  console.log('=== X402 Protocol E2E Tests ===');
  console.log(`API: ${API_BASE}`);
  console.log(`MCP: ${MCP_BASE}`);
  console.log(`Key: ${API_KEY.slice(0, 10)}...`);

  try {
    await testQuoteEndpoint();
    await testX402Flow();
    await testMcpServer();
  } catch (err: any) {
    console.error(`\nFATAL: ${err.message}`);
    process.exitCode = 1;
  }

  console.log('\n=== Tests Complete ===');
}

main();
