import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { DB } from '@agentic-commerce/database';
import { PolicyService } from '@agentic-commerce/core';
import { EtsyClient, PaymentService } from '@agentic-commerce/integrations';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Initialize services
const db = new DB(process.env.DATABASE_URL);
const policyService = new PolicyService(db);
const etsyClient = new EtsyClient();
const paymentService = new PaymentService();

// Middleware - Allow all origins for ChatGPT
app.use(cors({ 
  origin: true, // Allow all origins
  credentials: true,
  exposedHeaders: ['ngrok-skip-browser-warning'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
}));
app.use(express.json());

// Add ngrok bypass for all requests
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  next();
});

// Auth middleware
const authenticate = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
};

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.post('/api/products/search', authenticate, async (req, res) => {
  try {
    const { query, max_price, limit = 10 } = req.body;
    const products = await etsyClient.searchProducts({ query, maxPrice: max_price, limit });
    res.json({ products });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/policy/check', authenticate, async (req, res) => {
  try {
    const { user_id, product_id, price, merchant, category } = req.body;
    console.log('Policy check request:', JSON.stringify(req.body, null, 2));
    const result = await policyService.checkPurchase({
      userId: user_id,
      productId: product_id,
      price,
      merchant,
      category,
    });
    console.log('Policy check response:', JSON.stringify(result, null, 2));
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/policy/spending', authenticate, async (req, res) => {
  try {
    const { user_id } = req.body;
    const [daily, weekly, monthly] = await Promise.all([
      db.getUserSpending(user_id, 'daily'),
      db.getUserSpending(user_id, 'weekly'),
      db.getUserSpending(user_id, 'monthly'),
    ]);
    res.json({ userId: user_id, spending: { daily, weekly, monthly } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/checkout/initiate', authenticate, async (req, res) => {
  try {
    console.log('Checkout request body:', JSON.stringify(req.body, null, 2));
    const { user_id, product_id, amount, merchant, category, product_name, product_url, product_image_url } = req.body;

    // Check policy first
    const policyCheck = await policyService.checkPurchase({
      userId: user_id,
      productId: product_id,
      price: amount,
      merchant,
      category,
    });

    if (!policyCheck.allowed) {
      return res.status(403).json({
        error: 'Purchase not allowed',
        reason: policyCheck.reason,
        matchedPolicies: policyCheck.matchedPolicies,
      });
    }

    // Create Stripe checkout session
    const checkout = await paymentService.initiateCheckout({
      userId: user_id,
      productId: product_id,
      productName: product_name,
      amount,
      merchant,
      category,
      productUrl: product_url,
      productImageUrl: product_image_url,
    });
    console.log('Checkout response:', JSON.stringify(checkout, null, 2));

    // Record purchase attempt
    await db.recordPurchaseAttempt({
      userId: user_id,
      productId: product_id,
      amount,
      merchant,
      category,
      allowed: true,
      policyCheckResults: policyCheck.matchedPolicies,
    });

    res.json({
      checkout_session_id: checkout.sessionId,
      checkout_url: checkout.checkoutUrl,
      expires_at: new Date(Date.now() + 1800000).toISOString(),
      message: checkout.message,
    });
  } catch (error: any) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/checkout/complete', authenticate, async (req, res) => {
  try {
    const { session_id, user_id } = req.body;
    
    // Get checkout status from Stripe
    const status = await paymentService.getCheckoutStatus(session_id);

    res.json({
      invoice: {
        id: `inv_${Date.now()}`,
        orderId: `ord_${Date.now()}`,
        amount: status.amountTotal || 0,
        status: status.paymentStatus === 'paid' ? 'paid' : 'pending',
      },
      status: status.paymentStatus === 'paid' ? 'completed' : 'pending',
      message: status.paymentStatus === 'paid' ? 'Purchase completed successfully!' : 'Payment pending',
    });
  } catch (error: any) {
    console.error('Complete checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stripe webhook handler
app.post('/api/checkout/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'] as string;
    const event = await paymentService.handleWebhook(req.body, signature);
    
    console.log('Webhook event:', event.type);
    res.json({ received: true });
  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`✓ API Server running on port ${PORT}`);
  console.log(`✓ Health check: http://localhost:${PORT}/health`);
  console.log(`✓ JWT Secret: ${process.env.JWT_SECRET ? 'Configured ✓' : 'Using default (change in production!)'}`);
  console.log(`✓ Stripe: ${process.env.STRIPE_SECRET_KEY ? 'Configured ✓' : 'Mock mode (add STRIPE_SECRET_KEY to .env)'}`);
  console.log(`✓ Etsy API: ${process.env.ETSY_API_KEY ? 'Configured ✓' : 'Mock mode (add ETSY_API_KEY to .env)'}`);
});
