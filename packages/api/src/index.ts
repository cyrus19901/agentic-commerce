import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { DB } from '@agentic-commerce/database';
import { PolicyService } from '@agentic-commerce/core';
import { EtsyClient, PaymentService, StripeAgentService, FacilitatorService } from '@agentic-commerce/integrations';
import { createAgentRoutes } from './agent-routes';
import { createRegistryRoutes } from './registry-routes';
import { createFacilitatorRoutes } from './facilitator-routes';
import { createChatGPTAgentRoutes } from './chatgpt-agent-routes';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email?: string;
        iat?: number;
      };
    }
  }
}

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Initialize services
const db = new DB(process.env.DATABASE_URL);
const policyService = new PolicyService(db);
const etsyClient = new EtsyClient();
const paymentService = new PaymentService();
const stripeAgentService = new StripeAgentService();
const facilitatorService = new FacilitatorService(db);

// Middleware - Allow all origins for ChatGPT and frontend
app.use(cors({ 
  origin: '*', // Allow all origins explicitly
  credentials: false, // Set to false when using wildcard origin
  exposedHeaders: ['ngrok-skip-browser-warning'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning', 'X-Requested-With']
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
  const userAgent = req.headers['user-agent'] || '';
  if (userAgent.includes('ChatGPT') || userAgent.includes('openai')) {
    console.log('=== ChatGPT REQUEST DETECTED ===');
    console.log('User-Agent:', userAgent);
    console.log('Authorization header present:', !!req.headers.authorization);
    if (req.headers.authorization) {
      console.log('Auth header preview:', req.headers.authorization.substring(0, 50) + '...');
    }
    console.log('Full headers:', JSON.stringify(req.headers, null, 2));
  }
  next();
});

// Auth middleware
const authenticate = (req: any, res: any, next: any) => {
  // Handle OPTIONS preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Log all authentication attempts for debugging
  const userAgent = req.headers['user-agent'] || '';
  const isChatGPT = userAgent.includes('ChatGPT') || userAgent.includes('openai');
  if (isChatGPT) {
    console.log('=== AUTHENTICATION MIDDLEWARE - ChatGPT Request ===');
    console.log('Path:', req.path);
    console.log('User-Agent:', userAgent);
  }
  
  const authHeader = req.headers.authorization;
  
  // CHATGPT SUPPORT: Allow authentication via user_email in request body
  if (!authHeader && req.body && req.body.user_email) {
    console.log('No auth header, attempting email-based auth:', req.body.user_email);
    return (async () => {
      try {
        const user = await db.getUserByEmail(req.body.user_email);
        if (user) {
          req.user = { userId: user.id, email: user.email };
          console.log('Email-based auth successful for:', user.email);
          return next();
        } else {
          console.log('User not found for email:', req.body.user_email);
          return res.status(401).json({ 
            error: 'User not found', 
            message: 'Please create an account first using /api/auth/create-user' 
          });
        }
      } catch (error) {
        console.error('Email-based auth error:', error);
        return res.status(401).json({ error: 'Authentication failed' });
      }
    })();
  }
  
  if (!authHeader) {
    console.log('No authorization header found and no user_email provided');
    if (isChatGPT) {
      console.log('ChatGPT request missing authorization header!');
    }
    return res.status(401).json({ error: 'No token', message: 'Provide either Authorization header or user_email in request body' });
  }
  
  if (isChatGPT) {
    console.log('ChatGPT auth header present:', authHeader.substring(0, 80) + '...');
  }
  
  // Handle "Bearer <token>" format, with flexible spacing
  let token: string | undefined;
  const authLower = authHeader.toLowerCase().trim();
  if (authLower.startsWith('bearer')) {
    // Remove "Bearer" prefix (case-insensitive) and trim
    // Handle multiple spaces between "Bearer" and token
    const afterBearer = authHeader.substring(authHeader.toLowerCase().indexOf('bearer') + 6).trim();
    token = afterBearer.length > 0 ? afterBearer : undefined;
  } else {
    token = authHeader;
  }
  
  if (!token || token.length === 0) {
    console.log('No token found in authorization header');
    console.log('Auth header received:', authHeader.substring(0, 100) + '...');
    if (isChatGPT) {
      console.log('ChatGPT: Token extraction failed!');
    }
    return res.status(401).json({ error: 'No token' });
  }
  
  if (isChatGPT) {
    console.log('ChatGPT: Extracted token:', token.substring(0, 30) + '...');
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    console.log('Token verified successfully for user:', (decoded as any).userId);
    if (isChatGPT) {
      console.log('ChatGPT: Authentication SUCCESS');
    }
    next();
  } catch (error: any) {
    console.log('Token verification failed:', error.message);
    console.log('Token received:', token.substring(0, 20) + '...');
    console.log('JWT_SECRET configured:', !!JWT_SECRET);
    if (isChatGPT) {
      console.log('ChatGPT: Authentication FAILED -', error.message);
      console.log('ChatGPT: Full token (first 50 chars):', token.substring(0, 50));
    }
    res.status(403).json({ error: 'Invalid token', details: error.message });
  }
};

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Debug endpoint - Check environment configuration
app.get('/debug/env', (req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    FRONTEND_URL: process.env.FRONTEND_URL || '⚠️ NOT SET (defaults to http://localhost:3000)',
    API_URL: process.env.API_URL || '⚠️ NOT SET',
    USE_MOCK_PAYMENTS: process.env.USE_MOCK_PAYMENTS || '⚠️ NOT SET',
    STRIPE_KEY_SET: !!process.env.STRIPE_SECRET_KEY ? '✅ Yes' : '❌ No',
    STRIPE_KEY_PREFIX: process.env.STRIPE_SECRET_KEY?.substring(0, 12) || 'NOT SET',
    JWT_SECRET_SET: !!process.env.JWT_SECRET ? '✅ Yes' : '❌ No',
    PORT: process.env.PORT,
    platform: process.platform,
    nodeVersion: process.version,
    timestamp: new Date().toISOString()
  });
});

