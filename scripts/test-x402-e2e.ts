/**
 * End-to-end x402 test harness — compares “canonical” Coinbase flow with optional Gordon API check.
 *
 * Prerequisites:
 *   npm run build --workspace=@agentic-commerce/shared
 *   npm run build --workspace=@agentic-commerce/integrations
 *
 * Env (Bazaar / external resource):
 *   BUYER_PRIVATE_KEY or DEMO_BUYER_PRIVATE_KEY — funded with USDC on the chain of the chosen offer
 *   CDP_API_KEY_ID + CDP_API_KEY_SECRET — required for Coinbase facilitator verify/settle
 *
 * Env (Gordon mode):
 *   Same signer; optional API key via --api-key or GORDON_API_KEY (default demo key)
 *
 * Usage:
 *   npx tsx scripts/test-x402-e2e.ts
 *   npx tsx scripts/test-x402-e2e.ts --index 2 --network base-sepolia
 *   npx tsx scripts/test-x402-e2e.ts --no-settle
 *   npx tsx scripts/test-x402-e2e.ts --mode gordon --gordon-base http://localhost:3001
 */

import 'dotenv/config';
import { randomBytes } from 'crypto';
import { createWalletClient, http, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, arbitrum, polygon } from 'viem/chains';
import { X402FacilitatorClient, type X402PaymentRequirements } from '../packages/integrations/dist/x402-facilitator-client.js';
import { getChainConfig, toCaip2 } from '../packages/shared/dist/chain-config.js';

const DISCOVERY_URL =
  process.env.X402_DISCOVERY_URL ??
  'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';

const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

type DiscoveryItem = {
  resource: string;
  type: string;
  x402Version?: number;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra?: { name?: string; version?: string; assetTransferMethod?: string };
    mimeType?: string;
    outputSchema?: { input?: { method?: string; type?: string } };
  }>;
  metadata?: { description?: string };
  lastUpdated?: string;
};

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean | number> = { mode: 'bazaar' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode' && argv[i + 1]) {
      out.mode = argv[++i];
    } else if (a === '--index' && argv[i + 1]) {
      out.index = Number(argv[++i]);
    } else if (a === '--network' && argv[i + 1]) {
      out.network = argv[++i];
    } else if (a === '--gordon-base' && argv[i + 1]) {
      out.gordonBase = argv[++i];
    } else if (a === '--api-key' && argv[i + 1]) {
      out.apiKey = argv[++i];
    } else if (a === '--no-settle') {
      out.noSettle = true;
    } else if (a === '--resource' && argv[i + 1]) {
      out.resource = argv[++i];
    }
  }
  return out as {
    mode: string;
    index?: number;
    network?: string;
    gordonBase?: string;
    apiKey?: string;
    noSettle?: boolean;
    resource?: string;
  };
}

function viemChainFor(caip2: string): Chain {
  const id = getChainConfig(caip2)?.chainId ?? 8453;
  if (id === 8453) return base;
  if (id === 84532) return baseSepolia;
  if (id === 137) return polygon;
  if (id === 42161) return arbitrum;
  return base;
}

async function discoverItems(limit: number): Promise<DiscoveryItem[]> {
  const url = `${DISCOVERY_URL}?limit=${limit}&offset=0`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Discovery failed ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = (await res.json()) as { items?: DiscoveryItem[]; resources?: DiscoveryItem[] };
  const items = data.items ?? data.resources ?? [];
  if (!items.length) throw new Error('Discovery returned no items (check API shape: expected `items`)');
  return items;
}

function inferMethod(item: DiscoveryItem): 'GET' | 'POST' {
  const m = item.accepts[0]?.outputSchema?.input?.method;
  if (m && String(m).toUpperCase() === 'GET') return 'GET';
  return 'POST';
}

function acceptToRequirements(item: DiscoveryItem, acceptIdx: number): X402PaymentRequirements {
  const acc = item.accepts[acceptIdx];
  if (!acc) throw new Error('No accept entry');
  const method = inferMethod(item);
  return {
    scheme: 'exact',
    network: toCaip2(acc.network),
    maxAmountRequired: acc.maxAmountRequired,
    asset: acc.asset,
    payTo: acc.payTo.trim(),
    maxTimeoutSeconds: acc.maxTimeoutSeconds || 60,
    resource: {
      url: item.resource,
      method,
      description: item.metadata?.description,
      mimeType: acc.mimeType,
    },
    extra: {
      name: acc.extra?.name ?? getChainConfig(toCaip2(acc.network))?.usdcName ?? 'USD Coin',
      version: acc.extra?.version ?? getChainConfig(toCaip2(acc.network))?.usdcVersion ?? '2',
      assetTransferMethod: acc.extra?.assetTransferMethod ?? 'eip3009',
    },
  };
}

