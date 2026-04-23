/**
 * Runnable E2E script (tsx):
 * - register provider-backed agent
 * - discover tools from OpenAPI
 * - sync services from toolMap
 * - fetch service catalog
 * - provider health/sample execution
 * - request seller 402 quote/requirement (extract pricing/payment info)
 * - optional paid service attempt via chatgpt-agent route
 *
 * Run:
 *   npx tsx tests/e2e/provider-onboarding-archtools.ts
 */

import jwt from 'jsonwebtoken';
import { Keypair } from '@solana/web3.js';

const API_BASE = process.env.API_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const ARCH_API_KEY = process.env.ARCH_API_KEY || 'arch_97f9cf9cea4589f3166be338550da4b1508eb94c2dfa3f7b';
const ARCH_OPENAPI_URL = process.env.ARCH_OPENAPI_URL || 'https://archtools.dev/openapi.json';
const RUN_PAID_FLOW = process.env.RUN_PAID_FLOW === 'true';
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || '';

function assert(condition: any, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function call(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, json, headers: res.headers };
}

async function main() {
  const timestamp = Date.now();
  const agentId = `agent://archtools-e2e/${timestamp}`;
  const ownerToken = jwt.sign({ userId: 'test-e2e-user', email: 'e2e@test.local' }, JWT_SECRET, { expiresIn: '1h' });
  const buyerEmail = `buyer-${timestamp}@test.local`;
  const sellerWallet = Keypair.generate().publicKey.toBase58();

  console.log(`\n[0/8] Create buyer user for auth compatibility: ${buyerEmail}`);
  const createUser = await call('POST', '/api/auth/create-user', {
    email: buyerEmail,
    name: 'E2E Buyer',
  });
  assert(createUser.ok, `create-user failed: ${createUser.status} ${JSON.stringify(createUser.json)}`);

  console.log(`\n[1/8] Register provider-backed agent: ${agentId}`);
  const register = await call('POST', '/api/registry/agents', {
    agentId,
    name: 'Arch Tools E2E Agent',
    baseUrl: 'https://archtools.dev',
    services: ['scrape'],
    serviceDescription: 'Dynamic provider-backed tools',
    acceptedCurrencies: ['USDC'],
    solanaPubkey: sellerWallet,
    metadata: {
      provider: {
        name: 'archtools',
        kind: 'archtools',
        baseUrl: 'https://archtools.dev',
        apiKey: ARCH_API_KEY,
        pricingStrategy: 'x402',
        openapiUrl: ARCH_OPENAPI_URL,
      },
    },
  }, { Authorization: `Bearer ${ownerToken}` });
  assert(register.ok, `register failed: ${register.status} ${JSON.stringify(register.json)}`);

  console.log('[2/8] Discover tools from OpenAPI');
  const discover = await call('POST', `/api/registry/agents/${encodeURIComponent(agentId)}/discover-tools`, {
    openapiUrl: ARCH_OPENAPI_URL,
  }, { Authorization: `Bearer ${ownerToken}` });
  assert(discover.ok, `discover failed: ${discover.status} ${JSON.stringify(discover.json)}`);
  assert((discover.json?.discoveredProviderToolCount || 0) > 0, 'discovery returned zero provider tools');

  console.log('[3/8] Sync services from mapped toolMap');
  const sync = await call('POST', `/api/registry/agents/${encodeURIComponent(agentId)}/sync-services`, {
    mode: 'merge',
  }, { Authorization: `Bearer ${ownerToken}` });
  assert(sync.ok, `sync-services failed: ${sync.status} ${JSON.stringify(sync.json)}`);
  assert((sync.json?.afterCount || 0) > 0, 'sync-services produced empty services');

  console.log('[4/8] Fetch provider service catalog');
  const catalog = await call('GET', `/api/registry/agents/${encodeURIComponent(agentId)}/services/catalog?openapi_url=${encodeURIComponent(ARCH_OPENAPI_URL)}`);
  assert(catalog.ok, `catalog failed: ${catalog.status} ${JSON.stringify(catalog.json)}`);
  assert((catalog.json?.providerToolCount || 0) >= 50, 'unexpectedly low provider tool count');

  console.log('[5/8] One-click provider health/sample test');
  const providerTest = await call('POST', `/api/registry/agents/${encodeURIComponent(agentId)}/provider/test`, {
    serviceType: 'scrape',
    sampleInput: { url: 'https://example.com', format: 'markdown' },
  });
  assert(providerTest.ok, `provider/test failed: ${providerTest.status} ${JSON.stringify(providerTest.json)}`);
  assert(providerTest.json?.execution?.ok === true, 'provider/test execution did not succeed');

  console.log('[6/8] Request service from seller route (expect 402 + quote + requirement)');
  const buyerToken = jwt.sign({ userId: `buyer-${timestamp}`, email: 'buyer@test.local' }, JWT_SECRET, { expiresIn: '1h' });
  const seller402 = await call(
    'POST',
    '/api/agent/services/scrape',
    { url: 'https://example.com', user_email: buyerEmail },
    { Authorization: `Bearer ${buyerToken}`, 'X-Agent-Id': agentId },
  );
  assert(seller402.status === 402, `expected 402, got ${seller402.status}: ${JSON.stringify(seller402.json)}`);
  assert(!!seller402.json?.quote, 'missing quote in 402 response');
  assert(!!seller402.json?.requirement, 'missing requirement in 402 response');
  assert(seller402.json?.quote?.source, 'quote source missing');
  assert(seller402.json?.requirement?.protocol === 'x402', 'requirement protocol is not x402');

  console.log('[7/8] Extracted quote + payment requirement');
  console.log(JSON.stringify({
    quote: seller402.json.quote,
    requirement: seller402.json.requirement,
  }, null, 2));

  console.log('[8/8] Optional paid flow attempt');
  if (RUN_PAID_FLOW && TEST_USER_EMAIL) {
    const paidAttempt = await call('POST', '/api/chatgpt-agent/request-service', {
      user_email: TEST_USER_EMAIL,
      agent_id: agentId,
      service_type: 'scrape',
      service_params: { url: 'https://example.com' },
    });
    console.log(`paid flow status=${paidAttempt.status}`);
    console.log(JSON.stringify(paidAttempt.json, null, 2));
  } else {
    console.log('Skipped paid flow. Set RUN_PAID_FLOW=true and TEST_USER_EMAIL=<funded_user_email> to run.');
  }

  console.log('\n✅ E2E provider onboarding flow passed.');
}

main().catch((err) => {
  console.error('\n❌ E2E provider onboarding flow failed.');
  console.error(err);
  process.exit(1);
});