// Admin endpoint - Clean up duplicate users
app.post('/admin/cleanup-duplicate-users', async (req, res) => {
  try {
    console.log('🔍 Starting duplicate user cleanup...');
    
    const results = await db.cleanupDuplicateUsers();
    
    if (results.duplicatesFound.length === 0) {
      return res.json({
        success: true,
        message: 'No duplicate users found',
        results
      });
    }

    console.log(`✅ Cleanup complete: deleted ${results.usersDeleted.length} duplicate users`);
    
    res.json({
      success: true,
      message: `Cleaned up ${results.usersDeleted.length} duplicate users`,
      results
    });
  } catch (error: any) {
    console.error('❌ Cleanup error:', error);
    res.status(500).json({
      success: false,
      error: 'Cleanup failed',
      details: error.message
    });
  }
});

app.post('/api/products/search', authenticate, async (req, res) => {
  try {
    const { query, max_price, limit = 10, category } = req.body;
    console.log('Product search request:', JSON.stringify({ query, max_price, limit, category }, null, 2));
    const products = await etsyClient.searchProducts({ query, maxPrice: max_price, limit, category });
    console.log(`Product search result: Found ${products?.length || 0} products for query "${query}"`);
    // Always return products array, even if empty
    res.json({ products: products || [] });
  } catch (error: any) {
    console.error('Product search error:', error);
    console.error('Error stack:', error.stack);
    // Return error details for debugging
    res.status(500).json({ 
      error: 'Product search failed', 
      message: error.message,
      products: [] 
    });
  }
});

