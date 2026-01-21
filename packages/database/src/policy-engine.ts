import { prisma } from './prisma-client.js';
import { PolicyType, PeriodType } from '@prisma/client';

interface PurchaseRequest {
  userId: string;
  productId: string;
  amount: number;
  merchant: string;
  category?: string;
}

interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  violations: string[];
  matchedPolicies: Array<{
    id: string;
    name: string;
    passed: boolean;
    reason?: string;
  }>;
  budgetInfo?: {
    remaining: number;
    limit: number;
    period: string;
    spent: number;
  };
}

export class PolicyEngine {
  async checkPolicies(request: PurchaseRequest): Promise<PolicyCheckResult> {
    const violations: string[] = [];
    const matchedPolicies: Array<{
      id: string;
      name: string;
      passed: boolean;
      reason?: string;
    }> = [];

    // Get user's active policies
    const userPolicies = await prisma.policy.findMany({
      where: {
        users: {
          some: {
            userId: request.userId,
            active: true,
          },
        },
        active: true,
      },
      orderBy: {
        priority: 'desc',
      },
    });

    if (userPolicies.length === 0) {
      return {
        allowed: false,
        reason: 'No policies configured for this user',
        violations: ['No policies configured'],
        matchedPolicies: [],
      };
    }

    // Check each policy type
    for (const policy of userPolicies) {
      let passed = true;
      let reason: string | undefined;

      switch (policy.type) {
        case PolicyType.BUDGET_LIMIT:
          const budgetCheck = await this.checkBudgetLimit(
            request.userId,
            request.amount,
            policy
          );
          passed = budgetCheck.allowed;
          reason = budgetCheck.violation;
          if (!passed) violations.push(budgetCheck.violation);
          break;

        case PolicyType.TRANSACTION_LIMIT:
          if (policy.amount && request.amount > policy.amount) {
            passed = false;
            reason = `Exceeds transaction limit of $${policy.amount}`;
            violations.push(reason);
          }
          break;

        case PolicyType.MERCHANT_ALLOWLIST:
          if (policy.merchants && policy.merchants.length > 0) {
            const merchantAllowed = policy.merchants.some(
              (m: string) => m.toLowerCase() === request.merchant.toLowerCase()
            );
            if (!merchantAllowed) {
              passed = false;
              reason = `Merchant "${request.merchant}" is not in the approved list`;
              violations.push(reason);
            }
          }
          break;

        case PolicyType.MERCHANT_BLOCKLIST:
          if (policy.merchants && policy.merchants.length > 0) {
            const merchantBlocked = policy.merchants.some(
              (m: string) => m.toLowerCase() === request.merchant.toLowerCase()
            );
            if (merchantBlocked) {
              passed = false;
              reason = `Merchant "${request.merchant}" is blocked`;
              violations.push(reason);
            }
          }
          break;

        case PolicyType.CATEGORY_ALLOWLIST:
          if (request.category && policy.categories && policy.categories.length > 0) {
            const categoryAllowed = policy.categories.some(
              (c: string) => c.toLowerCase() === request.category!.toLowerCase()
            );
            if (!categoryAllowed) {
              passed = false;
              reason = `Category "${request.category}" is not in the approved list`;
              violations.push(reason);
            }
          }
          break;

        case PolicyType.CATEGORY_BLOCKLIST:
          if (request.category && policy.categories && policy.categories.length > 0) {
            const categoryBlocked = policy.categories.some(
              (c: string) => c.toLowerCase() === request.category!.toLowerCase()
            );
            if (categoryBlocked) {
              passed = false;
              reason = `Category "${request.category}" is blocked`;
              violations.push(reason);
            }
          }
          break;

        case PolicyType.TIME_RESTRICTION:
          const timeCheck = this.checkTimeRestriction(policy);
          passed = timeCheck.allowed;
          reason = timeCheck.violation;
          if (!passed) violations.push(timeCheck.violation);
          break;
      }

      matchedPolicies.push({
        id: policy.id,
        name: policy.name,
        passed,
        reason,
      });
    }

    // Get budget info if applicable
    let budgetInfo;
    const budgetPolicy = userPolicies.find((p) => p.type === PolicyType.BUDGET_LIMIT);
    if (budgetPolicy && budgetPolicy.periodType) {
      const spending = await this.getUserSpending(request.userId, budgetPolicy.periodType);
      budgetInfo = {
        remaining: (budgetPolicy.amount || 0) - spending,
        limit: budgetPolicy.amount || 0,
        period: budgetPolicy.periodType,
        spent: spending,
      };
    }

    const allowed = violations.length === 0;

    return {
      allowed,
      reason: allowed ? undefined : violations[0],
      violations,
      matchedPolicies,
      budgetInfo,
    };
  }

