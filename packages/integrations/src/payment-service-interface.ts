/**
 * Payment Service Interface
 * Abstraction layer for different payment methods
 */

export interface PaymentInitiateParams {
  userId: string;
  productId: string;
  productName: string;
  amount: number;
  merchant: string;
  category?: string;
  productUrl?: string;
  productImageUrl?: string;
  metadata?: Record<string, any>;
}

export interface PaymentResult {
  success: boolean;
  sessionId?: string;
  checkoutUrl?: string;
  invoiceUrl?: string;
  message?: string;
  error?: string;
  // For agent-to-agent
  requirement?: any; // X402Requirement
  requirementHeader?: string; // base64url encoded
}

export interface PaymentVerificationParams {
  sessionId?: string; // For Stripe
  proof?: any; // For x402
  expected?: any; // Expected payment details for x402
}

export interface PaymentVerificationResult {
  verified: boolean;
  amount?: number;
  paymentStatus?: string;
  error?: string;
  receipt?: any;
}

/**
 * Unified payment service interface
 */
export interface IPaymentService {
  /**
   * Initiate a payment (create checkout session or return 402 requirement)
   */
  initiatePayment(params: PaymentInitiateParams): Promise<PaymentResult>;
  
  /**
   * Verify a payment
   */
  verifyPayment(params: PaymentVerificationParams): Promise<PaymentVerificationResult>;
  
  /**
   * Get payment status
   */
  getPaymentStatus(identifier: string): Promise<{
    status: string;
    amount?: number;
    metadata?: any;
  }>;
}

/**
 * Payment method types
 */
export type PaymentMethod = 'stripe' | 'x402-solana' | 'mock';
