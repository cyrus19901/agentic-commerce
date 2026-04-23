/**
 * X402 Facilitator Client
 *
 * Wraps the official @x402/core HTTPFacilitatorClient and @coinbase/x402
 * authentication to communicate with the Coinbase-hosted CDP facilitator.
 *
 * Facilitator URL: https://api.cdp.coinbase.com/platform/v2/x402
 * Endpoints: /verify, /settle, /supported
 *
 * Authentication: JWT via CDP API credentials (CDP_API_KEY_ID + CDP_API_KEY_SECRET)
 */

const COINBASE_FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402';

export interface X402PaymentRequirements {
  scheme: 'exact';
  network: string;
  maxAmountRequired: string;
  resource: {
    url: string;
    method: string;
    description?: string;
    mimeType?: string;
  };
  description?: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  outputSchema?: unknown;
  extra?: {
    name: string;
    version: string;
    assetTransferMethod?: string;
  };
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string | null;
  payer?: string;
}

export interface SettleResponse {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
  errorCode?: string;
}

export interface PaymentRequiredResponse {
  x402Version: number;
  accepts: X402PaymentRequirements[];
  error?: string;
}

import { CHAIN_REGISTRY, toCaip2, toCdpNetwork, type ChainConfig } from '@agentic-commerce/shared';

export class X402FacilitatorClient {
  private client: any;
  private _ready: Promise<void>;

  constructor(facilitatorUrl?: string) {
    const url = facilitatorUrl || process.env.X402_FACILITATOR_URL || COINBASE_FACILITATOR_URL;

    this._ready = this.init(url);
  }

  private async init(url: string): Promise<void> {
    const { HTTPFacilitatorClient } = require('@x402/core/server');
    const { createCdpAuthHeaders } = require('@coinbase/x402');

    const keyId = process.env.CDP_API_KEY_ID;
    const keySecret = process.env.CDP_API_KEY_SECRET;

    const config: any = { url };

    if (keyId && keySecret) {
      config.createAuthHeaders = createCdpAuthHeaders(keyId, keySecret);
    }

    this.client = new HTTPFacilitatorClient(config);
  }

  private async ensureReady(): Promise<void> {
    await this._ready;
  }

  private toV2(req: X402PaymentRequirements): Record<string, unknown> {
    return {
      scheme: req.scheme,
      network: toCaip2(req.network),
      amount: req.maxAmountRequired,
      asset: req.asset,
      payTo: req.payTo,
      maxTimeoutSeconds: req.maxTimeoutSeconds,
      extra: req.extra || { name: 'USD Coin', version: '2' },
    };
  }

  private decodePaymentPayload(
    paymentHeader: string,
    requirements: X402PaymentRequirements,
  ): Record<string, unknown> {
    try {
      const decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));

      if (decoded.accepted && decoded.payload) {
        if (decoded.accepted.network) {
          decoded.accepted.network = toCaip2(decoded.accepted.network);
        }
        return decoded;
      }

