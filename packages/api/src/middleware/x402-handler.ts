/**
 * X402 Protocol Middleware — Pass-Through, Provider-Driven Pricing
 *
 * Implements the canonical x402 handshake for any Express route:
 *
 *   1. Buyer sends request WITHOUT PAYMENT-SIGNATURE header
 *      -> Middleware calls the provider's real x402 endpoint (probe)
 *      -> Gets the REAL price from the provider
 *      -> Adds Gordon's margin
 *      -> Returns 402 + PAYMENT-REQUIRED with full price breakdown
 *
 *   2. Buyer sends request WITH PAYMENT-SIGNATURE header
 *      -> Middleware calls facilitator /verify
 *      -> Route handler executes (does the work)
 *      -> Middleware calls facilitator /settle
 *      -> Returns 200 + PAYMENT-RESPONSE header (settlement receipt)
 *
 * The pricing function is now ASYNC, enabling live provider probing.
 * The 402 response includes a `priceBreakdown` field showing:
 *   providerCost + gordonFee = total
 */

import type { Request, Response, NextFunction } from 'express';
import {
  X402FacilitatorClient,
  type X402PaymentRequirements,
  type SettleResponse,
} from '@agentic-commerce/integrations/dist/x402-facilitator-client.js';
import { CHAIN_REGISTRY, toCaip2, DEFAULT_NETWORK } from '@agentic-commerce/shared';
import type { PriceQuote } from '@agentic-commerce/shared';

let _facilitator: X402FacilitatorClient | null = null;
function getFacilitator() {
  if (!_facilitator) _facilitator = new X402FacilitatorClient();
  return _facilitator;
}

export interface X402PricingResult {
  amountUsdc: number;
  description?: string;
  payTo: string;
  supportedNetworks: string[];
  priceQuote?: PriceQuote;
}

export interface X402PricingFn {
  (req: Request): Promise<X402PricingResult | { amountUsdc: number; description?: string } | null>;
}

function shouldDisableUpcharge(): boolean {
  return String(process.env.GORDON_DISABLE_UPCHARGE || 'true').toLowerCase() === 'true';
}

function normalizeQuoteForResponse(priceQuote?: PriceQuote): PriceQuote | undefined {
  if (!priceQuote) return undefined;
  if (!shouldDisableUpcharge()) return priceQuote;
  return {
    ...priceQuote,
    gordonFeeUsdc: 0,
    feePercent: 0,
    totalUsdc: priceQuote.providerCostUsdc,
    totalAtomic: priceQuote.providerCostAtomic,
  };
}

/**
 * Create x402 middleware for a route.
 *
 * @param getPricing - ASYNC function that inspects the request and returns the USDC price
 *                     plus the provider's payment config (payTo, supportedNetworks, priceQuote).
 *                     Return null to skip x402 (free endpoint).
 */
