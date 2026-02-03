import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { DB } from '@agentic-commerce/database';
import { PolicyService } from '@agentic-commerce/core';
import { EtsyClient, PaymentService, StripeAgentService } from '@agentic-commerce/integrations';

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
    
    const results: any = {
      duplicatesFound: [],
      usersDeleted: [],
      policiesMigrated: 0,
      purchasesMigrated: 0,
      errors: []
    };

    // Find duplicate emails using raw SQL
    const duplicateEmails = db.db.prepare(`
      SELECT email, COUNT(*) as count, GROUP_CONCAT(id) as user_ids
      FROM users
      GROUP BY email
      HAVING count > 1
    `).all() as Array<{ email: string; count: number; user_ids: string }>;

    if (duplicateEmails.length === 0) {
      return res.json({
        success: true,
        message: 'No duplicate users found',
        results
      });
    }

    console.log(`Found ${duplicateEmails.length} emails with duplicates`);

    for (const dup of duplicateEmails) {
      const userIds = dup.user_ids.split(',');
      results.duplicatesFound.push({ email: dup.email, userIds });
      
      // Get all users with this email, sorted by creation date
      const users = db.db.prepare('SELECT * FROM users WHERE email = ? ORDER BY created_at ASC').all(dup.email) as any[];
      
      if (users.length < 2) continue;
      
      const keepUser = users[0]; // Keep oldest user
      const deleteUsers = users.slice(1);
      
      console.log(`Keeping user ${keepUser.id}, deleting ${deleteUsers.length} duplicates`);

      for (const delUser of deleteUsers) {
        // Migrate policies
        const policies = db.db.prepare('SELECT * FROM user_policies WHERE user_id = ?').all(delUser.id) as any[];
        
        for (const policy of policies) {
          try {
            // Check if kept user already has this policy
            const existing = db.db.prepare(
              'SELECT * FROM user_policies WHERE user_id = ? AND policy_id = ?'
            ).get(keepUser.id, policy.policy_id);
            
            if (!existing) {
              db.db.prepare('UPDATE user_policies SET user_id = ? WHERE id = ?').run(keepUser.id, policy.id);
              results.policiesMigrated++;
            } else {
              db.db.prepare('DELETE FROM user_policies WHERE id = ?').run(policy.id);
            }
          } catch (error: any) {
            results.errors.push(`Policy migration error: ${error.message}`);
          }
        }
        
        // Migrate purchase attempts
        const purchaseCount = db.db.prepare('SELECT COUNT(*) as count FROM purchase_attempts WHERE user_id = ?').get(delUser.id) as { count: number };
        if (purchaseCount.count > 0) {
          db.db.prepare('UPDATE purchase_attempts SET user_id = ? WHERE user_id = ?').run(keepUser.id, delUser.id);
          results.purchasesMigrated += purchaseCount.count;
        }
        
        // Delete duplicate user
        db.db.prepare('DELETE FROM users WHERE id = ?').run(delUser.id);
        results.usersDeleted.push(delUser.id);
        console.log(`Deleted user ${delUser.id}`);
      }
    }

    console.log('✅ Cleanup complete');
    
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

    await db.approvePurchase(purchaseId);
    
    res.json({ 
      success: true,
      message: 'Purchase approved successfully',
      purchaseId 
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

    const { reason } = req.body;
    await db.rejectPurchase(purchaseId, reason);
    
    res.json({ 
      success: true,
      message: 'Purchase rejected successfully',
      purchaseId 
    });
  } catch (error: any) {
    console.error('Reject purchase error:', error);
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

    if (!policyCheck.allowed) {
      return res.status(403).json({
        error: 'Purchase not allowed',
        reason: policyCheck.reason,
        matchedPolicies: policyCheck.matchedPolicies,
      });
    }

    // Get product details to include image URL if not provided
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
        console.log('Could not fetch product details for image URL:', error);
      }
    }

    // Create Stripe checkout session
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
    console.log('Checkout response:', JSON.stringify(checkout, null, 2));

    // Record purchase attempt (traditional checkout, not ACP)
    await db.recordPurchaseAttempt({
      userId: finalUserId,
      productId: product_id,
      productName: product_name,
      amount,
      merchant,
      category,
      allowed: true,
      requiresApproval: policyCheck.requiresApproval || false,
      policyCheckResults: policyCheck.matchedPolicies.map((p: any) => ({
        ...p,
        acpCheckout: false, // Mark as traditional checkout
      })),
    });
    console.log(`Recorded purchase attempt for user ${finalUserId}, product ${product_id}, amount $${amount}`);

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
