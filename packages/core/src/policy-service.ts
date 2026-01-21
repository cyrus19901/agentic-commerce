import { DB } from '@agentic-commerce/database';
import { Policy, PolicyCheckResult, PurchaseRequest } from '@agentic-commerce/shared';

export class PolicyService {
  constructor(private db: DB) {}

  async checkPurchase(request: PurchaseRequest): Promise<PolicyCheckResult> {
    const policies = await this.db.getActivePolicies(request.userId);
    const matchedPolicies: PolicyCheckResult['matchedPolicies'] = [];
    let allowed = true;
    let reason: string | undefined;

    // If no policies, deny by default for safety
    if (policies.length === 0) {
      return {
        allowed: false,
        reason: 'No policies configured',
        matchedPolicies: [],
      };
    }

    for (const policy of policies) {
      const result = await this.checkPolicy(policy, request);
      matchedPolicies.push({
        id: policy.id,
        name: policy.name,
        passed: result.passed,
        reason: result.reason,
      });

      if (!result.passed) {
        allowed = false;
        reason = result.reason;
        break;
      }
    }

    await this.db.recordPurchaseAttempt({
      userId: request.userId,
      productId: request.productId,
      amount: request.price,
      merchant: request.merchant,
      category: request.category,
      allowed,
      policyCheckResults: matchedPolicies,
    });

    return { allowed, reason, matchedPolicies };
  }

  private async checkPolicy(policy: Policy, request: PurchaseRequest) {
    if (policy.type === 'budget') {
      const spent = await this.db.getUserSpending(request.userId, policy.rules.period!);
      if (spent + request.price > (policy.rules.maxAmount || 0)) {
        return {
          passed: false,
          reason: `Would exceed ${policy.rules.period} budget of $${policy.rules.maxAmount}`,
        };
      }
    }

    if (policy.type === 'transaction' && request.price > (policy.rules.maxTransactionAmount || Infinity)) {
      return {
        passed: false,
        reason: `Exceeds transaction limit of $${policy.rules.maxTransactionAmount}`,
      };
    }

    return { passed: true };
  }
}
