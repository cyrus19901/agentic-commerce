/**
 * Demo Routes — Multi-Chain EIP-3009 Signer
 *
 * Backend endpoints used by the presentation demo to sign real EIP-3009
 * TransferWithAuthorization payloads without requiring MetaMask in the browser.
 *
 * The signer dynamically picks the chain from the 402 response's accepts[],
 * building the EIP-712 domain from CHAIN_REGISTRY.
 *
 * POST /api/demo/sign-x402  — signs a payment using the demo buyer wallet
 * GET  /api/demo/wallet      — returns demo buyer wallet address + balance
 */

import { Router, Request, Response } from 'express';
import { CHAIN_REGISTRY, toCaip2, DEFAULT_NETWORK, normalizeHexPrivateKey, type ChainConfig } from '@agentic-commerce/shared';

export function createDemoRoutes(): Router {
  const router = Router();

  const walletCache: Record<string, { walletClient: any; publicClient: any }> = {};
  let buyerAddress: string | null = null;
  let buyerAccount: any = null;

  async function ensureAccount(): Promise<boolean> {
    if (buyerAccount) return true;

    const privateKey = normalizeHexPrivateKey(
      process.env.DEMO_BUYER_PRIVATE_KEY || process.env.FIRECRAWL_AGENT_PRIVATE_KEY,
    );
    if (!privateKey) return false;

    try {
      const viemAccounts: any = require('viem/accounts');
      buyerAccount = viemAccounts.privateKeyToAccount(privateKey as `0x${string}`);
      buyerAddress = buyerAccount.address;
      return true;
    } catch (err: any) {
      console.error('[demo-routes] Account init failed:', err.message);
      return false;
    }
  }

  function getClientsForChain(chain: ChainConfig): { walletClient: any; publicClient: any } {
    if (walletCache[chain.caip2]) return walletCache[chain.caip2];

    const viem: any = require('viem');
    const viemChains: any = require('viem/chains');

    const chainMap: Record<number, any> = {
      8453: viemChains.base,
      84532: viemChains.baseSepolia,
      137: viemChains.polygon,
      42161: viemChains.arbitrum,
    };

    const viemChain = chainMap[chain.chainId] || viemChains.base;

    const walletClient = viem.createWalletClient({
      account: buyerAccount,
      chain: viemChain,
      transport: viem.http(process.env.BASE_RPC_URL || chain.rpcUrl),
    });

    const publicClient = viem.createPublicClient({
      chain: viemChain,
      transport: viem.http(process.env.BASE_RPC_URL || chain.rpcUrl),
    });

    walletCache[chain.caip2] = { walletClient, publicClient };
    return walletCache[chain.caip2];
  }

  /**
   * POST /api/demo/sign-x402
   *
   * Takes a PAYMENT-REQUIRED response body and produces a valid
   * PAYMENT-SIGNATURE (base64-encoded x402 payment payload with
   * EIP-3009 TransferWithAuthorization signature).
   *
   * Supports multi-network accepts[]. Picks the first entry or
   * the one matching ?preferredNetwork=eip155:8453.
   */
  router.post('/sign-x402', async (req: Request, res: Response) => {
    try {
      if (!(await ensureAccount()) || !buyerAddress) {
        res.status(503).json({ error: 'Demo wallet not configured. Set DEMO_BUYER_PRIVATE_KEY.' });
        return;
      }

      const rawHeader =
        (req.body?.paymentRequiredHeader as string | undefined) ||
        (req.headers['payment-required'] as string | undefined) ||
        (req.headers['x-payment-required'] as string | undefined);
      let paymentRequired = req.body;
      if (rawHeader?.trim()) {
        try {
          paymentRequired = JSON.parse(Buffer.from(rawHeader.trim(), 'base64').toString('utf8'));
        } catch {
          paymentRequired = JSON.parse(rawHeader);
        }
      }

      const accepts = paymentRequired?.accepts?.length
        ? paymentRequired.accepts
        : paymentRequired?.accepted
          ? [paymentRequired.accepted]
          : [];
      if (!accepts[0]) {
        res.status(400).json({ error: 'Invalid PAYMENT-REQUIRED input. Expected accepts[] or accepted.' });
        return;
      }

      const preferredNetwork = (req.query.preferredNetwork as string) || '';
      let accept = accepts[0];

      if (preferredNetwork) {
        const caip2Preferred = toCaip2(preferredNetwork);
        const match = accepts.find((a: any) => a.network === caip2Preferred);
        if (match) accept = match;
      }

      const amountRaw = accept.maxAmountRequired ?? accept.amount;
      if (amountRaw == null || String(amountRaw).trim() === '') {
        res.status(400).json({ error: 'accept entry missing maxAmountRequired / amount' });
        return;
      }
      const payTo = String(accept.payTo ?? '').trim();
      if (!payTo || !/^0x[a-fA-F0-9]{40}$/i.test(payTo)) {
        res.status(400).json({ error: 'accept entry has invalid payTo address' });
        return;
      }
      const network = accept.network as string | undefined;
      const caip2Network = toCaip2(network || 'base');
      const chainConfig = CHAIN_REGISTRY[caip2Network];

      if (!chainConfig) {
        res.status(400).json({
          error: `Unsupported network: ${caip2Network}`,
          supportedNetworks: Object.keys(CHAIN_REGISTRY),
        });
        return;
      }

      const { walletClient } = getClientsForChain(chainConfig);
      const x402Client: { createPaymentHeader: (w: any, ver: number, req: any) => Promise<string> } = require('x402/client');
      const x402Types: { PaymentRequirementsSchema: { parse: (x: unknown) => any } } = require('x402/types');
      const x402Schemes: { decodePayment: (v: string) => unknown } = require('x402/schemes');

      const networkToX402: Record<string, string> = {
        'eip155:8453': 'base',
        'eip155:84532': 'base-sepolia',
        'eip155:137': 'polygon',
        'eip155:42161': 'arbitrum',
      };
      const rawResource = accept.resource;
      const resourceString =
        typeof rawResource === 'string'
          ? rawResource
          : (rawResource && typeof rawResource === 'object' && typeof (rawResource as any).url === 'string')
            ? String((rawResource as any).url)
            : 'resource';
      const normalizedAccept = {
        ...accept,
        scheme: 'exact',
        network: networkToX402[caip2Network] || accept.network || 'base',
        payTo,
        maxAmountRequired: String(amountRaw),
        resource: resourceString,
        description: accept.description || 'x402-protected resource',
        mimeType: accept.mimeType || 'application/json',
      };
      const paymentRequirements = x402Types.PaymentRequirementsSchema.parse(normalizedAccept);
      const x402Version = Number(paymentRequired?.x402Version ?? 1);
      const paymentHeader = await x402Client.createPaymentHeader(walletClient, x402Version, paymentRequirements);
      let paymentPayload: unknown = null;
      try {
        paymentPayload = x402Schemes.decodePayment(paymentHeader);
      } catch {
        paymentPayload = null;
      }

      res.json({
        paymentHeader,
        paymentPayload,
        buyerAddress,
        asset: accept.asset || chainConfig.usdcAddress,
        network: caip2Network,
        chainName: chainConfig.name,
        amount: String(amountRaw),
        amountUsdc: (parseInt(String(amountRaw), 10) / 1_000_000).toFixed(6),
        explorerUrl: chainConfig.explorerUrl,
        availableNetworks: accepts.map((a: any) => a.network),
      });
    } catch (err: any) {
      console.error('[demo-routes] sign-x402 error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/demo/wallet
   *
   * Returns the demo buyer wallet address and USDC/ETH balances.
   * Accepts ?network=eip155:8453 (default: Base mainnet).
   */
  router.get('/wallet', async (req: Request, res: Response) => {
    try {
      if (!(await ensureAccount()) || !buyerAddress) {
        res.status(503).json({ error: 'Demo wallet not configured' });
        return;
      }

      const network = toCaip2((req.query.network as string) || 'base');
      const chainConfig = CHAIN_REGISTRY[network] || CHAIN_REGISTRY[DEFAULT_NETWORK];
      const { publicClient } = getClientsForChain(chainConfig);
      const viem: any = require('viem');

      const ethBalance: bigint = await publicClient.getBalance({
        address: buyerAddress as `0x${string}`,
      });

      const usdcBalance: bigint = await publicClient.readContract({
        address: chainConfig.usdcAddress as `0x${string}`,
        abi: [{
          name: 'balanceOf', type: 'function', stateMutability: 'view',
          inputs: [{ name: 'account', type: 'address' }],
          outputs: [{ name: '', type: 'uint256' }],
        }],
        functionName: 'balanceOf',
        args: [buyerAddress as `0x${string}`],
      });

      res.json({
        address: buyerAddress,
        network: `${chainConfig.name} (${chainConfig.caip2})`,
        chainId: chainConfig.chainId,
        ethBalance: viem.formatUnits(ethBalance, 18),
        usdcBalance: viem.formatUnits(usdcBalance, 6),
        explorerUrl: `${chainConfig.explorerUrl}/address/${buyerAddress}`,
        supportedNetworks: Object.entries(CHAIN_REGISTRY).map(([caip2, c]) => ({
          network: caip2,
          name: c.name,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message, address: buyerAddress });
    }
  });

  /**
   * GET /api/demo/facilitator-health
   *
   * Checks if the Coinbase CDP facilitator is reachable and authenticated.
   */
  router.get('/facilitator-health', async (_req: Request, res: Response) => {
    try {
      const { X402FacilitatorClient } = require('@agentic-commerce/integrations/dist/x402-facilitator-client.js');
      const client = new X402FacilitatorClient();
      const health = await client.healthCheck();

      res.json({
        facilitatorUrl: process.env.X402_FACILITATOR_URL || 'https://api.cdp.coinbase.com/platform/v2/x402',
        cdpKeyConfigured: !!(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET),
        ...health,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/demo/chains
   *
   * Returns all supported chains from the registry.
   */
  router.get('/chains', (_req: Request, res: Response) => {
    const chains = Object.entries(CHAIN_REGISTRY).map(([caip2, config]) => ({
      network: caip2,
      name: config.name,
      chainId: config.chainId,
      usdcAddress: config.usdcAddress,
      explorerUrl: config.explorerUrl,
    }));
    res.json({ chains, defaultNetwork: DEFAULT_NETWORK });
  });

  return router;
}
