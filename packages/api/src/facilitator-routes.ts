/**
 * Facilitator Routes
 * Verification service for x402 payments
 */

import { Router } from 'express';
import { FacilitatorService } from '@agentic-commerce/integrations';

export function createFacilitatorRoutes(facilitatorService: FacilitatorService) {
  const router = Router();

  /**
   * POST /api/facilitator/verify
   * Verify an x402 payment proof
   */
  router.post('/verify', async (req, res) => {
    try {
      // Optional shared secret for facilitator
      const expectedSecret = process.env.FACILITATOR_SHARED_SECRET;
      if (expectedSecret) {
        const providedSecret = req.headers['x-facilitator-secret'] as string;
        if (providedSecret !== expectedSecret) {
          return res.status(401).json({
            error: 'UNAUTHORIZED',
            message: 'Invalid facilitator secret',
          });
        }
      }

      const { proof, expected } = req.body;

      if (!proof || !expected) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'Missing proof or expected fields',
        });
      }

      // Validate expected fields
      if (!expected.mint || !expected.payTo || !expected.network || !expected.bodyHash) {
        return res.status(400).json({
          error: 'INVALID_EXPECTED',
          message: 'Missing required expected fields',
        });
      }

      // Verify the payment
      const result = await facilitatorService.verifyPayment({
        proof,
        expected,
        commitment: process.env.SOLANA_COMMITMENT as any || 'confirmed',
      });

      if (!result.ok) {
        return res.status(result.code || 400).json({
          error: result.error,
          detail: result.detail,
        });
      }

      return res.json(result.receipt);
    } catch (error: any) {
      console.error('Facilitator verification error:', error);
      return res.status(500).json({
        error: 'VERIFICATION_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/facilitator/health
   * Health check for facilitator service
   */
  router.get('/health', (req, res) => {
    res.json({
      ok: true,
      service: 'facilitator',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
