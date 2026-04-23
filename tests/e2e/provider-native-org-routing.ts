import { DB } from '@agentic-commerce/database';

const API_BASE = process.env.API_URL || 'http://localhost:3001';
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || '';
const AGENT_ID = process.env.AGENT_ID || '';
const SERVICE_TYPE = process.env.SERVICE_TYPE || 'scrape';
const SERVICE_PARAMS = process.env.SERVICE_PARAMS_JSON
  ? JSON.parse(process.env.SERVICE_PARAMS_JSON)
  : { url: 'https://example.com', format: 'markdown' };

function assert(condition: any, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function post(path: string, body: any) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function main() {
  assert(TEST_USER_EMAIL, 'TEST_USER_EMAIL is required');
  assert(AGENT_ID, 'AGENT_ID is required');
  const db = new DB(process.env.DATABASE_URL);
  try {
    const user = await db.getUserByEmail(TEST_USER_EMAIL);
    assert(user, `User not found: ${TEST_USER_EMAIL}`);

    const challenge = await post('/api/chatgpt-agent/request-service/provider-native/submit', {
      user_email: TEST_USER_EMAIL,
      agent_id: AGENT_ID,
      service_type: SERVICE_TYPE,
      service_params: SERVICE_PARAMS,
    });
    assert(challenge.status === 402, `Expected 402 challenge, got ${challenge.status}`);
    const paymentToSign = challenge.json?.paymentToSign;
    assert(paymentToSign?.network && paymentToSign?.asset, 'Missing provider payment leg');

    const now = Date.now();
    const org = await db.createOrganization({
      name: `Routing Org ${now}`,
      slug: `routing-org-${now}`,
      ownerUserId: user.id,
      metadata: { e2e: true },
    });

    const wallet = await db.createOrgTreasuryWallet({
      orgId: org.id,
      name: 'Primary Routing Wallet',
      address: process.env.TREASURY_PUBLIC_KEY || '11111111111111111111111111111111',
      network: String(paymentToSign.network),
      asset: String(paymentToSign.asset),
      status: 'active',
      priority: 1,
      keyCiphertext: process.env.ORG_TEST_KEY_CIPHERTEXT || Buffer.from('test-only').toString('base64'),
      metadata: { e2e: true },
      createdBy: user.id,
    });
    await db.upsertOrgTreasuryPolicy(org.id, {
      routingMode: 'priority',
      allowNetworks: [String(paymentToSign.network)],
      allowAssets: [String(paymentToSign.asset)],
    });
    await db.topUpOrgTreasury({
      orgId: org.id,
      amount: 20,
      currency: 'USDC',
      referenceType: 'e2e-seed',
      referenceId: `seed_${now}`,
      metadata: { e2e: true },
    });
    await db.allocateOrgTreasuryToUserFunding({
      orgId: org.id,
      userId: user.id,
      amount: 5,
      currency: 'USDC',
      metadata: { e2e: true },
    });

    const preview = await post('/api/chatgpt-agent/request-service', {
      user_email: TEST_USER_EMAIL,
      agent_id: AGENT_ID,
      service_type: SERVICE_TYPE,
      service_params: SERVICE_PARAMS,
      confirm_payment: false,
      idempotency_key: `routing-preview-${now}`,
    });
    assert(preview.status === 200, `Expected 200 preview response, got ${preview.status}: ${JSON.stringify(preview.json)}`);
    assert(preview.json?.error === 'CONFIRMATION_REQUIRED', `Expected CONFIRMATION_REQUIRED, got ${JSON.stringify(preview.json)}`);
    assert(preview.json?.transactionPreview?.treasuryWalletId === wallet.id, 'Preview wallet routing mismatch');

    console.log('provider-native-org-routing e2e passed');
    console.log(JSON.stringify({
      orgId: org.id,
      walletId: wallet.id,
      preview: preview.json?.transactionPreview,
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error('\nprovider-native-org-routing e2e failed');
  console.error(err);
  process.exit(1);
});

