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
    type: 'budget' | 'transaction' | 'merchant' | 'category' | 'time';
    enabled: boolean;
    priority: number;
    conditions: {
        users?: string[];
        departments?: string[];
        timeRange?: {
            start: string;
            end: string;
        };
    };
    rules: {
        maxAmount?: number;
        period?: 'daily' | 'weekly' | 'monthly';
        maxTransactionAmount?: number;
        allowedMerchants?: string[];
        blockedMerchants?: string[];
        allowedCategories?: string[];
        blockedCategories?: string[];
    };
}
export interface PolicyCheckResult {
    allowed: boolean;
    reason?: string;
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
}
//# sourceMappingURL=index.d.ts.map