async function signPaymentPayload(
  requirements: X402PaymentRequirements,
  privateKey: `0x${string}`,
): Promise<string> {
  const caip2 = toCaip2(requirements.network);
  const chainCfg = getChainConfig(caip2);
  if (!chainCfg) throw new Error(`Unsupported network: ${requirements.network}`);

  const account = privateKeyToAccount(privateKey);
  const chain = viemChainFor(caip2);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(chainCfg.rpcUrl),
  });

  const now = Math.floor(Date.now() / 1000);
  const timeout = requirements.maxTimeoutSeconds || 60;
  const validBefore = BigInt(now + timeout);
  const nonce = (`0x${randomBytes(32).toString('hex')}`) as `0x${string}`;

  const domain = {
    name: requirements.extra?.name ?? chainCfg.usdcName,
    version: requirements.extra?.version ?? chainCfg.usdcVersion,
    chainId: chainCfg.chainId,
    verifyingContract: requirements.asset as `0x${string}`,
  };

  const message = {
    from: account.address,
    to: requirements.payTo as `0x${string}`,
    value: BigInt(requirements.maxAmountRequired),
    validAfter: 0n,
    validBefore,
    nonce,
  };

  const signature = await walletClient.signTypedData({
    account,
    domain,
    types: TRANSFER_TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
  });

  const paymentPayload = {
    x402Version: 2,
    scheme: 'exact' as const,
    network: caip2,
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: requirements.payTo,
        value: requirements.maxAmountRequired,
        validAfter: '0',
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  };

  return Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
}

async function fetchResource(
  resourceUrl: string,
  method: 'GET' | 'POST',
  paymentHeader: string,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'curl/8.7.1',
    'X-PAYMENT': paymentHeader,
    'PAYMENT-SIGNATURE': paymentHeader,
  };
  const init: RequestInit =
    method === 'GET'
      ? { method: 'GET', headers }
      : {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        };

  const res = await fetch(resourceUrl, init);
  const h: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    h[k.toLowerCase()] = v;
  });
  const body = await res.text();
  return { status: res.status, headers: h, body };
}

