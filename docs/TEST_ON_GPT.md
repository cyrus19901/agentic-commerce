# Test Everything on ChatGPT (GPT)

## 1. Expose your API to the internet

ChatGPT can’t call `localhost`. Use ngrok:

```bash
# In a terminal (with Docker API running on port 3000)
ngrok http 3000
```

Copy the **HTTPS** URL (e.g. `https://abc123.ngrok-free.app`).

## 2. Point your GPT at the API

1. Open your GPT → **Configure** → **Actions**.
2. Open the action that uses `gpt-action-schema.yaml`.
3. In the schema, set **Server URL** to your ngrok URL (e.g. `https://abc123.ngrok-free.app`).
   - Or edit `docs/gpt-action-schema.yaml`: under `servers:`, set `url:` to your ngrok URL, then re-import the schema.

## 3. Test in the GPT chat

Use **cyrus19901@gmail.com** (this user is linked to the funded E2E buyer wallet).

### A. Create user (optional – already exists)

Say:
```
Create a user with email cyrus19901@gmail.com and name Cyrus
```

### B. Get wallet / balance

Say:
```
Get my Solana wallet for cyrus19901@gmail.com
```
or:
```
Check my wallet balance for cyrus19901@gmail.com
```

You should see ~0.99 SOL and ~1983 USDC.

### C. List agents

Say:
```
Show me all available agents I can buy services from
```

You should see seller.scraper, seller-test, etc.

### D. Request a paid service (full flow)

Say:
```
Request the data-scraping service from agent agent://seller.scraper/v1 to scrape https://example.com and extract the title. Use my email cyrus19901@gmail.com.
```

You should get:
- Success message
- Payment: 0.1 USDC + Solana transaction link
- Service result (mock data)

### E. Request again (optional)

Same as D, or try:
```
Buy data-scraping from seller.scraper for https://example.com
```

## 4. If something fails

- **“Cannot connect” / timeout**  
  - API must be running: `curl http://localhost:3000/health`  
  - ngrok must be running and the GPT must use that HTTPS URL.

- **“User not found”**  
  - Create the user first (step 3A).

- **“Insufficient funds”**  
  - Your GPT user must be the one linked to the E2E buyer wallet. Use **cyrus19901@gmail.com** and ensure the link script was run (see main README / ChatGPT testing guide).

- **Schema / 404**  
  - Server URL in the GPT action must be exactly your ngrok URL (no trailing slash), and the schema should include the `/api/chatgpt-agent/wallet` and `/api/chatgpt-agent/request-service` endpoints.

- **USDC balance shows 0 / “could not find account”**  
  On Solana, a token balance only exists if the **Associated Token Account (ATA)** for that mint exists on-chain. The RPC error means the USDC token account has not been created yet.  
  - **Option 1 (recommended):** Use the [Circle Devnet Faucet](https://faucet.circle.com/) (or SPL token faucet).  
    - **Mint:** `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` (USDC-Dev).  
    - **Send to the token account** (not the wallet address), e.g. `67CsvxYp2FmMZTqGPyjcjzCVX1zWouR4kXR7rmLzGKao` — the wallet response includes `tokenAccount` and `solscanTokenAccountUrl` so you can confirm the address. The first successful transfer creates the ATA.  
  - **Option 2:** If you already sent a transfer, paste the **transaction signature** and check on [Solscan (devnet)](https://solscan.io?cluster=devnet): confirm it hit devnet, used the correct mint, and that the destination is the token account (ATA) for your wallet.

## 5. How to test (after code changes)

### Option A: Local API + curl (no ChatGPT)

1. Start API and DB (Docker or local):
   ```bash
   cd /path/to/agentic-commerce
   docker compose up -d
   # Or: npm run dev
   ```
2. Ensure DB has a user and (optional) linked buyer wallet:
   ```bash
   npm run db:setup   # if needed
   DATABASE_PATH=./packages/database/data/shopping.db npm run link-buyer-wallet  # optional, for funded wallet
   ```
3. Smoke-test wallet (create/lookup) and request-service:
   ```bash
   BASE=http://localhost:3000
   # Wallet (use an email that exists in DB, or create user first)
   curl -s -X POST "$BASE/api/chatgpt-agent/wallet" -H "Content-Type: application/json" -d '{"email":"cyrus19901@gmail.com","name":"Cyrus"}' | jq .
   # Request service (same user must have wallet with USDC if you want payment to succeed)
   curl -s -X POST "$BASE/api/chatgpt-agent/request-service" -H "Content-Type: application/json" \
     -d '{"email":"cyrus19901@gmail.com","agentId":"agent://seller.scraper/v1","serviceType":"data-scraping","serviceParams":{"url":"https://example.com","extractFields":["title"]}}' | jq .
   ```
   Expect: wallet returns `publicKey` and balances; request-service returns `success: true`, `payment`, and `serviceResult` (mock content).

### Option B: Full flow via ChatGPT

Follow sections 1–4 above: start API, run ngrok, set GPT server URL to ngrok HTTPS, then in the GPT use **cyrus19901@gmail.com** and the prompts in 3B–3D.

### Option C: E2E test (agent x402, not ChatGPT routes)

```bash
API_URL=http://localhost:3000 npm run test:e2e:real
```
Requires API running and devnet config; exercises agent 402 flow, not the ChatGPT wallet/request-service endpoints.

## Quick checklist

- [ ] Docker API: `docker compose up -d` (or `npm run dev`)
- [ ] ngrok: `ngrok http 3000`
- [ ] GPT Actions: server URL = your ngrok HTTPS URL
- [ ] In chat: use email **cyrus19901@gmail.com** for wallet and request-service
