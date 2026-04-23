/* eslint-disable @typescript-eslint/no-var-requires */

// Firecrawl's x402 API only exposes a single /search endpoint.
// Scraping a specific URL is done by searching for the URL with limit=1 and scrapeOptions.
// The x402 endpoint still requires the Firecrawl API key for auth; the x402 payment
// replaces the billing/rate-limit layer, not authentication.
const FIRECRAWL_X402_ENDPOINT =
  process.env.FIRECRAWL_X402_ENDPOINT || 'https://api.firecrawl.dev/v2/x402/search';
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';

const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const USDC_BASE_CONTRACT = process.env.USDC_BASE_CONTRACT || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MAX_PAYMENT_USDC = Number(process.env.FIRECRAWL_X402_MAX_PAYMENT || '0.10');
const X402_TIMEOUT_MS = Number(process.env.FIRECRAWL_X402_TIMEOUT_MS || '30000');

export interface X402AgentResult {
  success: boolean;
  data: unknown;
  baseTxHash?: string;
  paymentAmount?: string;
  agentWallet?: string;
  error?: string;
}

/**
 * Firecrawl x402 Agent — holds a Base (L2) wallet and pays Firecrawl per-request
 * via the x402 payment protocol. Falls back gracefully when the private key is not
 * configured (the caller should then use the API-key flow).
 */
export class FirecrawlX402Agent {
  // All viem/x402 objects stored as `any` to avoid pulling ox's .ts files into compilation
  private walletClient: any = null;
  private agentAddress: string | null = null;
  private paidFetch: typeof globalThis.fetch | null = null;
  private ready = false;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    const privateKey = process.env.FIRECRAWL_AGENT_PRIVATE_KEY;
    if (!privateKey) {
      console.log('[FirecrawlX402Agent] No FIRECRAWL_AGENT_PRIVATE_KEY set — agent disabled (will fallback to API key).');
      return;
    }

    try {
      const viem: any = require('viem');
      const viemAccounts: any = require('viem/accounts');
      const viemChains: any = require('viem/chains');
      const x402: any = require('x402-fetch');

      const account = viemAccounts.privateKeyToAccount(privateKey as `0x${string}`);
      this.agentAddress = account.address;

      this.walletClient = viem
        .createWalletClient({
          account,
          chain: viemChains.base,
          transport: viem.http(BASE_RPC_URL),
        })
        .extend(viem.publicActions);

      this.paidFetch = x402.wrapFetchWithPayment(globalThis.fetch, this.walletClient, {
        maxPaymentAmount: BigInt(Math.round(MAX_PAYMENT_USDC * 1_000_000)),
      }) as typeof globalThis.fetch;

      this.ready = true;
      console.log(`[FirecrawlX402Agent] Ready. Agent wallet: ${this.agentAddress} on Base`);
    } catch (err: any) {
      console.error('[FirecrawlX402Agent] Init error:', err.message);
    }
  }

  /** Wait until the constructor's async init has completed. */
  async waitUntilReady(): Promise<void> {
    await this.initPromise;
  }

  isReady(): boolean {
    return this.ready && this.paidFetch !== null;
  }

  getAgentAddress(): string | null {
    return this.agentAddress;
  }

  async getBalance(): Promise<{ eth: string; usdc: string } | null> {
    await this.initPromise;
    if (!this.walletClient || !this.agentAddress) return null;

    try {
      const viem: any = require('viem');

      const ethBalance: bigint = await this.walletClient.getBalance({
        address: this.agentAddress as `0x${string}`,
      });

      const usdcBalance: bigint = await this.walletClient.readContract({
        address: USDC_BASE_CONTRACT as `0x${string}`,
        abi: [
          {
            name: 'balanceOf',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'account', type: 'address' }],
            outputs: [{ name: '', type: 'uint256' }],
          },
        ],
        functionName: 'balanceOf',
        args: [this.agentAddress as `0x${string}`],
      });

      return {
        eth: viem.formatUnits(ethBalance, 18),
        usdc: viem.formatUnits(usdcBalance, 6),
      };
    } catch (err: any) {
      console.error('[FirecrawlX402Agent] Balance check failed:', err.message);
      return null;
    }
  }

  async search(query: string, options?: { limit?: number }): Promise<X402AgentResult> {
    await this.initPromise;
    if (!this.isReady() || !this.paidFetch) {
      return { success: false, data: null, error: 'Agent not ready (no private key or init failed)' };
    }

    try {
      console.log(`[FirecrawlX402Agent] Searching: "${query}" via x402 (timeout ${X402_TIMEOUT_MS}ms)`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), X402_TIMEOUT_MS);
      const response = await this.paidFetch(FIRECRAWL_X402_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        },
        body: JSON.stringify({
          query,
          limit: options?.limit || 5,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const baseTxHash = response.headers.get('x-payment-response') || undefined;
      const paymentAmount = response.headers.get('x-payment-amount') || undefined;

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: { error: errorText, status: response.status },
          baseTxHash,
          paymentAmount,
          agentWallet: this.agentAddress || undefined,
          error: `Firecrawl x402 search error (${response.status}): ${errorText}`,
        };
      }

      const data = await response.json();
      console.log(`[FirecrawlX402Agent] Search complete. Base tx: ${baseTxHash || 'none'}`);

      return {
        success: true,
        data,
        baseTxHash,
        paymentAmount,
        agentWallet: this.agentAddress || undefined,
      };
    } catch (err: any) {
      console.error('[FirecrawlX402Agent] Search error:', err.message);
      return { success: false, data: null, error: err.message };
    }
  }

  async scrape(url: string): Promise<X402AgentResult> {
    await this.initPromise;
    if (!this.isReady() || !this.paidFetch) {
      return { success: false, data: null, error: 'Agent not ready (no private key or init failed)' };
    }

    try {
      console.log(`[FirecrawlX402Agent] Scraping: ${url} via x402 (timeout ${X402_TIMEOUT_MS}ms)`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), X402_TIMEOUT_MS);
      const response = await this.paidFetch(FIRECRAWL_X402_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        },
        body: JSON.stringify({
          query: url,
          limit: 1,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const baseTxHash = response.headers.get('x-payment-response') || undefined;
      const paymentAmount = response.headers.get('x-payment-amount') || undefined;

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: { error: errorText, status: response.status },
          baseTxHash,
          paymentAmount,
          agentWallet: this.agentAddress || undefined,
          error: `Firecrawl x402 scrape error (${response.status}): ${errorText}`,
        };
      }

      const data = await response.json();
      console.log(`[FirecrawlX402Agent] Scrape complete. Base tx: ${baseTxHash || 'none'}`);

      return {
        success: true,
        data,
        baseTxHash,
        paymentAmount,
        agentWallet: this.agentAddress || undefined,
      };
    } catch (err: any) {
      console.error('[FirecrawlX402Agent] Scrape error:', err.message);
      return { success: false, data: null, error: err.message };
    }
  }

  getBaseScanUrl(txHash: string): string {
    return `https://basescan.org/tx/${txHash}`;
  }

  getStatus(): {
    ready: boolean;
    agentWallet: string | null;
    network: string;
    maxPaymentUsdc: number;
    endpoint: string;
  } {
    return {
      ready: this.ready,
      agentWallet: this.agentAddress,
      network: 'Base (L2)',
      maxPaymentUsdc: MAX_PAYMENT_USDC,
      endpoint: FIRECRAWL_X402_ENDPOINT,
    };
  }
}