      return {
        x402Version: decoded.x402Version || 2,
        accepted: this.toV2(requirements),
        payload: decoded.payload || {},
      };
    } catch {
      return {
        x402Version: 2,
        accepted: this.toV2(requirements),
        payload: {},
      };
    }
  }

  async verify(
    paymentHeader: string,
    paymentRequirements: X402PaymentRequirements,
  ): Promise<VerifyResponse> {
    await this.ensureReady();

    const paymentPayload = this.decodePaymentPayload(paymentHeader, paymentRequirements);
    const v2Requirements = this.toV2(paymentRequirements);

    try {
      const result = await this.client.verify(paymentPayload, v2Requirements);
      return {
        isValid: result.isValid !== false,
        invalidReason: result.invalidReason || null,
        payer: result.payer,
      };
    } catch (err: any) {
      console.error('[x402-facilitator] verify failed:', err.invalidReason || err.message);
      return {
        isValid: false,
        invalidReason: err.invalidReason || err.message || 'Verification failed',
      };
    }
  }

  async settle(
    paymentHeader: string,
    paymentRequirements: X402PaymentRequirements,
  ): Promise<SettleResponse> {
    await this.ensureReady();

    const paymentPayload = this.decodePaymentPayload(paymentHeader, paymentRequirements);
    const v2Requirements = this.toV2(paymentRequirements);

    try {
      const result = await this.client.settle(paymentPayload, v2Requirements);
      return {
        success: result.success !== false,
        transaction: result.transaction,
        network: result.network,
        payer: result.payer,
        errorReason: result.errorReason,
      };
    } catch (err: any) {
      return {
        success: false,
        errorReason: err.errorReason || err.message || 'Settlement failed',
      };
    }
  }

  async supported(): Promise<{ kinds: Array<{ scheme: string; network: string }> }> {
    await this.ensureReady();
    return this.client.getSupported() as Promise<{ kinds: Array<{ scheme: string; network: string }> }>;
  }

  async healthCheck(): Promise<{ ok: boolean; networks?: string[]; error?: string }> {
    try {
      const result = await this.supported();
      return {
        ok: true,
        networks: result.kinds.map((k: any) => `${k.scheme}/${k.network}`),
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  static buildPaymentRequired(params: {
    amount: string;
    payTo: string;
    asset: string;
    network: string;
    resourceUrl: string;
    resourceMethod: string;
    description?: string;
    maxTimeoutSeconds?: number;
  }): PaymentRequiredResponse {
    return {
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          network: toCaip2(params.network),
          maxAmountRequired: params.amount,
          asset: params.asset,
          payTo: params.payTo,
          maxTimeoutSeconds: params.maxTimeoutSeconds || 60,
          resource: {
            url: params.resourceUrl,
            method: params.resourceMethod,
            description: params.description,
          },
          extra: {
            name: 'USD Coin',
            version: '2',
            assetTransferMethod: 'eip3009',
          },
        },
      ],
    };
  }

  /**
   * Build a 402 response with one accepts[] entry per supported network.
   * Each entry uses the correct USDC contract address for that chain.
   */
  static buildMultiNetworkPaymentRequired(params: {
    amount: string;
    payTo: string;
    networks: string[];
    resourceUrl: string;
    resourceMethod: string;
    description?: string;
    maxTimeoutSeconds?: number;
  }): PaymentRequiredResponse {
    const accepts: X402PaymentRequirements[] = [];
    for (const net of params.networks) {
      const caip2 = toCaip2(net);
      const chain = CHAIN_REGISTRY[caip2];
      if (!chain) continue;
      accepts.push({
        scheme: 'exact',
        network: caip2,
        maxAmountRequired: params.amount,
        asset: chain.usdcAddress,
        payTo: params.payTo,
        maxTimeoutSeconds: params.maxTimeoutSeconds || 60,
        resource: {
          url: params.resourceUrl,
          method: params.resourceMethod,
          description: params.description,
        },
        extra: {
          name: chain.usdcName,
          version: chain.usdcVersion,
          assetTransferMethod: 'eip3009',
        },
      });
    }

    if (accepts.length === 0) {
      return X402FacilitatorClient.buildPaymentRequired({
        amount: params.amount,
        payTo: params.payTo,
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        network: 'eip155:8453',
        resourceUrl: params.resourceUrl,
        resourceMethod: params.resourceMethod,
        description: params.description,
        maxTimeoutSeconds: params.maxTimeoutSeconds,
      });
    }

    return { x402Version: 2, accepts };
  }

  static encodePaymentRequired(pr: PaymentRequiredResponse): string {
    return Buffer.from(JSON.stringify(pr)).toString('base64');
  }

  static decodePaymentRequired(header: string): PaymentRequiredResponse {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  }

  static decodePaymentSignature(header: string): string {
    return header;
  }

  static encodePaymentResponse(settleResult: SettleResponse): string {
    return Buffer.from(JSON.stringify(settleResult)).toString('base64');
  }
}
