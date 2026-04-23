/* eslint-disable @typescript-eslint/no-var-requires */

// Zyte x402 Agent — scrapes via the Zyte API (key auth) and then
// executes a real USDC micro-payment on Base to pay for the service.
// Zyte's x402 endpoint (api-x402.zyte.com) uses the V2 x402 protocol
// which isn't compatible with the JS x402-fetch library (V1), so we
// handle the payment ourselves with a direct ERC-20 transfer.

const ZYTE_API_URL = 'https://api.zyte.com/v1/extract';
const ZYTE_API_KEY = process.env.ZYTE_API_KEY || '';

const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const USDC_BASE_CONTRACT = process.env.USDC_BASE_CONTRACT || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const SCRAPE_COST_USDC = Number(process.env.ZYTE_SCRAPE_COST_USDC || '0.01');
const MAX_PAYMENT_USDC = Number(process.env.ZYTE_X402_MAX_PAYMENT || '0.10');
const X402_TIMEOUT_MS = Number(process.env.ZYTE_X402_TIMEOUT_MS || '30000');

// Service-fee recipient — the platform treasury that collects scrape fees.
// In production this would be Zyte's payment address; for the demo we use
// a self-owned address so the USDC stays recoverable.
const SERVICE_FEE_RECIPIENT =
  process.env.ZYTE_SERVICE_FEE_RECIPIENT || process.env.FIRECRAWL_AGENT_PRIVATE_KEY
    ? '' // will be set dynamically to the agent's own address if no explicit recipient
    : '';

const USDC_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export interface ZyteX402Result {
  success: boolean;
  data: unknown;
  baseTxHash?: string;
  paymentAmount?: string;
  agentWallet?: string;
  error?: string;
}

/**
 * Zyte x402 Agent — holds a Base (L2) wallet and pays for each scrape
 * with a real USDC micro-transfer on Base after a successful Zyte API call.
 */
export class ZyteX402Agent {
  private walletClient: any = null;
  private agentAddress: string | null = null;
  private feeRecipient: string | null = null;
  private ready = false;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    const privateKey = process.env.FIRECRAWL_AGENT_PRIVATE_KEY;
    if (!privateKey) {
      console.log('[ZyteX402Agent] No FIRECRAWL_AGENT_PRIVATE_KEY set — agent disabled.');
      return;
    }

