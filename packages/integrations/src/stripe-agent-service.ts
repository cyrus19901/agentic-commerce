import Stripe from 'stripe';

/**
 * Stripe Agents Toolkit Service
 * Provides dynamic creation of Stripe objects (Payment Links, Products, Prices)
 * for agent-commerce workflows
 */
export class StripeAgentService {
  private stripe: Stripe | null = null;

  constructor() {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (apiKey && (apiKey.startsWith('sk_test_') || apiKey.startsWith('sk_live_'))) {
      try {
        this.stripe = new Stripe(apiKey, {
          apiVersion: '2024-12-18.acacia' as any,
        });
        console.log('✅ Stripe Agent Service initialized');
      } catch (error) {
        console.error('❌ Failed to initialize Stripe Agent Service:', error);
        this.stripe = null;
      }
    } else {
      console.log('⚠️  Stripe Agent Service: No valid Stripe key, using mock mode');
    }
  }

  /**
   * Create a Payment Link dynamically
   * Used by agents to create payment links on-demand
   */
  async createPaymentLink(params: {
    productName: string;
    amount: number;
    currency?: string;
    description?: string;
    successUrl?: string;
    cancelUrl?: string;
    metadata?: Record<string, string>;
  }): Promise<{
    success: boolean;
    paymentLinkId?: string;
    url?: string;
    error?: string;
  }> {
    if (!this.stripe) {
      // Mock response for development
      return {
        success: true,
        paymentLinkId: `mock_pl_${Date.now()}`,
        url: `https://checkout.stripe.com/pay/mock_${Date.now()}`,
      };
    }

    try {
      // First, create a product
      const product = await this.stripe.products.create({
        name: params.productName,
        description: params.description,
        metadata: params.metadata || {},
      });

      // Create a price for the product
      const price = await this.stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(params.amount * 100), // Convert to cents
        currency: params.currency || 'usd',
      });

      // Create payment link
      const paymentLink = await this.stripe.paymentLinks.create({
        line_items: [
          {
            price: price.id,
            quantity: 1,
          },
        ],
        metadata: params.metadata || {},
      });

      return {
        success: true,
        paymentLinkId: paymentLink.id,
        url: paymentLink.url,
      };
    } catch (error: any) {
      console.error('Error creating payment link:', error);
      return {
        success: false,
        error: error.message || 'Failed to create payment link',
      };
    }
  }

  /**
   * Create a Stripe Product dynamically
   */
  async createProduct(params: {
    name: string;
    description?: string;
    images?: string[];
    metadata?: Record<string, string>;
  }): Promise<{
    success: boolean;
    productId?: string;
    error?: string;
  }> {
    if (!this.stripe) {
      return {
        success: true,
        productId: `prod_mock_${Date.now()}`,
      };
    }

    try {
      const product = await this.stripe.products.create({
        name: params.name,
        description: params.description,
        images: params.images,
        metadata: params.metadata || {},
      });

      return {
        success: true,
        productId: product.id,
      };
    } catch (error: any) {
      console.error('Error creating product:', error);
      return {
        success: false,
        error: error.message || 'Failed to create product',
      };
    }
  }

  /**
   * Create a Stripe Price dynamically
   */
  async createPrice(params: {
    productId: string;
    amount: number;
    currency?: string;
    recurring?: {
      interval: 'day' | 'week' | 'month' | 'year';
      intervalCount?: number;
    };
  }): Promise<{
    success: boolean;
    priceId?: string;
    error?: string;
  }> {
    if (!this.stripe) {
      return {
        success: true,
        priceId: `price_mock_${Date.now()}`,
      };
    }

    try {
      const priceParams: Stripe.PriceCreateParams = {
        product: params.productId,
        unit_amount: Math.round(params.amount * 100),
        currency: params.currency || 'usd',
      };

      if (params.recurring) {
        priceParams.recurring = {
          interval: params.recurring.interval,
          interval_count: params.recurring.intervalCount || 1,
        };
      }

      const price = await this.stripe.prices.create(priceParams);

      return {
        success: true,
        priceId: price.id,
      };
    } catch (error: any) {
      console.error('Error creating price:', error);
      return {
        success: false,
        error: error.message || 'Failed to create price',
      };
    }
  }

  /**
   * Check if Stripe is configured
   */
  isConfigured(): boolean {
    return this.stripe !== null;
  }
}
