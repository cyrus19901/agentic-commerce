import Stripe from 'stripe';

interface CheckoutRequest {
  userId: string;
  productId: string;
  productName: string;
  amount: number;
  merchant: string;
  category?: string;
  productUrl?: string;
  productImageUrl?: string;
}

interface CheckoutResponse {
  success: boolean;
  sessionId: string;
  checkoutUrl: string;
  invoiceUrl?: string;
  productId: string;
  productName: string;
  amount: number;
  currency: string;
  message?: string;
}

export class PaymentService {
  private stripe: Stripe | null = null;

  constructor() {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    // Only initialize Stripe if we have a real API key
    if (apiKey && (apiKey.startsWith('sk_test_') || apiKey.startsWith('sk_live_'))) {
      try {
        this.stripe = new Stripe(apiKey, {
          apiVersion: '2026-01-28.clover' as any, // Use latest API version
        });
        console.log('✅ Stripe initialized with API version 2026-01-28.clover');
      } catch (error) {
        console.error('❌ Failed to initialize Stripe:', error);
        this.stripe = null;
      }
    } else {
      console.log('⚠️  No valid Stripe key found, using mock checkout');
    }
  }

  async initiateCheckout(request: CheckoutRequest): Promise<CheckoutResponse> {
    // DEVELOPMENT MODE: Use mock checkout for policy testing
    // Set USE_MOCK_PAYMENTS=true in .env to skip Stripe and test policies
    // If USE_MOCK_PAYMENTS is explicitly set to 'false', use real Stripe even in development
    console.log('💡 Payment debug:', {
      USE_MOCK_PAYMENTS: process.env.USE_MOCK_PAYMENTS,
      NODE_ENV: process.env.NODE_ENV,
      hasStripe: !!this.stripe,
    });
    const useMockPayments = process.env.USE_MOCK_PAYMENTS === 'false' 
      ? false 
      : (process.env.USE_MOCK_PAYMENTS === 'true' || process.env.NODE_ENV === 'development');
    
    console.log('💡 useMockPayments:', useMockPayments);
    
    if (useMockPayments || !this.stripe) {
      console.log('🧪 Using mock checkout (policy testing mode)');
      return this.getMockCheckoutResponse(request);
    }

    try {
      console.log('🔵 Creating Stripe checkout session:', {
        productName: request.productName,
        amount: request.amount,
        userId: request.userId
      });

      // Create Stripe Checkout Session
      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: request.productName,
                description: `${request.merchant} - ${request.category || 'Product'}`,
                images: request.productImageUrl ? [request.productImageUrl] : undefined,
              },
              unit_amount: Math.round(request.amount * 100), // Convert to cents
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${process.env.API_URL || 'http://localhost:3000'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.API_URL || 'http://localhost:3000'}/checkout/cancel`,
        metadata: {
          userId: request.userId,
          productId: request.productId,
          productName: request.productName,
          merchant: request.merchant,
          category: request.category || '',
        },
      });

      console.log('✅ Stripe session created:', {
        sessionId: session.id,
        url: session.url,
        status: session.status
      });

      return {
        success: true,
        sessionId: session.id,
        checkoutUrl: session.url!,
        invoiceUrl: `${process.env.API_URL || 'http://localhost:3000'}/api/invoices/${session.id}`,
        productId: request.productId,
        productName: request.productName,
        amount: request.amount,
        currency: 'USD',
      };
    } catch (error: any) {
      console.error('❌ Error creating Stripe session:', {
        message: error.message,
        type: error.type,
        code: error.code,
        statusCode: error.statusCode,
        raw: error.raw
      });
      // Fallback to mock if Stripe fails
      return this.getMockCheckoutResponse(request);
    }
  }

  async getCheckoutStatus(sessionId: string) {
    if (!this.stripe) {
      return {
        success: true,
        status: 'complete',
        paymentStatus: 'paid',
      };
    }

    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);
      return {
        success: true,
        status: session.status,
        paymentStatus: session.payment_status,
        amountTotal: session.amount_total ? session.amount_total / 100 : 0,
        currency: session.currency,
        metadata: session.metadata,
      };
    } catch (error) {
      console.error('Error retrieving session:', error);
      return {
        success: false,
        error: 'Failed to retrieve checkout status',
      };
    }
  }

  async handleWebhook(payload: Buffer, signature: string) {
    if (!this.stripe) {
      throw new Error('Stripe not initialized');
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('Webhook secret not configured');
    }

    try {
      const event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);

      switch (event.type) {
        case 'checkout.session.completed':
          const session = event.data.object as Stripe.Checkout.Session;
          console.log('✅ Payment successful:', session.id);
          return {
            type: 'payment_success',
            sessionId: session.id,
            metadata: session.metadata,
          };

        case 'checkout.session.expired':
          console.log('⏰ Checkout session expired:', event.data.object);
          return {
            type: 'session_expired',
            sessionId: (event.data.object as any).id,
          };

        default:
          console.log(`ℹ️  Unhandled event type: ${event.type}`);
          return { type: 'unhandled', eventType: event.type };
      }
    } catch (error) {
      console.error('❌ Webhook signature verification failed:', error);
      throw error;
    }
  }

  private getMockCheckoutResponse(request: CheckoutRequest): CheckoutResponse {
    const mockSessionId = `mock_session_${Date.now()}`;
    // Return a success response that indicates mock mode but allows the flow to continue
    // ChatGPT can handle this by showing the product link directly
    return {
      success: true,
      sessionId: mockSessionId,
      checkoutUrl: request.productUrl || `https://example.com/product/${request.productId}`,
      invoiceUrl: `${process.env.API_URL || 'http://localhost:3000'}/api/invoices/${mockSessionId}`,
      productId: request.productId,
      productName: request.productName,
      amount: request.amount,
      currency: 'USD',
      message: '✅ Purchase approved by policy! In production, this would process payment. Product link: ' + (request.productUrl || 'N/A'),
    };
  }
}