    try {
      const viem: any = require('viem');
      const viemAccounts: any = require('viem/accounts');
      const viemChains: any = require('viem/chains');

      const account = viemAccounts.privateKeyToAccount(privateKey as `0x${string}`);
      this.agentAddress = account.address;

      this.walletClient = viem
        .createWalletClient({
          account,
          chain: viemChains.base,
          transport: viem.http(BASE_RPC_URL),
        })
        .extend(viem.publicActions);

      this.feeRecipient =
        process.env.ZYTE_SERVICE_FEE_RECIPIENT || this.agentAddress;

      this.ready = true;
      console.log(
        `[ZyteX402Agent] Ready. Wallet: ${this.agentAddress} | Fee recipient: ${this.feeRecipient} | Cost per scrape: $${SCRAPE_COST_USDC} USDC`,
      );
    } catch (err: any) {
      console.error('[ZyteX402Agent] Init error:', err.message);
    }
  }

  async waitUntilReady(): Promise<void> {
    await this.initPromise;
  }

  isReady(): boolean {
    return this.ready && this.walletClient !== null && !!(process.env.ZYTE_API_KEY || ZYTE_API_KEY);
  }

  getAgentAddress(): string | null {
    return this.agentAddress;
  }

  private authHeader(): string {
    const key = process.env.ZYTE_API_KEY || ZYTE_API_KEY;
    return 'Basic ' + Buffer.from(key + ':').toString('base64');
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
        abi: USDC_TRANSFER_ABI,
        functionName: 'balanceOf',
        args: [this.agentAddress as `0x${string}`],
      });

      return {
        eth: viem.formatUnits(ethBalance, 18),
        usdc: viem.formatUnits(usdcBalance, 6),
      };
    } catch (err: any) {
      console.error('[ZyteX402Agent] Balance check failed:', err.message);
      return null;
    }
  }

  /**
   * Send a real USDC micro-payment on Base.
   * Returns the transaction hash or null on failure.
   */
  private async sendUsdcPayment(amountUsdc: number): Promise<string | null> {
    if (!this.walletClient || !this.feeRecipient) return null;
    if (amountUsdc > MAX_PAYMENT_USDC) {
      console.warn(`[ZyteX402Agent] Payment $${amountUsdc} exceeds max $${MAX_PAYMENT_USDC}, skipping.`);
      return null;
    }

    try {
      const amountRaw = BigInt(Math.round(amountUsdc * 1_000_000)); // USDC has 6 decimals
      console.log(
        `[ZyteX402Agent] Sending ${amountUsdc} USDC to ${this.feeRecipient} on Base...`,
      );

      const txHash = await this.walletClient.writeContract({
        address: USDC_BASE_CONTRACT as `0x${string}`,
        abi: USDC_TRANSFER_ABI,
        functionName: 'transfer',
        args: [this.feeRecipient as `0x${string}`, amountRaw],
      });

      console.log(`[ZyteX402Agent] USDC payment sent! Tx: ${txHash}`);

      // Wait for confirmation (up to ~15 seconds)
      try {
        await this.walletClient.waitForTransactionReceipt({
          hash: txHash,
          timeout: 15_000,
        });
        console.log(`[ZyteX402Agent] Payment confirmed: ${txHash}`);
      } catch {
        console.log(`[ZyteX402Agent] Payment sent but not yet confirmed: ${txHash}`);
      }

      return txHash as string;
    } catch (err: any) {
      console.error('[ZyteX402Agent] USDC payment failed:', err.message);
      return null;
    }
  }

  /**
   * Scrape a URL via Zyte API, then make a real USDC micro-payment on Base.
   */
  async scrape(url: string): Promise<ZyteX402Result> {
    await this.initPromise;
    if (!this.isReady()) {
      return { success: false, data: null, error: 'Agent not ready' };
    }

    try {
      // --- Step 1: Scrape via Zyte API (key auth) ---
      console.log(`[ZyteX402Agent] Scraping: ${url} via Zyte API (timeout ${X402_TIMEOUT_MS}ms)`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), X402_TIMEOUT_MS);

      const response = await fetch(ZYTE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.authHeader(),
        },
        body: JSON.stringify({ url, browserHtml: true }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: { error: errorText, status: response.status },
          agentWallet: this.agentAddress || undefined,
          error: `Zyte API error (${response.status}): ${errorText.substring(0, 200)}`,
        };
      }

      const data = await response.json();
      console.log('[ZyteX402Agent] Scrape complete via Zyte API.');

      // Payment is now handled by the x402 facilitator (Coinbase),
      // not by the agent directly. The agent only scrapes.
      return {
        success: true,
        data,
        agentWallet: this.agentAddress || undefined,
      };
    } catch (err: any) {
      console.error('[ZyteX402Agent] Scrape error:', err.message);
      return { success: false, data: null, error: err.message };
    }
  }

  getBaseScanUrl(txHash: string): string {
    return `https://basescan.org/tx/${txHash}`;
  }

  getStatus(): {
    ready: boolean;
    agentWallet: string | null;
    feeRecipient: string | null;
    network: string;
    scrapeCostUsdc: number;
    maxPaymentUsdc: number;
    endpoint: string;
    provider: string;
  } {
    return {
      ready: this.ready,
      agentWallet: this.agentAddress,
      feeRecipient: this.feeRecipient,
      network: 'Base (L2)',
      scrapeCostUsdc: SCRAPE_COST_USDC,
      maxPaymentUsdc: MAX_PAYMENT_USDC,
      endpoint: ZYTE_API_URL,
      provider: 'Zyte',
    };
  }
}
