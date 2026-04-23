import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import path from 'path';
import { DB } from '@agentic-commerce/database';
import { PolicyService, PaymentOrchestrator } from '@agentic-commerce/core';
import { EtsyClient, PaymentService, StripeAgentService, FacilitatorService, FirecrawlService, EscrowService, EscrowProgramClient, FirecrawlX402Agent, ZyteX402Agent, ProviderRegistry, BaseTxVerifier } from '@agentic-commerce/integrations';
import { AuditService } from '@agentic-commerce/core';
import { createAgentRoutes } from './agent-routes';
import { createRegistryRoutes } from './registry-routes';
import { createFacilitatorRoutes } from './facilitator-routes';
import { createChatGPTAgentRoutes } from './chatgpt-agent-routes';
import { createChatRoutes } from './chat-routes';
import { createV1Router } from './v1-routes';
import { createApiKeyAuth } from './middleware/api-key-auth';
import { requestIdMiddleware, attachRequestId, globalErrorHandler } from './middleware/error-handler';

// Extend Express Request type to include user and org context
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email?: string;
        iat?: number;
      };
      org?: import('./middleware/api-key-auth').OrgContext;
    }
  }
}

// Load .env from the monorepo root (process.cwd() is packages/api when run via npm workspaces)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

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
const firecrawlService = new FirecrawlService();
const escrowService = new EscrowService();
const escrowProgramClient = new EscrowProgramClient();
const firecrawlX402Agent = new FirecrawlX402Agent();
const zyteX402Agent = new ZyteX402Agent();
const auditService = new AuditService();
auditService.setDB(db);

// Platform v1 services
const providerRegistry = new ProviderRegistry(db);
providerRegistry.setFirecrawlAgent(firecrawlX402Agent);
providerRegistry.setZyteAgent(zyteX402Agent);
const paymentOrchestrator = new PaymentOrchestrator(db, policyService, auditService, providerRegistry);
const baseTxVerifier = new BaseTxVerifier();
paymentOrchestrator.setBaseTxVerifier(baseTxVerifier);

// ── Security Middleware Stack ──────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));

app.use(requestIdMiddleware);
app.use(attachRequestId);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : null;

app.use(cors({
  origin: process.env.NODE_ENV === 'production' && allowedOrigins
    ? allowedOrigins
    : '*',
  credentials: allowedOrigins ? true : false,
  exposedHeaders: ['ngrok-skip-browser-warning', 'X-Request-ID', 'PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID', 'PAYMENT-SIGNATURE', 'ngrok-skip-browser-warning', 'X-Requested-With'],
}));

const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.RATE_LIMIT_GLOBAL || '200', 10),
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later' } },
});
app.use('/api/', globalLimiter);