async function runBazaar(opts: {
  index: number;
  networkFilter?: string;
  resourceOverride?: string;
  noSettle?: boolean;
}) {
  const pk = (process.env.BUYER_PRIVATE_KEY || process.env.DEMO_BUYER_PRIVATE_KEY) as `0x${string}` | undefined;
  if (!pk) throw new Error('Set BUYER_PRIVATE_KEY or DEMO_BUYER_PRIVATE_KEY');

  const keyId = process.env.CDP_API_KEY_ID;
  const keySecret = process.env.CDP_API_KEY_SECRET;
  if (!keyId || !keySecret) {
    console.warn('⚠️  CDP_API_KEY_ID / CDP_API_KEY_SECRET missing — facilitator verify/settle will likely fail (401).');
  }

  let item: DiscoveryItem;
  let acceptIdx = 0;

  if (opts.resourceOverride) {
    const res = await fetch(opts.resourceOverride, { method: 'GET', headers: { 'User-Agent': 'curl/8.7.1' } });
    if (res.status !== 402) {
      throw new Error(`Direct resource expected 402, got ${res.status}`);
    }
    const body = (await res.json()) as { accepts?: DiscoveryItem['accepts'] };
    if (!body.accepts?.length) throw new Error('402 body has no accepts');
    item = {
      resource: opts.resourceOverride,
      type: 'http',
      accepts: body.accepts as DiscoveryItem['accepts'],
    };
  } else {
    const items = await discoverItems(25);
    const filter = opts.networkFilter ? toCaip2(opts.networkFilter) : undefined;
    const filtered = filter
      ? items.filter((it) => it.accepts?.[0] && toCaip2(it.accepts[0].network) === filter)
      : items;
    const pick = filtered[opts.index] ?? filtered[0];
    if (!pick) throw new Error(`No discovery item at index ${opts.index} (after filter)`);
    item = pick;
    console.log(`\n📌 Selected discovery item:\n   ${item.resource}\n   network(raw)=${item.accepts[0]?.network}\n`);
  }

  const requirements = acceptToRequirements(item, acceptIdx);
  const method = requirements.resource.method as 'GET' | 'POST';

  console.log('━━ Step A: probe resource (no payment) ━━');
  const probe = await fetch(item.resource, {
    method,
    headers: { Accept: 'application/json', 'User-Agent': 'curl/8.7.1', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    body: method === 'POST' ? JSON.stringify({}) : undefined,
  });
  console.log(`   status=${probe.status} (expect 402 for paid routes)`);

  console.log('\n━━ Step B: sign EIP-3009 (off-chain) ━━');
  const paymentHeader = await signPaymentPayload(requirements, pk);
  console.log(`   PAYMENT header length=${paymentHeader.length} (base64)`);

  const facilitator = new X402FacilitatorClient();

  console.log('\n━━ Step C: facilitator /verify ━━');
  const verify = await facilitator.verify(paymentHeader, requirements);
  console.log(JSON.stringify(verify, null, 2));
  if (!verify.isValid) throw new Error(`Verify failed: ${verify.invalidReason}`);

  let settleTx: string | undefined;
  if (!opts.noSettle) {
    console.log('\n━━ Step D: facilitator /settle ━━');
    const settle = await facilitator.settle(paymentHeader, requirements);
    console.log(JSON.stringify(settle, null, 2));
    if (!settle.success) throw new Error(`Settle failed: ${settle.errorReason}`);
    settleTx = settle.transaction;
    const exp = settle.network ? getChainConfig(toCaip2(settle.network)) : getChainConfig(requirements.network);
    if (settleTx && exp) console.log(`   Explorer: ${exp.explorerUrl}${exp.explorerTxPath}${settleTx}`);
  } else {
    console.log('\n━━ Step D: skipped (--no-settle) ━━');
  }

  console.log('\n━━ Step E: retry resource with X-PAYMENT (+ PAYMENT_SIGNATURE alias) ━━');
  const final = await fetchResource(item.resource, method, paymentHeader);
  console.log(`   status=${final.status}`);
  const pr = final.headers['payment-response'] ?? final.headers['x-payment-response'];
  if (pr) console.log(`   payment-response header: present (${pr.slice(0, 48)}…)`);
  console.log(`   body preview: ${final.body.slice(0, 400)}`);

  return { verify, settleTx, finalStatus: final.status };
}

async function runGordon(gordonBase: string, apiKey: string) {
  const pk = (process.env.BUYER_PRIVATE_KEY || process.env.DEMO_BUYER_PRIVATE_KEY) as `0x${string}` | undefined;
  if (!pk) throw new Error('Set BUYER_PRIVATE_KEY or DEMO_BUYER_PRIVATE_KEY');

  const base = gordonBase.replace(/\/$/, '');
  const headers = { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };

  const body = {
    provider: 'zyte',
    action: 'scrape',
    params: { url: 'https://example.com' },
    max_payment_usdc: 0.5,
  };

  console.log('\n━━ Gordon: POST /api/v1/payments/execute (quote) ━━');
  const q = await fetch(`${base}/api/v1/payments/execute`, { method: 'POST', headers, body: JSON.stringify(body) });
  const qText = await q.text();
  console.log(`   status=${q.status}`);
  if (q.status !== 402) {
    console.log(qText.slice(0, 600));
    throw new Error('Expected 402 from Gordon for zyte scrape');
  }
  const paymentRequired = JSON.parse(qText) as Record<string, unknown>;

  console.log('\n━━ Gordon: POST /api/demo/sign-x402 ━━');
  const signRes = await fetch(`${base}/api/demo/sign-x402?preferredNetwork=eip155:8453`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(paymentRequired),
  });
  const signJson = (await signRes.json()) as { paymentHeader?: string; error?: string };
  if (!signRes.ok || signJson.error) throw new Error(signJson.error || `sign failed ${signRes.status}`);

  console.log('\n━━ Gordon: POST /api/v1/payments/execute (paid) ━━');
  const paid = await fetch(`${base}/api/v1/payments/execute`, {
    method: 'POST',
    headers: { ...headers, 'PAYMENT-SIGNATURE': signJson.paymentHeader! },
    body: JSON.stringify(body),
  });
  const paidJson = await paid.json();
  console.log(`   status=${paid.status}`);
  console.log(JSON.stringify({ status: paidJson.status, x402Settlement: paidJson.x402Settlement, error: paidJson.error }, null, 2));
  if (paidJson.status !== 'completed') throw new Error(`Gordon execution did not complete: ${paidJson.error || 'unknown'}`);
  console.log('\n✅ Gordon path OK (zyte scrape + settlement metadata as returned by API)');
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.mode === 'gordon') {
    const base = opts.gordonBase || 'http://localhost:3001';
    const key = opts.apiKey || process.env.GORDON_API_KEY || 'ak_demo_live_test_key_2024';
    await runGordon(base, key);
    return;
  }

  const index = Number.isFinite(opts.index as number) ? (opts.index as number) : 0;
  await runBazaar({
    index,
    networkFilter: opts.network,
    resourceOverride: opts.resource,
    noSettle: !!opts.noSettle,
  });
  console.log('\n✅ Bazaar x402 path finished (discovery uses `items`; facilitator matches integrations client).');
}

main().catch((e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
