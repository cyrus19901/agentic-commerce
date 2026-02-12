#!/usr/bin/env npx tsx
/**
 * Test wallet balance once and output a clear decision.
 * Usage: npx tsx scripts/test-wallet-and-decide.ts [email]
 * Example: npx tsx scripts/test-wallet-and-decide.ts test@gmail.com
 *
 * Uses API_URL (default http://localhost:3000). Optionally set SOLANA_RPC_DEVNET
 * to match the API when doing direct RPC check.
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';

async function main() {
  const email = process.argv[2] || 'test@gmail.com';
  console.log('🔍 Test wallet once, then decide\n');
  console.log('  Email:', email);
  console.log('  API: ', API_URL);
  console.log('');

  // 1. Call wallet endpoint once
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/chatgpt-agent/wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_email: email }),
    });
  } catch (e: any) {
    console.log('❌ Request failed:', e.message);
    console.log('\n📌 Decision: API unreachable. Start API (docker compose up -d) and ensure ngrok is running if testing from outside.');
    process.exit(1);
  }

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    console.log('❌ Invalid JSON response:', text.slice(0, 200));
    console.log('\n📌 Decision: Check API logs and health (GET /health).');
    process.exit(1);
  }

  if (!res.ok) {
    console.log('❌ API error', res.status, data?.error || data?.message || text.slice(0, 100));
    if (data?.error === 'USER_NOT_FOUND') {
      console.log('\n📌 Decision: Create user first (e.g. POST /api/auth/create-user with this email).');
    } else if (res.status === 404) {
      console.log('\n📌 Decision: Rebuild API image (docker compose build api) and restart.');
    } else {
      console.log('\n📌 Decision: Fix API or DB; check logs.');
    }
    process.exit(1);
  }

  const wallet = data.wallet;
  if (!wallet) {
    console.log('❌ No wallet in response');
    process.exit(1);
  }

  const { publicKey, tokenAccount, network, balances, balanceNote, solscanTokenAccountUrl } = wallet;
  const usdc = Number(balances?.usdc ?? 0);
  const sol = Number(balances?.sol ?? 0);

  console.log('  Wallet:', publicKey);
  console.log('  USDC ATA:', tokenAccount);
  console.log('  Network:', network);
  console.log('  SOL:', sol, '| USDC (API):', usdc);
  if (balanceNote) console.log('  Note:', balanceNote);
  if (solscanTokenAccountUrl) console.log('  Solscan:', solscanTokenAccountUrl);
  console.log('');

  // When API says 0, query RPC directly: try finalized commitment, then getAccount (getAccountInfo) if getTokenAccountBalance fails
  let directUsdc: number | null = null;
  const rpcUrl = process.env.SOLANA_RPC_DEVNET || 'https://solana-devnet.g.alchemy.com/v2/ZJmVXF-LVxv651ws9azjqBr6Upv_l9_5';
  const rpcLabel = rpcUrl.replace(/\/\/.*@/, '//***@').slice(0, 50);
  if (usdc === 0 && tokenAccount && network !== 'mainnet-beta') {
    const warn = console.warn;
    console.warn = () => {};
    const { Connection, PublicKey } = await import('@solana/web3.js');
    const pk = new PublicKey(tokenAccount);
    const connFinalized = new Connection(rpcUrl, 'finalized');
    const USDC_DECIMALS = 6;

    // 1) getTokenAccountBalance with finalized (most likely to see the account)
    try {
      const info = await connFinalized.getTokenAccountBalance(pk);
      directUsdc = info?.value?.uiAmount ?? 0;
      console.log('  Direct RPC (' + rpcLabel + '...), finalized:', directUsdc, 'USDC');
      console.log('');
    } catch {
      // 2) Fallback: getAccount (uses getAccountInfo) and derive balance from raw amount
      try {
        const { getAccount } = await import('@solana/spl-token');
        const account = await getAccount(connFinalized, pk);
        directUsdc = Number(account.amount) / 10 ** USDC_DECIMALS;
        console.log('  Direct RPC (' + rpcLabel + '...), getAccount:', directUsdc, 'USDC');
        console.log('');
      } catch (e: any) {
        // 3) Fallback: list token accounts for wallet (publicKey), then for tokenAccount (in case it's the owner of the real token account, e.g. 67Csvx -> Hc44ZL)
        const USDC_DEVNET_MINT = process.env.USDC_MINT_DEVNET || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';
        const tryOwner = async (ownerPk: import('@solana/web3.js').PublicKey, label: string) => {
          const { TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
          const parsed = await connFinalized.getParsedTokenAccountsByOwner(ownerPk, { programId: TOKEN_PROGRAM_ID });
          for (const { pubkey, account } of parsed.value) {
            const info = account.data?.parsed?.info;
            if (info?.mint === USDC_DEVNET_MINT) {
              const amt = info?.tokenAmount?.uiAmount ?? 0;
              const addr = pubkey.toBase58();
              return { amt, addr, label };
            }
          }
          return null;
        };
        try {
          let result = await tryOwner(new PublicKey(publicKey), 'wallet');
          if (!result) result = await tryOwner(pk, 'tokenAccount as owner');
          if (result) {
            directUsdc = result.amt;
            const same = result.addr === tokenAccount ? ' (same as API tokenAccount)' : ' (API tokenAccount is owner of this)';
            console.log('  Direct RPC (' + rpcLabel + '...), getParsedTokenAccountsByOwner(' + result.label + '):', result.amt, 'USDC at', result.addr + same);
            console.log('');
          } else {
            const msg = (e?.message || String(e)).replace(/\s+/g, ' ').trim();
            console.log('  Direct RPC (' + rpcLabel + '...):', msg);
            console.log('');
          }
        } catch {
          const msg = (e?.message || String(e)).replace(/\s+/g, ' ').trim();
          console.log('  Direct RPC (' + rpcLabel + '...):', msg);
          console.log('');
        }
      }
    }
    console.warn = warn;
  }

  // 2. Decide
  if (usdc > 0 || (directUsdc != null && directUsdc > 0)) {
    if (usdc === 0 && directUsdc != null && directUsdc > 0) {
      console.log('✅ Decision: RPC has balance (' + directUsdc + ' USDC) but API returned 0. API may be using a different RPC — set SOLANA_RPC_DEVNET in Docker to match, or retry.');
    } else {
      console.log('✅ Decision: Wallet has USDC. No action needed.');
    }
    process.exit(0);
  }

  const alreadySent = balanceNote && /transfer succeeded|RPC is lagging|just sent/i.test(balanceNote);
  console.log('📌 Decision: USDC balance is 0 (API and direct RPC).');
  if (alreadySent) {
    console.log('   • Your transfer succeeded (see Solscan) but this RPC has not indexed it yet.');
    console.log('   • Try a different devnet RPC and set SOLANA_RPC_DEVNET (e.g. Helius: https://devnet.helius-rpc.com/?api-key=YOUR_KEY).');
    console.log('   • Restart API after changing RPC so it picks up the new endpoint.');
  } else {
    console.log('   • Send devnet USDC to the token account above.');
    console.log('   • Mint: Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');
    if (solscanTokenAccountUrl) console.log('   • Solscan:', solscanTokenAccountUrl);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