app.use(express.json({ limit: '1mb' }));

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
  
  // DEVELOPMENT MODE: Bypass JWT authentication if DISABLE_AUTH=true (blocked in production)
  if (process.env.DISABLE_AUTH === 'true' && process.env.NODE_ENV !== 'production') {
    console.log('⚠️  AUTHENTICATION DISABLED (Development Mode)');
    console.log('Path:', req.path, 'Method:', req.method);
    
    // Extract user_email from body (POST/PUT) or query params (GET/DELETE)
    const testEmail = req.body?.user_email || req.query?.user_email || 'dev@example.com';
    
    // Look up the real dev user from database
    return (async () => {
      try {
        const user = await db.getUserByEmail(testEmail as string);
        if (user) {
          req.user = { userId: user.id, email: user.email };
          console.log('✓ Using dev user:', user.email, '(ID:', user.id, ')');
          return next();
        } else {
          console.log('⚠️  Dev user not found:', testEmail);
          console.log('💡 Available users:', await db.getAllUsers().then((users: any[]) => users.map((u: any) => u.email).join(', ')));
          return res.status(401).json({ 
            error: 'Dev user not found', 
            message: `User ${testEmail} not found. Run scripts/create-dev-user.ts to create users.` 
          });
        }
      } catch (error) {
        console.error('Error looking up dev user:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    })();
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
  
  // CHATGPT SUPPORT: Allow authentication via user_email in request body or query params
  const emailFromRequest = req.body?.user_email || req.query?.user_email;
  if (!authHeader && emailFromRequest) {
    console.log('No auth header, attempting email-based auth:', emailFromRequest);
    return (async () => {
      try {
        const user = await db.getUserByEmail(emailFromRequest as string);
        if (user) {
          req.user = { userId: user.id, email: user.email };
          console.log('Email-based auth successful for:', user.email);
          return next();
        } else {
          console.log('User not found for email:', emailFromRequest);
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

// Local web chat UI that mirrors Custom GPT action flow
app.use('/api/chat', createChatRoutes(firecrawlService, escrowService, auditService, firecrawlX402Agent, zyteX402Agent));

// x402 Agent status (both providers)
app.get('/api/agent/status', async (req, res) => {
  const firecrawlStatus = firecrawlX402Agent.getStatus();
  const zyteStatus = zyteX402Agent.getStatus();
  const balance = await zyteX402Agent.getBalance() || await firecrawlX402Agent.getBalance();
  res.json({
    firecrawl: firecrawlStatus,
    zyte: zyteStatus,
    balance,
    activeProvider: zyteStatus.ready ? 'zyte' : (firecrawlStatus.ready ? 'firecrawl' : 'none'),
  });
});

// Debug endpoint removed for security — environment info must not be exposed

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
      purpose,
      transaction_type, // NEW: Support A2M vs A2A
      service_type,
      recipient_agent_id,
      buyer_agent_id
    } = req.body;
    
    // Validate required fields
    if (price === null || price === undefined || typeof price !== 'number') {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'price is required and must be a number' 
      });
    }
    
    // ALWAYS prioritize token user ID for security (token is authenticated, body can be spoofed)
    const finalUserId = tokenUser || user_id || 'test-user-123';
    
    console.log('Policy check request:', JSON.stringify({ ...req.body, user_id: finalUserId, transaction_type }, null, 2));
    
    // READ-ONLY policy check (does NOT record attempt)
    const result = await policyService.checkPolicyOnly({
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
      transactionType: transaction_type,
      serviceType: service_type,
    });
    
    console.log('Policy check response:', JSON.stringify(result, null, 2));

    // Log event (fire-and-forget)
    db.logEvent({
      userId: finalUserId,
      eventType: result.allowed ? 'policy_evaluated' : result.requiresApproval ? 'approval_requested' : 'purchase_blocked',
      source: 'api',
      productName: product_id,
      category,
      merchant,
      amount: price,
      outcome: result.allowed ? 'approved' : result.requiresApproval ? 'pending_approval' : 'blocked',
      blockReason: result.allowed ? undefined : result.reason,
      metadata: { transaction_type, service_type, matched_policies: result.matchedPolicies?.length },
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Simulate a policy against a transaction without touching the database.
 * Accepts a full policy object + transaction details; returns evaluation result.
 */
app.post('/api/policy/simulate', authenticate, async (req, res) => {
  try {
    const {
      policy,
      transaction,
      current_spending = 0,
    } = req.body;

    if (!policy || typeof policy !== 'object') {
      return res.status(400).json({ error: 'policy object is required' });
    }
    if (!transaction || typeof transaction.price !== 'number') {
      return res.status(400).json({ error: 'transaction.price (number) is required' });
    }

    const request = {
      userId: req.user?.userId || 'simulate-user',
      productId: transaction.product_id || 'simulation',
      price: transaction.price,
      merchant: transaction.merchant || 'Unknown Merchant',
      category: transaction.category || 'General',
      transactionType: transaction.transaction_type || 'agent-to-merchant',
      agentName: transaction.agent_name,
      agentType: transaction.agent_type,
      serviceType: transaction.service_type,
      recipientAgentId: transaction.recipient_agent_id,
      buyerAgentId: transaction.buyer_agent_id,
      purpose: transaction.purpose,
      timeOfDay: transaction.time_of_day,
      dayOfWeek: transaction.day_of_week,
    };

    const result = await policyService.simulatePolicy(policy, request, current_spending);
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
    
    db.logEvent({
      userId: purchase.userId,
      eventType: 'approval_resolved',
      source: 'api',
      productName: purchase.productName,
      category: purchase.category,
      merchant: purchase.merchant,
      amount: purchase.amount,
      outcome: 'approved',
      metadata: { purchase_id: purchaseId, approved_by: req.user?.userId },
    });

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
    
    db.logEvent({
      userId: purchase.userId,
      eventType: 'approval_resolved',
      source: 'api',
      productName: purchase.productName,
      category: purchase.category,
      merchant: purchase.merchant,
      amount: purchase.amount,
      outcome: 'rejected',
      blockReason: reason || 'No reason provided',
      metadata: { purchase_id: purchaseId, rejected_by: req.user?.userId },
    });

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
    const { 
      user_id, 
      product_id, 
      amount, 
      merchant, 
      category, 
      product_name, 
      product_url, 
      product_image_url,
      transaction_type, // NEW: 'agent-to-merchant' or 'agent-to-agent'
      service_type,
      recipient_agent_id,
      buyer_agent_id
    } = req.body;

    // ALWAYS prioritize token user ID for security (token is authenticated, body can be spoofed)
    const finalUserId = tokenUser || user_id || 'test-user-123';

    // Determine transaction type (default to agent-to-merchant)
    const finalTransactionType = transaction_type || 'agent-to-merchant';

    // Check policy first (read-only check to avoid duplicate recording)
    const { agent_name, agent_type, time_of_day, day_of_week, recipient_agent, purpose } = req.body;
    const policyCheck = await policyService.checkPolicyOnly({
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
      transactionType: finalTransactionType,
      serviceType: service_type,
    });

    // Handle policy check results
    if (!policyCheck.allowed && !policyCheck.requiresApproval) {
      // Log blocked purchase
      db.logEvent({
        userId: finalUserId,
        eventType: 'purchase_blocked',
        source: 'chatgpt',
        productName: product_id,
        category,
        merchant,
        amount,
        outcome: 'blocked',
        blockReason: policyCheck.reason,
        metadata: { transaction_type: finalTransactionType, matched_policies: policyCheck.matchedPolicies?.length },
      });
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
        transactionType: finalTransactionType, // NEW: Include transaction type
        allowed: false, // Not yet approved
        requiresApproval: true,
        policyCheckResults: policyCheck.matchedPolicies.map((p: any) => ({
          ...p,
          acpCheckout: false,
        })),
      });
      console.log(`🟡 Purchase requires approval - Purchase ID: ${purchaseId}, User: ${finalUserId}, Product: ${product_id}, Amount: $${amount}`);

      db.logEvent({
        userId: finalUserId,
        eventType: 'approval_requested',
        source: 'chatgpt',
        productName: finalProductName,
        category: finalCategory || category,
        merchant: finalMerchant || merchant,
        amount,
        outcome: 'pending_approval',
        metadata: { purchase_id: purchaseId, transaction_type: finalTransactionType },
      });

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
      transactionType: finalTransactionType,
      allowed: true,
      requiresApproval: false,
      policyCheckResults: policyCheck.matchedPolicies.map((p: any) => ({
        ...p,
        acpCheckout: false, // Mark as traditional checkout
      })),
    });
    console.log(`✅ Auto-approved purchase for user ${finalUserId}, product ${product_id}, amount $${amount}`);
    db.logEvent({
      userId: finalUserId,
      eventType: 'purchase_initiated',
      source: 'chatgpt',
      productName: finalProductName,
      category: finalCategory || category,
      merchant: finalMerchant || merchant,
      amount,
      outcome: 'approved',
      metadata: { transaction_type: finalTransactionType, checkout_session: checkout.sessionId },
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
      db.logEvent({
        userId: finalUserId,
        eventType: 'purchase_completed',
        source: 'chatgpt',
        productName: product_name,
        category,
        merchant,
        amount: amount || status.amountTotal || 0,
        outcome: 'completed',
        metadata: { session_id, payment_status: status.paymentStatus },
      });
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

// ── Platform API v1 (API-key authenticated) ─────────────────────────────────
const apiKeyAuth = createApiKeyAuth(db);
const v1Router = createV1Router({ db, policyService, auditService, paymentOrchestrator, providerRegistry });
app.use('/api/v1', apiKeyAuth, v1Router);

// ── MCP Server (Streamable HTTP transport with x402 pricing) ────────────────
import { createMcpRouter } from '@agentic-commerce/mcp-server';
const mcpRouter = createMcpRouter({
  apiBaseUrl: `http://localhost:${PORT}/api/v1`,
  defaultApiKey: process.env.MCP_DEFAULT_API_KEY || 'ak_demo_live_test_key_2024',
});
app.use('/mcp', mcpRouter);
console.log(`[MCP] Server mounted at /mcp (Streamable HTTP transport with x402 pricing)`);

// ── Demo Routes (EIP-3009 signer for presentation demo) ─────────────────────
import { createDemoRoutes } from './demo-routes';
app.use('/api/demo', createDemoRoutes());
console.log(`[Demo] Routes mounted at /api/demo (sign-x402, wallet)`);

// ============================================================================
// Funding Subaccounts (treasury-style virtual balances)
// ============================================================================

app.get('/api/funding/account', authenticate, async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const account = await db.createOrGetFundingAccountForUser(userId, 'USDC');
    res.json({ account });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/funding/topup', authenticate, async (req, res) => {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ error: 'Authentication required' });

    const actor = await db.getUserById(actorUserId);
    const actorRole = (actor as any)?.role || 'user';
    if (!['admin', 'manager'].includes(actorRole)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Only admin/manager can top up funding accounts' });
    }

    const { user_id, amount, idempotency_key } = req.body;
    if (!user_id || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'user_id and positive amount are required' });
    }
    const result = await db.topUpFundingAccount({
      userId: user_id,
      amount: Number(amount),
      currency: 'USDC',
      idempotencyKey: idempotency_key,
      referenceType: 'admin-topup',
      referenceId: `topup_${Date.now()}`,
      metadata: { by: actorUserId },
    });
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Organizations + Treasury (multi-tenant)
// ============================================================================

app.post('/api/orgs', authenticate, async (req, res) => {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ error: 'Authentication required' });
    const { name, slug, metadata } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ error: 'name and slug are required' });
    }
    const org = await db.createOrganization({ name, slug, ownerUserId: actorUserId, metadata });
    await db.createOrGetOrgTreasuryAccount(org.id, 'USDC');
    res.status(201).json({ success: true, organization: org });
  } catch (error: any) {
    if (error.message?.includes('unique') || error.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Organization slug already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orgs', authenticate, async (req, res) => {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ error: 'Authentication required' });
    const organizations = await db.getUserOrganizations(actorUserId);
    res.json({ organizations });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orgs/:orgId/members', authenticate, async (req, res) => {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ error: 'Authentication required' });
    const { orgId } = req.params;
    const { user_id, role = 'member' } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const membership = await db.getOrganizationMembership(orgId, actorUserId);
    if (!membership || !['owner', 'admin'].includes(membership.role) || membership.status !== 'active') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Only owner/admin can manage members' });
    }

    await db.addOrganizationMember({ orgId, userId: user_id, role, status: 'active' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orgs/:orgId/treasury/topup', authenticate, async (req, res) => {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ error: 'Authentication required' });
    const { orgId } = req.params;
    const { amount, idempotency_key } = req.body;
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'positive amount is required' });
    }

    const membership = await db.getOrganizationMembership(orgId, actorUserId);
    if (!membership || !['owner', 'admin', 'manager'].includes(membership.role) || membership.status !== 'active') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Insufficient org role for treasury top-up' });
    }

    const result = await db.topUpOrgTreasury({
      orgId,
      amount: Number(amount),
      currency: 'USDC',
      idempotencyKey: idempotency_key,
      referenceType: 'org-topup',
      referenceId: `org_topup_${Date.now()}`,
      metadata: { by: actorUserId },
    });
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orgs/:orgId/treasury/allocate', authenticate, async (req, res) => {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ error: 'Authentication required' });
    const { orgId } = req.params;
    const { user_id, amount, idempotency_key } = req.body;
    if (!user_id || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'user_id and positive amount are required' });
    }

    const membership = await db.getOrganizationMembership(orgId, actorUserId);
    if (!membership || !['owner', 'admin', 'manager'].includes(membership.role) || membership.status !== 'active') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Insufficient org role for allocation' });
    }

    const targetMembership = await db.getOrganizationMembership(orgId, user_id);
    if (!targetMembership || targetMembership.status !== 'active') {
      return res.status(400).json({ error: 'Target user is not an active member of this organization' });
    }

    const result = await db.allocateOrgTreasuryToUserFunding({
      orgId,
      userId: user_id,
      amount: Number(amount),
      currency: 'USDC',
      idempotencyKey: idempotency_key,
      metadata: { by: actorUserId },
    });
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orgs/:orgId/treasury/wallets', authenticate, async (req, res) => {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ error: 'Authentication required' });
    const { orgId } = req.params;
    const membership = await db.getOrganizationMembership(orgId, actorUserId);
    if (!membership || membership.status !== 'active') {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const wallets = await db.listOrgTreasuryWallets(orgId);
    res.json({ success: true, wallets });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orgs/:orgId/treasury/wallets', authenticate, async (req, res) => {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ error: 'Authentication required' });
    const { orgId } = req.params;
    const membership = await db.getOrganizationMembership(orgId, actorUserId);
    if (!membership || !['owner', 'admin', 'manager'].includes(membership.role) || membership.status !== 'active') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Insufficient org role for wallet create' });
    }
    const {
      name,
      address,
      network,
      asset,
      priority,
      status,
      key_ciphertext,
      kms_key_id,
      key_version,
      routing_policy,
      metadata,
    } = req.body || {};
    if (!name || !address || !network || !asset) {
      return res.status(400).json({ error: 'name, address, network, asset are required' });
    }
    const wallet = await db.createOrgTreasuryWallet({
      orgId,
      name,
      address,
      network,
      asset,
      priority: Number.isFinite(Number(priority)) ? Number(priority) : undefined,
      status,
      keyCiphertext: key_ciphertext,
      kmsKeyId: kms_key_id,
      keyVersion: key_version,
      routingPolicy: routing_policy,
      metadata,
      createdBy: actorUserId,
    });
    res.status(201).json({ success: true, wallet });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/orgs/:orgId/treasury/wallets/:walletId', authenticate, async (req, res) => {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ error: 'Authentication required' });
    const { orgId, walletId } = req.params;
    const membership = await db.getOrganizationMembership(orgId, actorUserId);
    if (!membership || !['owner', 'admin', 'manager'].includes(membership.role) || membership.status !== 'active') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Insufficient org role for wallet update' });
    }
    const updates: any = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (req.body.priority !== undefined) updates.priority = Number(req.body.priority);
    if (req.body.key_ciphertext !== undefined) updates.keyCiphertext = req.body.key_ciphertext;
    if (req.body.kms_key_id !== undefined) updates.kmsKeyId = req.body.kms_key_id;
    if (req.body.key_version !== undefined) updates.keyVersion = req.body.key_version;
    if (req.body.routing_policy !== undefined) updates.routingPolicy = req.body.routing_policy;
    if (req.body.metadata !== undefined) updates.metadata = req.body.metadata;
    if (req.body.last_rotated_at !== undefined) updates.lastRotatedAt = new Date(req.body.last_rotated_at);
    await db.updateOrgTreasuryWallet(walletId, updates);
    const wallet = await db.getOrgTreasuryWalletById(walletId);
    res.json({ success: true, wallet });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orgs/:orgId/treasury/wallets/:walletId/admins', authenticate, async (req, res) => {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ error: 'Authentication required' });
    const { orgId, walletId } = req.params;
    const { user_id, role = 'admin', status = 'active' } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    const membership = await db.getOrganizationMembership(orgId, actorUserId);
    if (!membership || !['owner', 'admin'].includes(membership.role) || membership.status !== 'active') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Only owner/admin can map wallet admins' });
    }
    await db.addOrgTreasuryWalletAdmin({ orgId, walletId, userId: user_id, role, status });
    const admins = await db.listOrgTreasuryWalletAdmins(walletId);
    res.json({ success: true, admins });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orgs/:orgId/treasury/policy', authenticate, async (req, res) => {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ error: 'Authentication required' });
    const { orgId } = req.params;
    const membership = await db.getOrganizationMembership(orgId, actorUserId);
    if (!membership || membership.status !== 'active') return res.status(403).json({ error: 'FORBIDDEN' });
    const policy = await db.getOrgTreasuryPolicy(orgId);
    res.json({ success: true, policy });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/orgs/:orgId/treasury/policy', authenticate, async (req, res) => {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ error: 'Authentication required' });
    const { orgId } = req.params;
    const membership = await db.getOrganizationMembership(orgId, actorUserId);
    if (!membership || !['owner', 'admin', 'manager'].includes(membership.role) || membership.status !== 'active') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Insufficient org role for policy update' });
    }
    await db.upsertOrgTreasuryPolicy(orgId, {
      routingMode: req.body.routing_mode,
      allowNetworks: req.body.allow_networks,
      allowAssets: req.body.allow_assets,
      perTxnLimitAtomic: req.body.per_txn_limit_atomic,
      dailyLimitAtomic: req.body.daily_limit_atomic,
      requireManualApprovalOverAtomic: req.body.require_manual_approval_over_atomic,
      metadata: req.body.metadata,
    });
    const policy = await db.getOrgTreasuryPolicy(orgId);
    res.json({ success: true, policy });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orgs/:orgId/treasury/sign-requests', authenticate, async (req, res) => {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ error: 'Authentication required' });
    const { orgId } = req.params;
    const membership = await db.getOrganizationMembership(orgId, actorUserId);
    if (!membership || !['owner', 'admin', 'manager'].includes(membership.role) || membership.status !== 'active') {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const signRequests = await db.listTreasurySignRequests({
      orgId,
      status: req.query.status as string | undefined,
      limit: Number(req.query.limit) || 100,
    });
    res.json({ success: true, signRequests });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orgs/:orgId/treasury/reconcile', authenticate, async (req, res) => {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ error: 'Authentication required' });
    const { orgId } = req.params;
    const membership = await db.getOrganizationMembership(orgId, actorUserId);
    if (!membership || !['owner', 'admin'].includes(membership.role) || membership.status !== 'active') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Only owner/admin can run reconciliation' });
    }
    const recent = await db.listTreasurySignRequests({ orgId, limit: 200 });
    const stats = recent.reduce(
      (acc: any, r: any) => {
        acc.total += 1;
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      },
      { total: 0 }
    );
    res.json({
      success: true,
      reconciliation: {
        orgId,
        scanned: stats.total,
        statusCounts: stats,
        note: 'Scaffold reconciliation complete; hook on-chain tx verification in next phase.',
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

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
    const [daily, weekly, monthly, spendingByType] = await Promise.all([
      db.getUserSpending(finalUserId, 'daily'),
      db.getUserSpending(finalUserId, 'weekly'),
      db.getUserSpending(finalUserId, 'monthly'),
      db.getSpendingByTransactionType(finalUserId, 'monthly'), // Get A2M vs A2A breakdown
    ]);
    
    // Get policies
    const policies = await db.getUserPolicies(finalUserId);
    
    // Get recent purchases
    const purchases = await db.getPurchaseHistory(finalUserId, 10);
    
    // Get pending approvals
    const pendingApprovals = await db.getPendingApprovals(finalUserId);
    
    // Get policy compliance stats
    const complianceStats = await db.getPolicyComplianceStats(finalUserId);
    
    // Get spending by category (for Sankey diagram)
    const categorySpending = await db.getSpendingByCategory(finalUserId, 'monthly');
    
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
      spendingByType: {
        agentToMerchant: spendingByType.agentToMerchant,
        agentToAgent: spendingByType.agentToAgent,
        total: spendingByType.total
      },
      spendingByCategory: categorySpending,
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

// Get agent policy assignments
app.get('/api/agents/:agentId/policies', authenticate, async (req, res) => {
  try {
    const { agentId } = req.params;
    const agent = await db.getRegisteredAgent(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const policies = await db.getAgentPolicies(agentId);
    res.json({
      agent: {
        agentId: agent.agentId,
        name: agent.name,
        active: agent.active,
        verified: agent.verified,
      },
      policies,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Assign policy to agent
app.post('/api/agents/:agentId/policies/:policyId', authenticate, async (req, res) => {
  try {
    const { agentId, policyId } = req.params;

    const agent = await db.getRegisteredAgent(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const policy = await db.getPolicyById(policyId);
    if (!policy) {
      return res.status(404).json({ error: 'Policy not found' });
    }

    await db.assignPolicyToAgent(agentId, policyId);
    res.json({ message: 'Policy assigned to agent successfully' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Policy already assigned to agent' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Remove policy from agent
app.delete('/api/agents/:agentId/policies/:policyId', authenticate, async (req, res) => {
  try {
    const { agentId, policyId } = req.params;
    await db.removePolicyFromAgent(agentId, policyId);
    res.json({ message: 'Policy removed from agent successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// URI-safe variants for agent IDs like "agent://..."
app.get('/api/agents/policies', authenticate, async (req, res) => {
  try {
    const agentId = String(req.query.agent_id || '').trim();
    if (!agentId) return res.status(400).json({ error: 'agent_id is required' });
    const agent = await db.getRegisteredAgent(agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const policies = await db.getAgentPolicies(agentId);
    res.json({
      agent: {
        agentId: agent.agentId,
        name: agent.name,
        active: agent.active,
        verified: agent.verified,
      },
      policies,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/agents/policies/assign', authenticate, async (req, res) => {
  try {
    const agentId = String(req.body?.agent_id || '').trim();
    const policyId = String(req.body?.policy_id || '').trim();
    if (!agentId || !policyId) {
      return res.status(400).json({ error: 'agent_id and policy_id are required' });
    }
    const agent = await db.getRegisteredAgent(agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const policy = await db.getPolicyById(policyId);
    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    await db.assignPolicyToAgent(agentId, policyId);
    res.json({ message: 'Policy assigned to agent successfully' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Policy already assigned to agent' });
    }
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/agents/policies/assign', authenticate, async (req, res) => {
  try {
    const agentId = String(req.body?.agent_id || req.query?.agent_id || '').trim();
    const policyId = String(req.body?.policy_id || req.query?.policy_id || '').trim();
    if (!agentId || !policyId) {
      return res.status(400).json({ error: 'agent_id and policy_id are required' });
    }
    await db.removePolicyFromAgent(agentId, policyId);
    res.json({ message: 'Policy removed from agent successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Approval Reviewer Management
// ============================================================================

// Get all approval reviewers
app.get('/api/reviewers', authenticate, async (req, res) => {
  try {
    const reviewers = await db.getApprovalReviewers();
    res.json({ reviewers });
  } catch (error: any) {
    console.error('Get reviewers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add approval reviewer
app.post('/api/reviewers', authenticate, async (req, res) => {
  try {
    const { user_id, role = 'reviewer' } = req.body;
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    
    const user = await db.getUserById(user_id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    await db.addApprovalReviewer(user_id, role);
    res.json({ message: 'Reviewer added successfully' });
  } catch (error: any) {
    console.error('Add reviewer error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update reviewer role
app.put('/api/reviewers/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    
    if (!role) {
      return res.status(400).json({ error: 'role is required' });
    }
    
    await db.updateReviewerRole(userId, role);
    res.json({ message: 'Reviewer role updated successfully' });
  } catch (error: any) {
    console.error('Update reviewer error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove approval reviewer
app.delete('/api/reviewers/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    
    await db.removeApprovalReviewer(userId);
    res.json({ message: 'Reviewer removed successfully' });
  } catch (error: any) {
    console.error('Remove reviewer error:', error);
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
    const { email, name, role } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required',
      });
    }

    // Create or get user in database
    const user = await db.createOrGetUser(email, name);
    
    // Set user role (default to 'admin' for policy manager access)
    const userRole = role || 'admin';
    
    // Check if user already has a role
    const existingUser = await db.getUserByEmail(email);
    const hasRole = existingUser && (existingUser as any).role && (existingUser as any).role !== 'user';
    
    // Only update role if user doesn't have one or if explicitly provided
    if (!hasRole || role) {
      await db.addApprovalReviewer(user.id, userRole);
      console.log(`✅ User ${email} assigned role: ${userRole}`);
    }

    // Get updated user with role
    const updatedUser = await db.getUserByEmail(email);

    // Assign all active policies to new users
    try {
      const { rows: allPolicies } = await db.pool.query('SELECT id FROM policies WHERE enabled = true');
      console.log(`📋 Assigning ${allPolicies.length} policies to user ${user.email}`);
      for (const policy of allPolicies) {
        await db.assignPolicyToUser(user.id, policy.id);
      }
      console.log(`✅ Assigned policies to ${user.email}`);
    } catch (policyError: any) {
      console.error('⚠️  Failed to assign policies:', policyError.message);
    }

    // Create / restore multi-chain wallet for the user.
    // Primary key: EVM (secp256k1) — used for x402 on Base / EVM networks.
    // Also generates a Solana keypair so the user can later settle on Solana.
    let walletInfo: {
      evmAddress: string;
      solanaPublicKey?: string;
      networks: string[];
    } | null = null;
    try {
      let walletData = await db.getUserWallet(user.id);

      if (!walletData) {
        // EVM keypair via viem
        const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
        const evmPrivateKey = generatePrivateKey();
        const evmAccount = privateKeyToAccount(evmPrivateKey);

        // Solana keypair (for future Solana x402 settlement)
        let solanaPublicKey: string | undefined;
        let solanaSecretKey: number[] | undefined;
        try {
          const { Keypair } = await import('@solana/web3.js');
          const solKeypair = Keypair.generate();
          solanaPublicKey = solKeypair.publicKey.toBase58();
          solanaSecretKey = Array.from(solKeypair.secretKey);
        } catch {
          // Solana optional — don't block on failure
        }

        walletData = {
          userId: user.id,
          evmAddress: evmAccount.address,
          evmPrivateKey,
          solanaPublicKey,
          solanaSecretKey,
        };
        await db.saveUserWallet(walletData);
        console.log(`💼 Created EVM wallet for ${user.email}: ${evmAccount.address}${solanaPublicKey ? ` + Solana: ${solanaPublicKey}` : ''}`);
      } else {
        console.log(`💼 Wallet already exists for ${user.email}: ${walletData.evmAddress}`);
      }

      walletInfo = {
        evmAddress: walletData.evmAddress,
        solanaPublicKey: walletData.solanaPublicKey,
        networks: [
          'eip155:8453',   // Base
          'eip155:1',      // Ethereum
          'eip155:137',    // Polygon
          'eip155:42161',  // Arbitrum
          ...(walletData.solanaPublicKey ? ['solana:mainnet-beta'] : []),
        ],
      };
    } catch (walletError: any) {
      console.error('⚠️  Failed to create wallet:', (walletError as Error).message);
      // Don't fail user creation if wallet creation fails
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        wallet: walletInfo,
        role: (updatedUser as any)?.role || userRole,
      },
      message: 'User created/retrieved successfully',
    });
  } catch (error: any) {
    console.error('Create user error:', error);
    res.status(500).json({
      error: 'Failed to create user',
      details: error.message,
    });
  }
});

// OTP: request a verification code (no auth required)
app.post('/api/auth/request-otp', async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const normalizedEmail = email.trim().toLowerCase();

    // Ensure user exists
    const namePart = name || normalizedEmail.split('@')[0];
    const userName = namePart.charAt(0).toUpperCase() + namePart.slice(1).replace(/[._-]/g, ' ');
    await db.createOrGetUser(normalizedEmail, userName);

    // Generate 6-digit OTP and store in DB
    const { randomInt } = await import('crypto');
    const otp = randomInt(100000, 999999).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    await db.setVerificationCode(normalizedEmail, otp, expires);

    console.log(`[OTP] Generated for ${normalizedEmail}: ${otp}`);

    // Return OTP so the calling server (frontend) can email it to the user.
    // This endpoint should only be called server-to-server, never from the browser.
    res.json({ success: true, message: 'Verification code generated', email: normalizedEmail, otp });
  } catch (error: any) {
    console.error('Request OTP error:', error);
    res.status(500).json({ error: 'Failed to generate verification code', details: error.message });
  }
});

// OTP: verify the code and return user info (no auth required)
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and verification code are required' });

    const normalizedEmail = email.trim().toLowerCase();
    const result = await db.verifyAndClearCode(normalizedEmail, otp.trim());

    if (!result.valid) {
      return res.status(400).json({ error: result.reason });
    }

    const user = await db.getUserByEmail(normalizedEmail);
    if (!user) return res.status(400).json({ error: 'User not found' });

    res.json({
      success: true,
      user: { id: user.id, email: user.email, name: (user as any).name },
    });
  } catch (error: any) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ error: 'Verification failed', details: error.message });
  }
});

// Admin endpoint to initialize/re-run database setup
app.post('/api/admin/db-setup', async (req, res) => {
  try {
    console.log('🔧 Running database setup...');
    const { execSync } = require('child_process');
    
    // Run setup.ts directly with tsx - use absolute path from workspace root
    const path = require('path');
    // process.cwd() is /app/packages/api in production, so go up to /app
    const workspaceRoot = path.resolve(process.cwd(), '../..');
    const setupPath = path.join(workspaceRoot, 'packages/database/src/setup.ts');
    console.log('CWD:', process.cwd());
    console.log('Workspace root:', workspaceRoot);
    console.log('Setup path:', setupPath);
    
    const output = execSync(`npx tsx ${setupPath}`, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || '/app/data/shopping.db' }
    });
    
    console.log('✅ Database setup complete');
    console.log('Setup output:', output);
    
    // Verify policies were created
    const { rows: allPolicies } = await db.pool.query('SELECT id, name FROM policies WHERE enabled = true');
    console.log(`Found ${allPolicies.length} policies`);

    // Assign policies to all existing users
    const { rows: allUsers } = await db.pool.query('SELECT id, email FROM users');
    console.log(`Assigning to ${allUsers.length} users`);

    for (const user of allUsers) {
      for (const policy of allPolicies) {
        await db.assignPolicyToUser(user.id, policy.id);
      }
    }
    
    res.json({
      success: true,
      message: 'Database setup completed successfully',
      policiesCreated: allPolicies.length,
      usersWithPolicies: allUsers.length,
      setupOutput: output.substring(0, 1000)
    });
  } catch (error: any) {
    console.error('DB setup error:', error);
    res.status(500).json({
      error: 'Database setup failed',
      details: error.message,
      stack: error.stack
    });
  }
});

// Admin endpoint to assign policies to existing users
app.post('/api/admin/assign-policies', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      // Assign to all users
      const { rows: allUsers } = await db.pool.query('SELECT id, email FROM users');
      const { rows: allPolicies } = await db.pool.query('SELECT id FROM policies WHERE enabled = true');

      console.log(`📋 Assigning ${allPolicies.length} policies to ${allUsers.length} users`);

      let assignedCount = 0;
      for (const user of allUsers) {
        for (const policy of allPolicies) {
          await db.assignPolicyToUser(user.id, policy.id);
          assignedCount++;
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
    const { rows: allPolicies } = await db.pool.query('SELECT id FROM policies WHERE enabled = true');
    console.log(`📋 Assigning ${allPolicies.length} policies to user ${userId}`);
    for (const policy of allPolicies) {
      await db.assignPolicyToUser(userId, policy.id);
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

// ============================================================================
// Firecrawl Web Scraping Endpoints
// ============================================================================

app.post('/api/firecrawl/scrape', authenticate, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const result = await firecrawlService.scrapeUrl(url);

    auditService.log({
      eventType: 'firecrawl.scrape',
      actor: req.user?.userId || 'unknown',
      actorType: 'user',
      resource: 'firecrawl',
      resourceId: url,
      action: 'scrape',
      outcome: 'success',
      details: { url, title: result.title, contentLength: result.markdown.length },
    });

    res.json({ success: true, result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/firecrawl/interact', authenticate, async (req, res) => {
  try {
    const { scrape_id, prompt, code, language, timeout } = req.body;
    if (!scrape_id) return res.status(400).json({ error: 'scrape_id is required' });
    if (!prompt && !code) return res.status(400).json({ error: 'prompt or code is required' });

    const result = await firecrawlService.interact(scrape_id, { prompt, code, language, timeout });

    auditService.log({
      eventType: 'firecrawl.scrape',
      actor: req.user?.userId || 'unknown',
      actorType: 'user',
      resource: 'firecrawl-interact',
      resourceId: scrape_id,
      action: 'interact',
      outcome: result.success ? 'success' : 'failure',
      details: { scrapeId: scrape_id, prompt: prompt?.substring(0, 200), hasLiveView: !!result.liveViewUrl },
    });

    res.json({ success: true, result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/firecrawl/session/:scrapeId', authenticate, async (req, res) => {
  try {
    const { scrapeId } = req.params;
    const result = await firecrawlService.stopSession(scrapeId);

    auditService.log({
      eventType: 'firecrawl.scrape',
      actor: req.user?.userId || 'unknown',
      actorType: 'user',
      resource: 'firecrawl-session',
      resourceId: scrapeId,
      action: 'stop_session',
      outcome: result.success ? 'success' : 'failure',
      details: { scrapeId },
    });

    res.json({ ...result, stopped: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/firecrawl/sessions', authenticate, async (req, res) => {
  try {
    const sessions = firecrawlService.listActiveSessions();
    res.json({ sessions, count: sessions.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/firecrawl/search', authenticate, async (req, res) => {
  try {
    const { query, limit } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });

    const result = await firecrawlService.search(query, { limit });

    auditService.log({
      eventType: 'firecrawl.search',
      actor: req.user?.userId || 'unknown',
      actorType: 'user',
      resource: 'firecrawl',
      action: 'search',
      outcome: 'success',
      details: { query, resultCount: result.results.length },
    });

    res.json({ success: true, result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Escrow Settlement Endpoints
// ============================================================================

app.post('/api/escrow/create', authenticate, async (req, res) => {
  try {
    const { payer_wallet, payee_wallet, amount, currency, service_type, description, ttl_minutes, metadata } = req.body;

    if (!payer_wallet || !payee_wallet || !amount || !service_type) {
      return res.status(400).json({ error: 'payer_wallet, payee_wallet, amount, and service_type are required' });
    }

    const userId = req.user?.userId || 'unknown';
    const policyCheck = await policyService.checkPolicyOnly({
      userId,
      productId: `escrow-${service_type}`,
      price: amount,
      merchant: payee_wallet,
      category: service_type,
      transactionType: 'agent-to-agent',
      serviceType: service_type,
    });

    const correlationId = `txn_${Date.now()}`;

    auditService.log({
      eventType: 'policy.checked',
      actor: userId,
      actorType: 'user',
      resource: 'policy',
      action: 'check_for_escrow',
      outcome: policyCheck.allowed ? 'success' : 'failure',
      details: { amount, serviceType: service_type, policyResult: policyCheck },
      correlationId,
    });

    if (!policyCheck.allowed && !policyCheck.requiresApproval) {
      return res.status(403).json({
        error: 'Escrow creation blocked by policy',
        reason: policyCheck.reason,
        matchedPolicies: policyCheck.matchedPolicies,
      });
    }

    const escrow = await escrowService.createEscrow({
      payerWallet: payer_wallet,
      payeeWallet: payee_wallet,
      amount,
      currency,
      serviceType: service_type,
      description: description || `Escrow for ${service_type}`,
      policyCheckPassed: policyCheck.allowed || !!policyCheck.requiresApproval,
      policyDetails: { matchedPolicies: policyCheck.matchedPolicies, requiresApproval: policyCheck.requiresApproval },
      ttlMinutes: ttl_minutes,
      metadata,
    });

    auditService.log({
      eventType: 'escrow.created',
      actor: userId,
      actorType: 'user',
      resource: 'escrow',
      resourceId: escrow.id,
      action: 'create',
      outcome: 'success',
      details: {
        amount, currency: escrow.currency, serviceType: service_type,
        payerWallet: payer_wallet, payeeWallet: payee_wallet,
        programId: escrowProgramClient.getProgramId(),
      },
      correlationId,
    });

    // Check if payer_wallet is a valid Solana address for on-chain flow
    const { PublicKey: SolPublicKey } = require('@solana/web3.js');
    const isValidSolAddress = (addr: string) => {
      try { new SolPublicKey(addr); return true; } catch { return false; }
    };
    const onChainReady = payer_wallet && isValidSolAddress(payer_wallet);

    res.status(201).json({
      success: true,
      escrow,
      escrow_id: escrow.id,
      escrow_pda: escrow.id,
      amount: escrow.amount,
      // UI will call /api/escrow/build-init-tx to get a fresh tx right before signing
      needs_signing: onChainReady,
      payer_wallet: onChainReady ? payer_wallet : null,
      payee_wallet: onChainReady ? (isValidSolAddress(payee_wallet) ? payee_wallet : payer_wallet) : null,
      correlationId,
      programId: escrowProgramClient.getProgramId(),
      explorerUrl: escrowProgramClient.getAddressExplorerUrl(escrowProgramClient.getProgramId()),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Builds a fresh initializeEscrow transaction with a current blockhash.
// Called by the UI right before presenting the Phantom popup to avoid blockhash expiry.
app.post('/api/escrow/build-init-tx', authenticate, async (req, res) => {
  try {
    const { payer_wallet, payee_wallet, amount } = req.body;
    if (!payer_wallet || !amount) {
      return res.status(400).json({ error: 'payer_wallet and amount required' });
    }
    const { PublicKey: SolPublicKey, Keypair: SolKeypair } = require('@solana/web3.js');
    const payerPk = new SolPublicKey(payer_wallet);
    const payeePk = payee_wallet ? new SolPublicKey(payee_wallet) : payerPk;

    const initResult = await escrowProgramClient.initializeEscrow(
      {
        payerWallet: payerPk,
        payeeWallet: payeePk,
        authorityWallet: payerPk,
        amountUsdc: amount,
        expiresInMinutes: 60,
      },
      SolKeypair.generate(),
    );

    console.log(`[build-init-tx] Fresh tx for PDA ${initResult.escrowPda}`);
    res.json({
      transaction: initResult.transaction,
      escrowPda: initResult.escrowPda,
      amount: initResult.amount,
    });
  } catch (error: any) {
    console.error('[build-init-tx] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/escrow/:id/fund', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { transaction_hash } = req.body;
    const escrow = await escrowService.fundEscrow(id, transaction_hash);

    auditService.log({
      eventType: 'escrow.funded',
      actor: req.user?.userId || 'unknown',
      actorType: 'user',
      resource: 'escrow',
      resourceId: id,
      action: 'fund',
      outcome: 'success',
      details: { amount: escrow.amount, transactionHash: transaction_hash },
    });

    res.json({ success: true, escrow });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/escrow/:id/release', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const settlement = await escrowService.releaseEscrow(id);

    auditService.log({
      eventType: 'escrow.released',
      actor: req.user?.userId || 'unknown',
      actorType: 'user',
      resource: 'escrow',
      resourceId: id,
      action: 'release',
      outcome: 'success',
      details: { amount: settlement.amount, payeeWallet: settlement.payeeWallet },
    });

    res.json({ success: true, settlement });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/escrow/:id/refund', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const settlement = await escrowService.refundEscrow(id, reason);

    auditService.log({
      eventType: 'escrow.refunded',
      actor: req.user?.userId || 'unknown',
      actorType: 'user',
      resource: 'escrow',
      resourceId: id,
      action: 'refund',
      outcome: 'success',
      details: { amount: settlement.amount, reason },
    });

    res.json({ success: true, settlement });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/escrow/:id', authenticate, async (req, res) => {
  try {
    const escrow = await escrowService.getEscrow(req.params.id);
    if (!escrow) return res.status(404).json({ error: 'Escrow not found' });
    res.json({ escrow });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/escrows', authenticate, async (req, res) => {
  try {
    const { status, payer_wallet, payee_wallet, limit } = req.query;
    const escrows = await escrowService.listEscrows({
      status: status as any,
      payerWallet: payer_wallet as string,
      payeeWallet: payee_wallet as string,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json({ escrows, count: escrows.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/escrow/stats/summary', authenticate, async (req, res) => {
  try {
    const stats = await escrowService.getEscrowStats();
    res.json({ stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/settlements', authenticate, async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const settlements = await escrowService.getSettlementHistory(limit);
    res.json({ settlements, count: settlements.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Wallet & On-Chain Escrow Endpoints
// ============================================================================

app.get('/api/wallet/balance', async (req, res) => {
  try {
    const address = req.query.address as string;
    if (!address) return res.status(400).json({ error: 'address required' });

    const { Connection, PublicKey } = await import('@solana/web3.js');
    const { getAssociatedTokenAddress } = await import('@solana/spl-token');
    const rpcUrl = process.env.SOLANA_RPC_MAINNET || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    const usdcMint = new PublicKey(process.env.USDC_MINT_MAINNET || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    const wallet = new PublicKey(address);

    let solBalance = 0;
    let usdcBalance = 0;
    try {
      solBalance = (await connection.getBalance(wallet)) / 1e9;
    } catch {}
    try {
      const ata = await getAssociatedTokenAddress(usdcMint, wallet);
      const tokenInfo = await connection.getTokenAccountBalance(ata);
      usdcBalance = Number(tokenInfo.value.uiAmount || 0);
    } catch {}

    res.json({ address, solBalance, usdcBalance });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/escrow/build-deposit', authenticate, async (req, res) => {
  try {
    const { escrow_pda, payer_wallet } = req.body;
    if (!escrow_pda || !payer_wallet) {
      return res.status(400).json({ error: 'escrow_pda and payer_wallet required' });
    }
    const result = await escrowProgramClient.buildDepositTransaction(escrow_pda, payer_wallet);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/escrow/confirm-deposit', authenticate, async (req, res) => {
  try {
    const { escrow_id, tx_signature, user_email } = req.body;
    if (!tx_signature) {
      return res.status(400).json({ error: 'tx_signature required' });
    }

    const explorerUrl = escrowProgramClient.getExplorerUrl(tx_signature);

    auditService.log({
      eventType: 'escrow.deposit.confirmed',
      actor: user_email || 'unknown',
      actorType: 'user',
      resource: escrow_id || tx_signature,
      action: 'confirm_deposit',
      outcome: 'success',
      details: { tx_signature, explorerUrl },
    });

    res.json({
      verified: true,
      tx_signature,
      explorerUrl,
      receiptHash: tx_signature.slice(0, 32),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message, verified: false });
  }
});

app.get('/api/escrow/:id/on-chain', authenticate, async (req, res) => {
  try {
    const state = await escrowProgramClient.getEscrowState(req.params.id);
    if (!state) return res.status(404).json({ error: 'Escrow not found on-chain' });
    res.json({
      ...state,
      explorerUrl: escrowProgramClient.getAddressExplorerUrl(req.params.id),
      programId: escrowProgramClient.getProgramId(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Audit Trail Endpoints
// ============================================================================

app.get('/api/audit', authenticate, async (req, res) => {
  try {
    const { event_type, actor, resource, outcome, since, until, limit, offset, correlation_id } = req.query;
    const result = await auditService.query({
      eventType: event_type as any,
      actor: actor as string,
      resource: resource as string,
      outcome: outcome as string,
      since: since as string,
      until: until as string,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
      correlationId: correlation_id as string,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/audit/stats', authenticate, async (req, res) => {
  try {
    const stats = await auditService.getStats();
    res.json({ stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/audit/trace/:correlationId', authenticate, async (req, res) => {
  try {
    const trace = await auditService.getTransactionTrace(req.params.correlationId);
    res.json({ correlationId: req.params.correlationId, trace, count: trace.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/audit/:id', authenticate, async (req, res) => {
  try {
    const entry = await auditService.getEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Audit entry not found' });
    res.json({ entry });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// User Activity & Profile Endpoints
// ============================================================================

app.get('/api/user/activity', authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const limit  = parseInt(req.query.limit as string) || 100;
    const type   = req.query.event_type as string | undefined;
    const since  = req.query.since as string | undefined;
    const events = await db.getUserEvents(userId, { limit, eventType: type, since });
    res.json({ userId, events, count: events.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/user/profile', authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    let profile = await db.getUserProfile(userId);

    if (!profile) {
      await db.synthesizeUserProfile(userId);
      profile = await db.getUserProfile(userId);
    }

    const user = await db.getUserByEmail((req.user as any).email || '');
    res.json({ userId, profile, user: user ? { id: user.id, email: user.email, name: (user as any).name } : null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/user/synthesize-profile', authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    await db.synthesizeUserProfile(userId);
    res.json({ success: true, profile: await db.getUserProfile(userId) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: all events across all users (for analytics dashboards)
app.get('/api/admin/events', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 500;
    const since = req.query.since as string | undefined;
    const events = await db.getAllUserEvents({ limit, since });
    res.json({ events, count: events.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Nightly profile aggregation (runs every 24h, synthesizes all active users) ──
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
setInterval(async () => {
  try {
    console.log('🔄 Running nightly user profile synthesis...');
    const users = await db.getAllUsers();
    for (const user of users) {
      await db.synthesizeUserProfile(user.id);
    }
    console.log(`✅ Profile synthesis complete for ${users.length} users`);
  } catch (err: any) {
    console.error('⚠️  Profile synthesis failed:', err.message);
  }
}, TWENTY_FOUR_HOURS);

// Global error handler — must be after ALL route registrations
app.use(globalErrorHandler);

// Bind to 0.0.0.0 for Docker/Render compatibility
const HOST = '0.0.0.0';

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

const server = app.listen(PORT, HOST, () => {
  console.log(`✓ API Server running on ${HOST}:${PORT}`);
  console.log(`✓ Health check: http://localhost:${PORT}/health`);
  console.log(`✓ JWT Secret: ${process.env.JWT_SECRET ? 'Configured ✓' : 'Using default (change in production!)'}`);
  console.log(`✓ Stripe: ${process.env.STRIPE_SECRET_KEY ? 'Configured ✓' : 'Mock mode (add STRIPE_SECRET_KEY to .env)'}`);
  console.log(`✓ Etsy API: ${process.env.ETSY_API_KEY ? 'Configured ✓' : 'Mock mode (add ETSY_API_KEY to .env)'}`);
  console.log(`✓ Database: ${process.env.DATABASE_URL || './data/shopping.db'}`);
  console.log(`✓ Platform API v1: http://localhost:${PORT}/api/v1/health`);
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