  private async checkBudgetLimit(
    userId: string,
    amount: number,
    policy: any
  ): Promise<{ allowed: boolean; violation: string }> {
    if (!policy.amount || !policy.periodType) {
      return { allowed: true, violation: '' };
    }

    const currentSpending = await this.getUserSpending(userId, policy.periodType);
    const totalAfterPurchase = currentSpending + amount;

    if (totalAfterPurchase > policy.amount) {
      return {
        allowed: false,
        violation: `Purchase would exceed ${policy.periodType.toLowerCase()} budget limit of $${
          policy.amount
        } (current spending: $${currentSpending.toFixed(2)})`,
      };
    }

    return { allowed: true, violation: '' };
  }

  private async getUserSpending(userId: string, periodType: PeriodType): Promise<number> {
    const { start, end } = this.getPeriodDates(periodType);

    const result = await prisma.purchase.aggregate({
      where: {
        userId,
        status: 'COMPLETED',
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      _sum: {
        amount: true,
      },
    });

    return result._sum.amount || 0;
  }

  private getPeriodDates(periodType: PeriodType): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date();
    const end = new Date();

    switch (periodType) {
      case PeriodType.DAILY:
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;

      case PeriodType.WEEKLY:
        const dayOfWeek = now.getDay();
        start.setDate(now.getDate() - dayOfWeek);
        start.setHours(0, 0, 0, 0);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        break;

      case PeriodType.MONTHLY:
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        end.setMonth(now.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        break;

      case PeriodType.YEARLY:
        start.setMonth(0, 1);
        start.setHours(0, 0, 0, 0);
        end.setMonth(11, 31);
        end.setHours(23, 59, 59, 999);
        break;
    }

    return { start, end };
  }

  private checkTimeRestriction(policy: any): { allowed: boolean; violation: string } {
    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;

    // Check day of week
    if (policy.daysOfWeek && policy.daysOfWeek.length > 0) {
      if (!policy.daysOfWeek.includes(currentDay)) {
        return {
          allowed: false,
          violation: 'Purchases are not allowed on this day of the week',
        };
      }
    }

    // Check time range
    if (policy.startTime && policy.endTime) {
      if (currentTime < policy.startTime || currentTime > policy.endTime) {
        return {
          allowed: false,
          violation: `Purchases are only allowed between ${policy.startTime} and ${policy.endTime}`,
        };
      }
    }

    return { allowed: true, violation: '' };
  }

  async getUserBudget(userId: string) {
    const budgetPolicies = await prisma.policy.findMany({
      where: {
        users: {
          some: {
            userId,
            active: true,
          },
        },
        active: true,
        type: PolicyType.BUDGET_LIMIT,
      },
    });

    const budgets = await Promise.all(
      budgetPolicies.map(async (policy) => {
        const spending = await this.getUserSpending(userId, policy.periodType!);
        return {
          period: policy.periodType,
          limit: policy.amount,
          spent: spending,
          remaining: (policy.amount || 0) - spending,
        };
      })
    );

    return budgets;
  }
}