app.post('/api/policy/check', authenticate, async (req, res) => {
  try {
    // Extract userId from token (user-specific authentication)
    const tokenUser = req.user?.userId;
    
    const { 
      user_id, 
      product_id, 
      price, 
      merchant, 
      category,
      agent_name,
      agent_type,
      time_of_day,
      day_of_week,
      recipient_agent,
      purpose
    } = req.body;
    
    // ALWAYS prioritize token user ID for security (token is authenticated, body can be spoofed)
    const finalUserId = tokenUser || user_id || 'test-user-123';
    
    console.log('Policy check request:', JSON.stringify({ ...req.body, user_id: finalUserId }, null, 2));
    const result = await policyService.checkPurchase({
      userId: finalUserId,
      productId: product_id,
      price,
      merchant,
      category,
      agentName: agent_name,
      agentType: agent_type,
      timeOfDay: time_of_day,
      dayOfWeek: day_of_week,
      recipientAgent: recipient_agent,
      purpose,
    });
    console.log('Policy check response:', JSON.stringify(result, null, 2));
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/policy/spending', authenticate, async (req, res) => {
  try {
    // Extract userId from token (user-specific authentication)
    const tokenUser = req.user?.userId;
    const { user_id } = req.body;
    
    // ALWAYS prioritize token user ID for security (token is authenticated, body can be spoofed)
    const finalUserId = tokenUser || user_id || 'test-user-123';
    
    const [daily, weekly, monthly] = await Promise.all([
      db.getUserSpending(finalUserId, 'daily'),
      db.getUserSpending(finalUserId, 'weekly'),
      db.getUserSpending(finalUserId, 'monthly'),
    ]);
    res.json({ userId: finalUserId, spending: { daily, weekly, monthly } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/purchases', authenticate, async (req, res) => {
  try {
    // Extract userId from token (user-specific authentication)
    const tokenUser = req.user?.userId;
    const queryUserId = req.query.user_id as string | undefined;
    
    // Use userId from token if user_id not provided in query
    const finalUserId = queryUserId || tokenUser;
    const limit = parseInt(req.query.limit as string) || 50;
    
    const purchases = await db.getPurchaseHistory(finalUserId, limit);
    res.json({ purchases, userId: finalUserId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/approval-accuracy', authenticate, async (req, res) => {
  try {
    // Extract userId from token (user-specific authentication)
    const tokenUser = req.user?.userId;
    const queryUserId = req.query.user_id as string | undefined;
    
    // Use userId from token if user_id not provided in query
    const finalUserId = queryUserId || tokenUser;
    const accuracy = await db.getApprovalAccuracy(finalUserId);
    res.json({ ...accuracy, userId: finalUserId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Approval Management Endpoints
// ============================================================================

app.get('/api/approvals/pending', authenticate, async (req, res) => {
  try {
    const tokenUser = req.user?.userId;
    const queryUserId = req.query.user_id as string | undefined;
    
    // Use userId from token if user_id not provided in query
    const finalUserId = queryUserId || tokenUser;
    const pendingApprovals = await db.getPendingApprovals(finalUserId);
    
    res.json({ 
      approvals: pendingApprovals,
      count: pendingApprovals.length,
      userId: finalUserId 
    });
  } catch (error: any) {
    console.error('Get pending approvals error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/approvals/:id/approve', authenticate, async (req, res) => {
  try {
    const purchaseId = parseInt(req.params.id);
    if (isNaN(purchaseId)) {
      return res.status(400).json({ error: 'Invalid purchase ID' });
    }

    // Get purchase details
    const purchase = await db.getPurchaseById(purchaseId);
    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    if (purchase.approval_status === 'approved') {
      return res.status(400).json({ error: 'Purchase already approved' });
    }

    // Approve the purchase
    await db.approvePurchase(purchaseId);
    
    // Initiate actual checkout/payment
    let checkoutResult = null;
    try {
      checkoutResult = await paymentService.initiateCheckout({
        userId: purchase.userId,
        productId: purchase.productId,
        productName: purchase.productName,
        amount: purchase.amount,
        merchant: purchase.merchant,
        category: purchase.category,
        productUrl: purchase.productUrl,
        productImageUrl: purchase.productImageUrl,
      });
    } catch (checkoutError: any) {
      console.error('Checkout after approval failed:', checkoutError);
      // Still mark as approved, but note checkout failure
    }
    
    res.json({ 
      success: true,
      message: 'Purchase approved and checkout initiated',
      purchaseId,
      purchase: {
        id: purchase.id,
        productName: purchase.productName,
        amount: purchase.amount,
        merchant: purchase.merchant,
        approvedAt: new Date().toISOString()
      },
      checkout: checkoutResult ? {
        checkoutUrl: checkoutResult.checkoutUrl,
        sessionId: checkoutResult.sessionId,
        invoiceUrl: checkoutResult.invoiceUrl
      } : null
    });
  } catch (error: any) {
    console.error('Approve purchase error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/approvals/:id/reject', authenticate, async (req, res) => {
  try {
    const purchaseId = parseInt(req.params.id);
    if (isNaN(purchaseId)) {
      return res.status(400).json({ error: 'Invalid purchase ID' });
    }

    // Get purchase details
    const purchase = await db.getPurchaseById(purchaseId);
    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    if (purchase.approval_status === 'rejected') {
      return res.status(400).json({ error: 'Purchase already rejected' });
    }

    const { reason } = req.body;
    await db.rejectPurchase(purchaseId, reason || 'No reason provided');
    
    res.json({ 
      success: true,
      message: 'Purchase rejected',
      purchaseId,
      purchase: {
        id: purchase.id,
        productName: purchase.productName,
        amount: purchase.amount,
        merchant: purchase.merchant,
        rejectedAt: new Date().toISOString(),
        rejectionReason: reason || 'No reason provided'
      }
    });
  } catch (error: any) {
    console.error('Reject purchase error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get approval status (for polling or checking)
app.get('/api/approvals/:id/status', authenticate, async (req, res) => {
  try {
    const purchaseId = parseInt(req.params.id);
    if (isNaN(purchaseId)) {
      return res.status(400).json({ error: 'Invalid purchase ID' });
    }

    const purchase = await db.getPurchaseById(purchaseId);
    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    res.json({
      purchaseId,
      status: purchase.approval_status || 'pending',
      requiresApproval: purchase.requiresApproval,
      productName: purchase.productName,
      amount: purchase.amount,
      merchant: purchase.merchant,
      createdAt: purchase.timestamp,
      updatedAt: purchase.updated_at || purchase.timestamp
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/checkout/initiate', authenticate, async (req, res) => {
  try {
    // Extract userId from token (user-specific authentication)
    const tokenUser = req.user?.userId;
    
    console.log('Checkout request body:', JSON.stringify(req.body, null, 2));
    const { user_id, product_id, amount, merchant, category, product_name, product_url, product_image_url } = req.body;

    // ALWAYS prioritize token user ID for security (token is authenticated, body can be spoofed)
    const finalUserId = tokenUser || user_id || 'test-user-123';

    // Check policy first
    const { agent_name, agent_type, time_of_day, day_of_week, recipient_agent, purpose } = req.body;
    const policyCheck = await policyService.checkPurchase({
      userId: finalUserId,
      productId: product_id,
      price: amount,
      merchant,
      category,
      agentName: agent_name,
      agentType: agent_type,
      timeOfDay: time_of_day,
      dayOfWeek: day_of_week,
      recipientAgent: recipient_agent,
      purpose,
    });

    // Handle policy check results
    if (!policyCheck.allowed && !policyCheck.requiresApproval) {
      // Purchase is blocked (denied)
      return res.status(403).json({
        error: 'Purchase not allowed',
        reason: policyCheck.reason,
        matchedPolicies: policyCheck.matchedPolicies,
      });
    }

    // Get product details if any are missing
    let finalProductName = product_name;
    let finalProductImageUrl = product_image_url;
    let finalProductUrl = product_url;
    let finalMerchant = merchant;
    let finalCategory = category;
    
    if (!finalProductName || !finalProductImageUrl || !finalProductUrl || !finalMerchant || !finalCategory) {
      try {
        const product = await etsyClient.getProductById(product_id);
        if (product) {
          finalProductName = finalProductName || product.title;
          finalProductImageUrl = finalProductImageUrl || product.imageUrl;
          finalProductUrl = finalProductUrl || product.url;
          finalMerchant = finalMerchant || product.merchant;
          finalCategory = finalCategory || product.category;
        }
      } catch (error) {
        console.log('Could not fetch product details:', error);
      }
    }

    // Fallback for missing product name
    if (!finalProductName) {
      finalProductName = `Product ${product_id}`;
      console.warn(`⚠️  No product name found for ${product_id}, using fallback`);
    }

    // If purchase requires approval, record as pending and return
    if (policyCheck.requiresApproval) {
      const purchaseId = await db.recordPurchaseAttempt({
        userId: finalUserId,
        productId: product_id,
        productName: finalProductName,
        amount,
        merchant: finalMerchant || merchant,
        category: finalCategory || category,
        allowed: false, // Not yet approved
        requiresApproval: true,
        policyCheckResults: policyCheck.matchedPolicies.map((p: any) => ({
          ...p,
          acpCheckout: false,
        })),
      });
      console.log(`🟡 Purchase requires approval - Purchase ID: ${purchaseId}, User: ${finalUserId}, Product: ${product_id}, Amount: $${amount}`);

      return res.json({
        requiresApproval: true,
        purchaseId,
        status: 'pending_approval',
        message: 'Purchase recorded and pending manual approval',
        productName: finalProductName,
        amount,
        reason: policyCheck.reason,
        matchedPolicies: policyCheck.matchedPolicies,
      });
    }

    // Create Stripe checkout session (for auto-approved purchases)
    const checkout = await paymentService.initiateCheckout({
      userId: finalUserId,
      productId: product_id,
      productName: finalProductName,
      amount,
      merchant: finalMerchant || merchant || 'Unknown Merchant',
      category: finalCategory || category,
      productUrl: finalProductUrl,
      productImageUrl: finalProductImageUrl,
    });
    console.log('Checkout response:', JSON.stringify(checkout, null, 2));

    // Record purchase attempt (traditional checkout, not ACP)
    await db.recordPurchaseAttempt({
      userId: finalUserId,
      productId: product_id,
      productName: finalProductName,
      amount,
      merchant: finalMerchant || merchant,
      category: finalCategory || category,
      allowed: true,
      requiresApproval: false,
      policyCheckResults: policyCheck.matchedPolicies.map((p: any) => ({
        ...p,
        acpCheckout: false, // Mark as traditional checkout
      })),
    });
    console.log(`✅ Auto-approved purchase for user ${finalUserId}, product ${product_id}, amount $${amount}`);

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
    // Extract userId from token (user-specific authentication)
    const tokenUser = req.user?.userId;
    const { session_id, user_id, product_id, product_name, amount, merchant, category } = req.body;
    
    // ALWAYS prioritize token user ID for security (token is authenticated, body can be spoofed)
    const finalUserId = tokenUser || user_id || 'test-user-123';
    
    console.log('Complete checkout request:', JSON.stringify({ ...req.body, user_id: finalUserId }, null, 2));
    
    // Get checkout status from Stripe
    const status = await paymentService.getCheckoutStatus(session_id);
    
    const isPaid = status.paymentStatus === 'paid';
    
    // Record completed purchase attempt (update existing or create new)
    if (isPaid && finalUserId && product_id) {
      await db.recordPurchaseAttempt({
        userId: finalUserId,
        productId: product_id,
        productName: product_name,
        amount: amount || status.amountTotal || 0,
        merchant: merchant || 'Unknown',
        category: category,
        allowed: true,
        requiresApproval: false,
        policyCheckResults: [],
      });
      console.log(`Recorded completed purchase for user ${finalUserId}, product ${product_id}`);
    }

    res.json({
      invoice: {
        id: `inv_${Date.now()}`,
        orderId: `ord_${Date.now()}`,
        amount: status.amountTotal || amount || 0,
        status: isPaid ? 'paid' : 'pending',
      },
      status: isPaid ? 'completed' : 'pending',
      message: isPaid ? 'Purchase completed successfully!' : 'Payment pending',
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

// ============================================================================
// NEW: Agent-to-Agent & Registry Routes
// ============================================================================

// Mount agent service routes (x402 protocol endpoints)
app.use('/api/agent', authenticate, createAgentRoutes(db, policyService, facilitatorService));

// Mount registry routes (agent discovery)
app.use('/api/registry', createRegistryRoutes(db));

// Mount facilitator routes (payment verification)
app.use('/api/facilitator', createFacilitatorRoutes(facilitatorService));

// Mount ChatGPT agent routes (simplified agent-to-agent for ChatGPT)
app.use('/api/chatgpt-agent', createChatGPTAgentRoutes(db, policyService, facilitatorService));

// Policy Management Endpoints
app.get('/api/policies', authenticate, async (req, res) => {
  try {
    const policies = await db.getAllPolicies();
    res.json({ policies });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/policies/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const policy = await db.getPolicyById(id);
    if (!policy) {
      return res.status(404).json({ error: 'Policy not found' });
    }
    res.json({ policy });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/policies', authenticate, async (req, res) => {
  try {
    const policy = req.body;
    // Validate required fields
    if (!policy.id || !policy.name || !policy.type) {
      return res.status(400).json({ error: 'Missing required fields: id, name, type' });
    }
    await db.createPolicy(policy);
    res.json({ policy, message: 'Policy created successfully' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Policy with this ID already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/policies/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const policy = { ...req.body, id };
    
    // Check if policy exists
    const existing = await db.getPolicyById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Policy not found' });
    }
    
    await db.updatePolicy(policy);
    res.json({ policy, message: 'Policy updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/policies/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.getPolicyById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Policy not found' });
    }
    await db.deletePolicy(id);
    res.json({ message: 'Policy deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get policy compliance statistics
app.get('/api/policy/compliance', authenticate, async (req, res) => {
  try {
    const tokenUser = req.user?.userId;
    const { user_id } = req.query;
    
    // Prioritize token user for security
    const finalUserId = tokenUser || user_id as string | undefined;
    
    const stats = await db.getPolicyComplianceStats(finalUserId);
    res.json({ stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get analytics for a specific policy
app.get('/api/policy/analytics/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const tokenUser = req.user?.userId;
    const { user_id } = req.query;
    
    // Prioritize token user for security
    const finalUserId = tokenUser || user_id as string | undefined;
    
    const analytics = await db.getPolicyAnalytics(id, finalUserId);
    res.json({ analytics });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle policy enabled/disabled status
app.patch('/api/policies/:id/toggle', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;
    
    const policy = await db.getPolicyById(id);
    if (!policy) {
      return res.status(404).json({ error: 'Policy not found' });
    }
    
    await db.updatePolicy({ ...policy, enabled: enabled !== undefined ? enabled : !policy.enabled });
    const updated = await db.getPolicyById(id);
    
    if (!updated) {
      return res.status(500).json({ error: 'Failed to update policy' });
    }
    
    res.json({ 
      policy: updated, 
      message: `Policy ${updated.enabled ? 'enabled' : 'disabled'} successfully` 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Dashboard & Reporting Endpoints
// ============================================================================

// Get comprehensive user dashboard data
app.get('/api/dashboard', authenticate, async (req, res) => {
  try {
    const tokenUser = req.user?.userId;
    const { user_id } = req.query;
    const finalUserId = tokenUser || user_id as string | undefined;
    
    if (!finalUserId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    
    // Get user info
    const user = await db.getUserById(finalUserId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get spending data
    const [daily, weekly, monthly] = await Promise.all([
      db.getUserSpending(finalUserId, 'daily'),
      db.getUserSpending(finalUserId, 'weekly'),
      db.getUserSpending(finalUserId, 'monthly'),
    ]);
    
    // Get policies
    const policies = await db.getUserPolicies(finalUserId);
    
    // Get recent purchases
    const purchases = await db.getPurchaseHistory(finalUserId, 10);
    
    // Get pending approvals
    const pendingApprovals = await db.getPendingApprovals(finalUserId);
    
    // Get policy compliance stats
    const complianceStats = await db.getPolicyComplianceStats(finalUserId);
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      },
      spending: {
        daily,
        weekly,
        monthly
      },
      policies: {
        total: policies.length,
        enabled: policies.filter((p: any) => p.enabled).length,
        list: policies
      },
      recentPurchases: purchases,
      pendingApprovals: pendingApprovals.length,
      compliance: complianceStats
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get detailed spending report
app.get('/api/reports/spending', authenticate, async (req, res) => {
  try {
    const tokenUser = req.user?.userId;
    const { user_id, start_date, end_date } = req.query;
    const finalUserId = tokenUser || user_id as string | undefined;
    
    if (!finalUserId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    
    // Get all purchases
    const purchases = await db.getPurchaseHistory(finalUserId, 1000);
    
    // Filter by date range if provided
    let filtered = purchases;
    if (start_date || end_date) {
      filtered = purchases.filter((p: any) => {
        const pDate = new Date(p.created_at);
        if (start_date && pDate < new Date(start_date as string)) return false;
        if (end_date && pDate > new Date(end_date as string)) return false;
        return true;
      });
    }
    
    // Calculate aggregates
    const total = filtered.reduce((sum: number, p: any) => sum + p.amount, 0);
    const byCategory: Record<string, number> = {};
    const byMerchant: Record<string, number> = {};
    const byStatus: Record<string, number> = { allowed: 0, denied: 0, pending: 0 };
    
    filtered.forEach((p: any) => {
      if (p.category) {
        byCategory[p.category] = (byCategory[p.category] || 0) + p.amount;
      }
      if (p.merchant) {
        byMerchant[p.merchant] = (byMerchant[p.merchant] || 0) + p.amount;
      }
      if (p.allowed) byStatus.allowed += p.amount;
      else if (p.requires_approval) byStatus.pending += p.amount;
      else byStatus.denied += p.amount;
    });
    
    res.json({
      userId: finalUserId,
      period: { start: start_date || 'all', end: end_date || 'now' },
      summary: {
        totalSpent: total,
        transactionCount: filtered.length,
        averageTransaction: filtered.length > 0 ? total / filtered.length : 0
      },
      breakdowns: {
        byCategory,
        byMerchant,
        byStatus
      },
      transactions: filtered
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get invoice/receipt history
app.get('/api/invoices', authenticate, async (req, res) => {
  try {
    const tokenUser = req.user?.userId;
    const { user_id, limit = 50 } = req.query;
    const finalUserId = tokenUser || user_id as string | undefined;
    
    if (!finalUserId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    
    // Get approved/completed purchases only
    const allPurchases = await db.getPurchaseHistory(finalUserId, parseInt(limit as string));
    const invoices = allPurchases.filter((p: any) => p.allowed && !p.requires_approval);
    
    res.json({
      userId: finalUserId,
      invoices: invoices.map((p: any) => ({
        id: p.id,
        date: p.created_at,
        productName: p.product_name,
        merchant: p.merchant,
        category: p.category,
        amount: p.amount,
        status: 'paid',
        policyChecksPassed: p.policy_check_results?.filter((r: any) => r.passed).length || 0
      })),
      summary: {
        total: invoices.reduce((sum: number, p: any) => sum + p.amount, 0),
        count: invoices.length
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// User Management Endpoints
// ============================================================================

// List all users (admin endpoint)
app.get('/api/users', authenticate, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    
    // Get policy counts for each user
    const usersWithPolicies = await Promise.all(
      users.map(async (user) => {
        const policies = await db.getUserPolicies(user.id);
        const [daily, weekly, monthly] = await Promise.all([
          db.getUserSpending(user.id, 'daily'),
          db.getUserSpending(user.id, 'weekly'),
          db.getUserSpending(user.id, 'monthly'),
        ]);
        
        return {
          ...user,
          policyCount: policies.length,
          spending: { daily, weekly, monthly }
        };
      })
    );
    
    res.json({ users: usersWithPolicies });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get user details with policies
app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await db.getUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const policies = await db.getUserPolicies(id);
    const [daily, weekly, monthly] = await Promise.all([
      db.getUserSpending(id, 'daily'),
      db.getUserSpending(id, 'weekly'),
      db.getUserSpending(id, 'monthly'),
    ]);
    
    res.json({
      user,
      policies,
      spending: { daily, weekly, monthly }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Assign policy to user
app.post('/api/users/:userId/policies/:policyId', authenticate, async (req, res) => {
  try {
    const { userId, policyId } = req.params;
    
    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const policy = await db.getPolicyById(policyId);
    if (!policy) {
      return res.status(404).json({ error: 'Policy not found' });
    }
    
    await db.assignPolicyToUser(userId, policyId);
    res.json({ message: 'Policy assigned successfully' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Policy already assigned to user' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Remove policy from user
app.delete('/api/users/:userId/policies/:policyId', authenticate, async (req, res) => {
  try {
    const { userId, policyId } = req.params;
    
    await db.removePolicyFromUser(userId, policyId);
    res.json({ message: 'Policy removed successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// User-Specific JWT Token Generation (for ChatGPT Authentication)
// ============================================================================

/**
 * Generate a user-specific JWT token for ChatGPT authentication
 * This endpoint should be called by the frontend after user login
 * The token will be used to authenticate ChatGPT API calls
 * 
 * IMPORTANT: Each user gets their own token with their userId embedded
 * Creates user in database if they don't exist
 */
app.post('/api/auth/generate-token', async (req, res) => {
  try {
    // Get user session from cookie or request body
    const sessionCookie = req.headers.cookie
      ?.split(';')
      .find(c => c.trim().startsWith('session='))
      ?.split('=')[1];

    let sessionData: any = null;

    if (sessionCookie) {
      try {
        sessionData = JSON.parse(decodeURIComponent(sessionCookie));
      } catch (e) {
        // If cookie parsing fails, try request body
        sessionData = req.body.session;
      }
    } else {
      // Fallback to request body
      sessionData = req.body.session || req.body;
    }

    // Extract email from session
    const email = sessionData?.email || req.body.email;
    const name = sessionData?.name || req.body.name;

    if (!email) {
      return res.status(401).json({
        error: 'User email required',
        message: 'Please log in first to generate a token',
      });
    }

    // Create or get user in database
    const user = await db.createOrGetUser(email, name);
    console.log(`✓ User in database: ${user.id} (${user.email})`);

    // Generate JWT token with user-specific userId from database
    const token = jwt.sign(
      { 
        userId: user.id, // Use database user ID
        email: user.email,
        iat: Math.floor(Date.now() / 1000),
      },
      JWT_SECRET,
      { expiresIn: '30d' } // Token valid for 30 days
    );

    console.log(`✓ Generated JWT token for user: ${user.id} (${user.email})`);

    res.json({
      success: true,
      token,
      userId: user.id,
      email: user.email,
      name: user.name,
      expiresIn: '30d',
      message: 'Token generated successfully. Use this token in ChatGPT OpenAPI schema authentication.',
    });
  } catch (error: any) {
    console.error('Token generation error:', error);
    res.status(500).json({
      error: 'Failed to generate token',
      details: error.message,
    });
  }
});

/**
 * Create or get user by email
 * Used by frontend during authentication
 */
app.post('/api/auth/create-user', async (req, res) => {
  try {
    const { email, name } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required',
      });
    }

    // Create or get user in database
    const user = await db.createOrGetUser(email, name);

    // Assign all active policies to new users
    try {
      const allPolicies = db.db.prepare('SELECT id FROM policies WHERE enabled = 1').all() as any[];
      console.log(`📋 Assigning ${allPolicies.length} policies to user ${user.email}`);
      
      for (const policy of allPolicies) {
        db.db.prepare('INSERT OR IGNORE INTO user_policies (user_id, policy_id, active) VALUES (?, ?, 1)')
          .run(user.id, policy.id);
      }
      console.log(`✅ Assigned policies to ${user.email}`);
    } catch (policyError: any) {
      console.error('⚠️  Failed to assign policies:', policyError.message);
      // Don't fail user creation if policy assignment fails
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      message: user.name ? 'User created/retrieved successfully' : 'User created/retrieved successfully',
    });
  } catch (error: any) {
    console.error('Create user error:', error);
    res.status(500).json({
      error: 'Failed to create user',
      details: error.message,
    });
  }
});

// Admin endpoint to initialize/re-run database setup
app.post('/api/admin/db-setup', async (req, res) => {
  try {
    console.log('🔧 Running database setup...');
    const { execSync } = require('child_process');
    
    // Run db:setup script
    const output = execSync('npm run db:setup', { 
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 30000
    });
    
    console.log('✅ Database setup complete');
    
    // Now assign policies to all users
    const allUsers = db.db.prepare('SELECT id, email FROM users').all() as any[];
    const allPolicies = db.db.prepare('SELECT id FROM policies WHERE enabled = 1').all() as any[];
    
    for (const user of allUsers) {
      for (const policy of allPolicies) {
        db.db.prepare('INSERT OR IGNORE INTO user_policies (user_id, policy_id, active) VALUES (?, ?, 1)')
          .run(user.id, policy.id);
      }
    }
    
    res.json({
      success: true,
      message: 'Database setup completed successfully',
      policiesCreated: allPolicies.length,
      usersWithPolicies: allUsers.length,
      output: output.substring(0, 500)
    });
  } catch (error: any) {
    console.error('DB setup error:', error);
    res.status(500).json({
      error: 'Database setup failed',
      details: error.message
    });
  }
});

// Admin endpoint to assign policies to existing users
app.post('/api/admin/assign-policies', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      // Assign to all users
      const allUsers = db.db.prepare('SELECT id, email FROM users').all() as any[];
      const allPolicies = db.db.prepare('SELECT id FROM policies WHERE enabled = 1').all() as any[];
      
      console.log(`📋 Assigning ${allPolicies.length} policies to ${allUsers.length} users`);
      
      let assignedCount = 0;
      for (const user of allUsers) {
        for (const policy of allPolicies) {
          try {
            db.db.prepare('INSERT OR IGNORE INTO user_policies (user_id, policy_id, active) VALUES (?, ?, 1)')
              .run(user.id, policy.id);
            assignedCount++;
          } catch (e) {
            // Ignore duplicates
          }
        }
        console.log(`✅ Assigned policies to ${user.email}`);
      }
      
      return res.json({
        success: true,
        message: `Assigned policies to ${allUsers.length} users`,
        usersUpdated: allUsers.length,
        policiesPerUser: allPolicies.length,
        totalAssignments: assignedCount
      });
    }

    // Assign to specific user
    const allPolicies = db.db.prepare('SELECT id FROM policies WHERE enabled = 1').all() as any[];
    console.log(`📋 Assigning ${allPolicies.length} policies to user ${userId}`);
    
    for (const policy of allPolicies) {
      db.db.prepare('INSERT OR IGNORE INTO user_policies (user_id, policy_id, active) VALUES (?, ?, 1)')
        .run(userId, policy.id);
    }
    
    res.json({
      success: true,
      message: `Assigned ${allPolicies.length} policies to user`,
      userId,
      policiesAssigned: allPolicies.length
    });
  } catch (error: any) {
    console.error('Policy assignment error:', error);
    res.status(500).json({
      error: 'Failed to assign policies',
      details: error.message,
    });
  }
});

/**
 * Get current user info from token (for debugging/verification)
 */
app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Get full user info from database
    const dbUser = await db.getUserById(user.userId);
    
    res.json({
      userId: user.userId,
      email: user.email || dbUser?.email,
      name: dbUser?.name,
      authenticated: true,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Stripe Agents Toolkit Endpoints (Phase 1)
// ============================================================================

app.post('/api/stripe/create-payment-link', authenticate, async (req, res) => {
  try {
    const { product_name, amount, currency, description, success_url, cancel_url, metadata } = req.body;

    if (!product_name || !amount) {
      return res.status(400).json({ error: 'product_name and amount are required' });
    }

    const result = await stripeAgentService.createPaymentLink({
      productName: product_name,
      amount: parseFloat(amount),
      currency: currency || 'usd',
      description,
      successUrl: success_url,
      cancelUrl: cancel_url,
      metadata,
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to create payment link' });
    }

    res.json({
      success: true,
      payment_link_id: result.paymentLinkId,
      url: result.url,
      message: 'Payment link created successfully',
    });
  } catch (error: any) {
    console.error('Create payment link error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/stripe/create-product', authenticate, async (req, res) => {
  try {
    const { name, description, images, metadata } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const result = await stripeAgentService.createProduct({
      name,
      description,
      images,
      metadata,
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to create product' });
    }

    res.json({
      success: true,
      product_id: result.productId,
      message: 'Product created successfully',
    });
  } catch (error: any) {
    console.error('Create product error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/stripe/create-price', authenticate, async (req, res) => {
  try {
    const { product_id, amount, currency, recurring } = req.body;

    if (!product_id || !amount) {
      return res.status(400).json({ error: 'product_id and amount are required' });
    }

    const result = await stripeAgentService.createPrice({
      productId: product_id,
      amount: parseFloat(amount),
      currency: currency || 'usd',
      recurring,
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to create price' });
    }

    res.json({
      success: true,
      price_id: result.priceId,
      message: 'Price created successfully',
    });
  } catch (error: any) {
    console.error('Create price error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ACP-Compliant Endpoints (Phase 2)
// ============================================================================

/**
 * ACP-compliant /checkout endpoint
 * Follows Agentic Commerce Protocol specification
 */
app.post('/checkout', authenticate, async (req, res) => {
  try {
    const {
      user_id,
      product_id,
      product_name,
      amount,
      merchant,
      category,
      product_url,
      product_image_url,
      agent_name,
      agent_type,
      time_of_day,
      day_of_week,
      recipient_agent,
      purpose,
    } = req.body;

    // Extract userId from token (user-specific authentication)
    const tokenUser = req.user?.userId;
    
    // ALWAYS prioritize token user ID for security (token is authenticated, body can be spoofed)
    const finalUserId = tokenUser || user_id;
    
    // Validate required fields
    if (!finalUserId || !product_id || !product_name || !amount || !merchant) {
      return res.status(400).json({
        error: 'Missing required fields: user_id (or token), product_id, product_name, amount, merchant',
      });
    }

    // Check policy first (ACP requires policy checks before checkout)
    const policyCheck = await policyService.checkPurchase({
      userId: finalUserId,
      productId: product_id,
      price: amount,
      merchant,
      category,
      agentName: agent_name,
      agentType: agent_type,
      timeOfDay: time_of_day,
      dayOfWeek: day_of_week,
      recipientAgent: recipient_agent,
      purpose,
    });

    if (!policyCheck.allowed) {
      return res.status(403).json({
        error: 'Purchase not allowed',
        reason: policyCheck.reason,
        matchedPolicies: policyCheck.matchedPolicies,
        // ACP-compliant error response
        code: 'POLICY_VIOLATION',
      });
    }

    // Get product details if not provided
    let finalProductImageUrl = product_image_url;
    let finalProductUrl = product_url;

    if (!finalProductImageUrl || !finalProductUrl) {
      try {
        const product = await etsyClient.getProductById(product_id);
        if (product) {
          finalProductImageUrl = finalProductImageUrl || product.imageUrl;
          finalProductUrl = finalProductUrl || product.url;
        }
      } catch (error) {
        console.log('Could not fetch product details:', error);
      }
    }

    // Create checkout session
    const checkout = await paymentService.initiateCheckout({
      userId: finalUserId,
      productId: product_id,
      productName: product_name,
      amount,
      merchant,
      category,
      productUrl: finalProductUrl,
      productImageUrl: finalProductImageUrl,
    });

    // Record purchase attempt with ACP flag
    await db.recordPurchaseAttempt({
      userId: finalUserId,
      productId: product_id,
      productName: product_name,
      amount,
      merchant,
      category,
      allowed: true,
      requiresApproval: policyCheck.requiresApproval || false,
      policyCheckResults: policyCheck.matchedPolicies,
      checkoutMethod: 'acp', // Mark as ACP checkout
    });

    // ACP-compliant response
    res.json({
      checkout_id: checkout.sessionId,
      checkout_url: checkout.checkoutUrl,
      expires_at: new Date(Date.now() + 1800000).toISOString(), // 30 minutes
      status: 'pending',
      requires_approval: policyCheck.requiresApproval || false,
    });
  } catch (error: any) {
    console.error('ACP checkout error:', error);
    res.status(500).json({
      error: error.message,
      code: 'CHECKOUT_ERROR',
    });
  }
});

/**
 * ACP-compliant /delegate-payment endpoint
 * Allows payment token delegation between parties
 */
app.post('/delegate-payment', authenticate, async (req, res) => {
  try {
    const { checkout_id, payment_token, delegate_to } = req.body;

    if (!checkout_id || !payment_token) {
      return res.status(400).json({
        error: 'Missing required fields: checkout_id, payment_token',
        code: 'INVALID_REQUEST',
      });
    }

    // In a real implementation, this would delegate the payment token
    // For now, we'll return a success response with delegated token info
    res.json({
      success: true,
      delegated_token: `delegated_${payment_token}`,
      delegate_to: delegate_to || 'merchant',
      expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour
      message: 'Payment token delegated successfully',
    });
  } catch (error: any) {
    console.error('Delegate payment error:', error);
    res.status(500).json({
      error: error.message,
      code: 'DELEGATION_ERROR',
    });
  }
});

/**
 * ACP-compliant /fulfillment endpoints
 * Track order fulfillment status
 */
app.get('/fulfillment/:orderId', authenticate, async (req, res) => {
  try {
    const { orderId } = req.params;

    // In a real implementation, fetch fulfillment status from database
    // For now, return mock fulfillment status
    res.json({
      order_id: orderId,
      status: 'pending',
      fulfillment_status: 'not_fulfilled',
      estimated_delivery: null,
      tracking_number: null,
    });
  } catch (error: any) {
    console.error('Get fulfillment error:', error);
    res.status(500).json({
      error: error.message,
      code: 'FULFILLMENT_ERROR',
    });
  }
});

app.post('/fulfillment', authenticate, async (req, res) => {
  try {
    const { order_id, status, tracking_number, estimated_delivery } = req.body;

    if (!order_id || !status) {
      return res.status(400).json({
        error: 'Missing required fields: order_id, status',
        code: 'INVALID_REQUEST',
      });
    }

    // In a real implementation, update fulfillment status in database
    res.json({
      success: true,
      order_id,
      status,
      tracking_number,
      estimated_delivery,
      updated_at: new Date().toISOString(),
      message: 'Fulfillment status updated',
    });
  } catch (error: any) {
    console.error('Update fulfillment error:', error);
    res.status(500).json({
      error: error.message,
      code: 'FULFILLMENT_ERROR',
    });
  }
});

/**
 * Checkout Success Page
 * Shows payment status and ACP compliance information
 */
app.get('/checkout/success', async (req, res) => {
  try {
    const { session_id } = req.query;
    
    if (!session_id) {
      return res.status(400).send(`
        <html>
          <head><title>Checkout Error</title></head>
          <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h1>❌ Missing Session ID</h1>
            <p>No session_id provided in the URL.</p>
          </body>
        </html>
      `);
    }

    // Get checkout status from Stripe
    const status = await paymentService.getCheckoutStatus(session_id as string);
    
    // Check if this was an ACP checkout by looking at purchase history
    // Get all recent purchases and find the one matching this session
    const userId = status.metadata?.userId;
    const productId = status.metadata?.productId;
    
    let isACP = false;
    if (userId && productId) {
      const purchases = await db.getPurchaseHistory(userId, 100);
      // Find the most recent purchase matching this product (within last 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const purchase = purchases.find((p: any) => {
        const matchesProduct = p.productId === productId;
        const isRecent = p.timestamp >= fiveMinutesAgo;
        return matchesProduct && isRecent;
      });
      // Check if ACP-compliant by looking at checkout method
      isACP = purchase?.checkoutMethod === 'acp';
      console.log(`Checkout success page - User: ${userId}, Product: ${productId}, ACP: ${isACP}, Purchase found: ${!!purchase}`);
    }

    const isPaid = status.paymentStatus === 'paid' || status.paymentStatus === 'complete';
    const amount = status.amountTotal || 0;
    const currency = status.currency?.toUpperCase() || 'USD';
    const productName = status.metadata?.productName || status.metadata?.productId || 'Unknown Product';
    const merchant = status.metadata?.merchant || 'Unknown Merchant';
    const category = status.metadata?.category || 'N/A';

    // Create HTML response
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Checkout Success</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 40px 20px;
              background: #f5f5f5;
            }
            .container {
              background: white;
              border-radius: 12px;
              padding: 40px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }
            h1 { color: ${isPaid ? '#10b981' : '#f59e0b'}; margin-top: 0; }
            .status-badge {
              display: inline-block;
              padding: 8px 16px;
              border-radius: 20px;
              font-weight: 600;
              font-size: 14px;
              margin: 10px 5px;
            }
            .paid { background: #d1fae5; color: #065f46; }
            .pending { background: #fef3c7; color: #92400e; }
            .acp { background: #dbeafe; color: #1e40af; }
            .info-box {
              background: #f9fafb;
              border-left: 4px solid #3b82f6;
              padding: 20px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .detail-row {
              display: flex;
              justify-content: space-between;
              padding: 12px 0;
              border-bottom: 1px solid #e5e7eb;
            }
            .detail-label { font-weight: 600; color: #6b7280; }
            .detail-value { color: #111827; }
            .checkout-method {
              margin-top: 20px;
              padding: 16px;
              background: ${isACP ? '#eff6ff' : '#fef3c7'};
              border-radius: 8px;
              border: 2px solid ${isACP ? '#3b82f6' : '#f59e0b'};
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>${isPaid ? '✅ Payment Successful!' : '⏳ Payment Pending'}</h1>
            
            <div>
              <span class="status-badge ${isPaid ? 'paid' : 'pending'}">
                ${isPaid ? 'PAID' : 'PENDING'}
              </span>
              ${isACP ? '<span class="status-badge acp">ACP-COMPLIANT</span>' : ''}
            </div>

            <div class="info-box">
              <h3 style="margin-top: 0;">Payment Details</h3>
              <div class="detail-row">
                <span class="detail-label">Product:</span>
                <span class="detail-value">${productName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Merchant:</span>
                <span class="detail-value">${merchant}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Category:</span>
                <span class="detail-value">${category}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Amount:</span>
                <span class="detail-value"><strong>${currency} $${amount.toFixed(2)}</strong></span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Session ID:</span>
                <span class="detail-value" style="font-family: monospace; font-size: 12px;">${session_id}</span>
              </div>
            </div>

            <div class="checkout-method">
              <h3 style="margin-top: 0;">
                ${isACP ? '🔄 ACP-Compliant Checkout' : '📦 Traditional Checkout'}
              </h3>
              <p style="margin-bottom: 0;">
                ${isACP 
                  ? 'This purchase was completed using the Agentic Commerce Protocol (ACP) /checkout endpoint. Policy checks were performed automatically before checkout initiation.'
                  : 'This purchase was completed using the traditional checkout flow (/api/checkout/initiate).'}
              </p>
            </div>

            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 14px;">
              <p>Payment Status: <strong>${status.paymentStatus || status.status || 'Unknown'}</strong></p>
              <p style="margin-top: 10px;">
                <a href="/api/purchases" style="color: #3b82f6; text-decoration: none;">View Purchase History</a>
              </p>
            </div>
          </div>
        </body>
      </html>
    `;

    res.send(html);
  } catch (error: any) {
    console.error('Checkout success page error:', error);
    res.status(500).send(`
      <html>
        <head><title>Error</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1>❌ Error</h1>
          <p>${error.message}</p>
        </body>
      </html>
    `);
  }
});

/**
 * Checkout Cancel Page
 */
app.get('/checkout/cancel', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Checkout Cancelled</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 40px 20px;
            background: #f5f5f5;
            text-align: center;
          }
          .container {
            background: white;
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
          h1 { color: #f59e0b; margin-top: 0; font-size: 32px; }
          p { color: #6b7280; font-size: 16px; line-height: 1.6; }
          .icon { font-size: 64px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">⚠️</div>
          <h1>Checkout Cancelled</h1>
          <p>You cancelled the checkout process.</p>
          <p>No charges were made to your account.</p>
          <p style="margin-top: 30px; font-size: 14px; color: #9ca3af;">
            You can return to ChatGPT to browse more products or try again later.
          </p>
        </div>
      </body>
    </html>
  `;
  
  res.send(html);
});

// Bind to 0.0.0.0 for Docker/Render compatibility
const HOST = '0.0.0.0';

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

const server = app.listen(PORT, HOST, () => {
  console.log(`✓ API Server running on ${HOST}:${PORT}`);
  console.log(`✓ Health check: http://localhost:${PORT}/health`);
  console.log(`✓ JWT Secret: ${process.env.JWT_SECRET ? 'Configured ✓' : 'Using default (change in production!)'}`);
  console.log(`✓ Stripe: ${process.env.STRIPE_SECRET_KEY ? 'Configured ✓' : 'Mock mode (add STRIPE_SECRET_KEY to .env)'}`);
  console.log(`✓ Etsy API: ${process.env.ETSY_API_KEY ? 'Configured ✓' : 'Mock mode (add ETSY_API_KEY to .env)'}`);
  console.log(`✓ Database: ${process.env.DATABASE_URL || './data/shopping.db'}`);
  console.log(`✓ Server ready to accept connections`);
});

server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
  } else {
    console.error('❌ Server error:', error);
  }
  process.exit(1);
});
