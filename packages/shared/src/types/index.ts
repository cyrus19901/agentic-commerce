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

export interface Policy {
  id: string;
  name: string;
  type: 'budget' | 'transaction' | 'merchant' | 'category' | 'time' | 'agent' | 'purpose' | 'composite';
  enabled: boolean;
  priority: number;
  conditions: {
    users?: string[];
    departments?: string[];
    timeRange?: { start: string; end: string };
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
  // Additional fields for policy conditions
  agentName?: string;
  agentType?: string;
  timeOfDay?: string; // HH:MM format
  dayOfWeek?: number; // 0-6, Sunday = 0
  recipientAgent?: string;
  purpose?: string;
}