export function x402Paywall(getPricing: X402PricingFn) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const pricing = await getPricing(req);

    if (!pricing || pricing.amountUsdc <= 0) {
      return next();
    }

    const facilitator = getFacilitator();
    const paymentSignature = req.headers['payment-signature'] as string | undefined;
    const resourceUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    const amountAtomic = Math.round(pricing.amountUsdc * 1_000_000).toString();

    const payTo = ('payTo' in pricing && pricing.payTo)
      ? pricing.payTo
      : (process.env.PLATFORM_WALLET || '');

    const supportedNetworks = ('supportedNetworks' in pricing && pricing.supportedNetworks?.length)
      ? pricing.supportedNetworks
      : [DEFAULT_NETWORK];

    const primaryNetwork = supportedNetworks[0] || DEFAULT_NETWORK;
    const primaryChain = CHAIN_REGISTRY[primaryNetwork];
    const primaryAsset = primaryChain?.usdcAddress || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

    const paymentRequirements: X402PaymentRequirements = {
      scheme: 'exact',
      network: primaryNetwork,
      maxAmountRequired: amountAtomic,
      asset: primaryAsset,
      payTo,
      maxTimeoutSeconds: 60,
      resource: {
        url: resourceUrl,
        method: req.method,
        description: pricing.description || 'Agentic Commerce payment',
      },
      extra: {
        name: 'USD Coin',
        version: '2',
        assetTransferMethod: 'eip3009',
      },
    };

    if (!paymentSignature) {
      const paymentRequired = X402FacilitatorClient.buildMultiNetworkPaymentRequired({
        amount: amountAtomic,
        payTo,
        networks: supportedNetworks,
        resourceUrl,
        resourceMethod: req.method,
        description: pricing.description,
      });

      const priceQuote = normalizeQuoteForResponse(('priceQuote' in pricing) ? pricing.priceQuote : undefined);
      if (priceQuote) {
        (paymentRequired as any).priceBreakdown = {
          providerCost: priceQuote.providerCostUsdc,
          gordonFee: priceQuote.gordonFeeUsdc,
          feePercent: priceQuote.feePercent,
          total: priceQuote.totalUsdc,
          currency: 'USDC',
          source: priceQuote.source,
          provider: priceQuote.providerId,
        };
      }

      const encodedHeader = X402FacilitatorClient.encodePaymentRequired(paymentRequired);

      res.status(402)
        .set('PAYMENT-REQUIRED', encodedHeader)
        .set('Content-Type', 'application/json')
        .json(paymentRequired);
      return;
    }

    try {
      const verifyResult = await facilitator.verify(paymentSignature, paymentRequirements);

      if (!verifyResult.isValid) {
        const paymentRequired = X402FacilitatorClient.buildMultiNetworkPaymentRequired({
          amount: amountAtomic,
          payTo,
          networks: supportedNetworks,
          resourceUrl,
          resourceMethod: req.method,
          description: pricing.description,
        });
        const encodedHeader = X402FacilitatorClient.encodePaymentRequired(paymentRequired);

        res.status(402)
          .set('PAYMENT-REQUIRED', encodedHeader)
          .json({
            ...paymentRequired,
            error: `Payment verification failed: ${verifyResult.invalidReason || 'unknown'}`,
          });
        return;
      }

      const priceQuote = normalizeQuoteForResponse(('priceQuote' in pricing) ? pricing.priceQuote : undefined);

      (req as any).x402 = {
        verified: true,
        payer: verifyResult.payer,
        paymentSignature,
        paymentRequirements,
        amountUsdc: pricing.amountUsdc,
        priceQuote,
      };

      const originalJson = res.json.bind(res);
      let responseBody: any = null;

      res.json = ((body: any) => {
        responseBody = body;
        const executionStatus = typeof responseBody?.status === 'string' ? responseBody.status : undefined;
        const shouldSettle = executionStatus ? executionStatus === 'completed' : true;

        if (!shouldSettle) {
          if (responseBody && typeof responseBody === 'object') {
            responseBody.x402Settlement = {
              success: false,
              skipped: true,
              reason: `Execution status ${executionStatus} — skipping settlement`,
            };
          }
          return originalJson(responseBody);
        }

        facilitator.settle(paymentSignature, paymentRequirements)
          .then((settleResult: SettleResponse) => {
            const paymentResponse = X402FacilitatorClient.encodePaymentResponse(settleResult);
            res.set('PAYMENT-RESPONSE', paymentResponse);

            if (responseBody && typeof responseBody === 'object') {
              responseBody.x402Settlement = {
                success: settleResult.success,
                txHash: settleResult.transaction,
                network: settleResult.network || primaryNetwork,
                payer: settleResult.payer,
              };

              if (priceQuote) {
                responseBody.priceBreakdown = {
                  providerCost: priceQuote.providerCostUsdc,
                  gordonFee: priceQuote.gordonFeeUsdc,
                  feePercent: priceQuote.feePercent,
                  total: priceQuote.totalUsdc,
                  currency: 'USDC',
                  source: priceQuote.source,
                  provider: priceQuote.providerId,
                };
              }
            }

            return originalJson(responseBody);
          })
          .catch((err: Error) => {
            console.error('[x402-handler] Settlement failed:', err.message);

            if (responseBody && typeof responseBody === 'object') {
              responseBody.x402Settlement = {
                success: false,
                error: err.message,
              };
            }
            return originalJson(responseBody);
          });

        return res;
      }) as any;

      next();
    } catch (err: any) {
      console.error('[x402-handler] Verification error:', err.message);
      res.status(500).json({
        error: {
          code: 'X402_ERROR',
          message: `Payment processing error: ${err.message}`,
        },
      });
    }
  };
}

/**
 * Lightweight helper: extract x402 payment context from request.
 */
export function getX402Context(req: Request): {
  verified: boolean;
  paymentSignature: string;
  paymentRequirements: X402PaymentRequirements;
  amountUsdc: number;
  priceQuote?: PriceQuote;
} | null {
  return (req as any).x402 || null;
}
