export interface Product {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  merchant: string;
  merchantId: string;
  url: string;
  imageUrl: string;
  category: string;
  inStock: boolean;
}

export type TransactionType = 'agent-to-merchant' | 'agent-to-agent' | 'all';

export interface Policy {
  id: string;
  name: string;
  type: 'budget' | 'transaction' | 'merchant' | 'category' | 'time' | 'agent' | 'purpose' | 'composite';
  enabled: boolean;
  priority: number;
  // NEW: Transaction type scoping - which transaction types this policy applies to
  transactionTypes?: TransactionType[];
  conditions: {
    users?: string[];
    departments?: string[];
    timeRange?: { start: string; end: string };
    transactionType?: TransactionType[];
  };
  rules: {
    maxAmount?: number;
    period?: 'daily' | 'weekly' | 'monthly';
    maxTransactionAmount?: number;
    allowedMerchants?: string[];
    blockedMerchants?: string[];
    allowedCategories?: string[];
    blockedCategories?: string[];
    // Time-based rules
    allowedTimeRanges?: Array<{ start: string; end: string }>; // HH:MM format
    allowedDaysOfWeek?: number[]; // 0-6, Sunday = 0
    // Agent-based rules
    allowedAgentNames?: string[];
    blockedAgentNames?: string[];
    allowedAgentTypes?: string[];
    blockedAgentTypes?: string[];
    allowedRecipientAgents?: string[];
    blockedRecipientAgents?: string[];
    // Purpose-based rules
    allowedPurposes?: string[];
    blockedPurposes?: string[];
    // Composite conditions (stored as JSON for complex rules)
    compositeConditions?: Array<{
      field: string;
      operator: string;
      value: string | number;
    }>;
    // Fallback action when no conditions match
    fallbackAction?: 'approve' | 'deny' | 'flag_review' | 'require_approval';
  };
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  requiresApproval?: boolean;
  flaggedForReview?: boolean;
  matchedPolicies: {
    id: string;
    name: string;
    passed: boolean;
    reason?: string;
  }[];
}

export interface PurchaseRequest {
  userId: string;
  productId: string;
  price: number;
  merchant: string;
  category?: string;
  // NEW: Transaction type
  transactionType?: TransactionType;
  // Additional fields for policy conditions
  agentName?: string;
  agentType?: string;
  timeOfDay?: string; // HH:MM format
  dayOfWeek?: number; // 0-6, Sunday = 0
  recipientAgent?: string;
  purpose?: string;
  // NEW: Agent-to-agent specific fields
  buyerAgentId?: string;
  recipientAgentId?: string;
  serviceType?: string;
}

// NEW: Agent Registry Types
export interface RegisteredAgent {
  id: string;
  agentId: string; // e.g., "agent://seller.scraper/v1"
  name: string;
  baseUrl: string;
  services: string[];
  serviceDescription?: string;
  acceptedCurrencies: string[];
  usdcTokenAccount?: string;
  solanaPubkey?: string;
  active: boolean;
  verified: boolean;
  ownerId: string;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

// NEW: x402 Protocol Types
export interface X402Requirement {
  protocol: 'x402';
  version: 'v2';
  scheme: 'exact';
  network: string; // e.g., "solana:devnet"
  mint: string; // USDC mint address
  amount: string; // Amount in base units (lamports for USDC)
  payTo: string; // Seller's USDC token account
  nonce: string; // Unique nonce for anti-replay
  expiresAt: number; // Unix timestamp
  resource: {
    method: string;
    path: string;
    bodyHash: string; // SHA-256 hash of request body
  };
  facilitator: string; // Facilitator verification URL
}

export interface X402PaymentProof {
  txSignature: string; // Solana transaction signature
  nonce: string;
  bodyHash: string;
  payTo: string;
  amount: string;
  mint: string;
  network: string;
}

export interface X402Receipt {
  ok: true;
  txSignature: string;
  amount: string;
  mint: string;
  payTo: string;
  nonce: string;
  verifiedAt: number;
  buyer?: string;
}
