import { DB } from '@agentic-commerce/database';
import { Policy, PolicyCheckResult, PurchaseRequest } from '@agentic-commerce/shared';

export class PolicyService {
  constructor(private db: DB) {}

  async checkPurchase(request: PurchaseRequest): Promise<PolicyCheckResult> {
    const policies = await this.db.getActivePolicies(request.userId);
    const matchedPolicies: PolicyCheckResult['matchedPolicies'] = [];
    let allowed = true;
    let reason: string | undefined;
    let requiresApproval = false;
    let flaggedForReview = false;

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
        // Check if this policy requires approval
        if ((result as any).requiresApproval) {
          requiresApproval = true;
        }
        if ((result as any).flaggedForReview) {
          flaggedForReview = true;
        }
        // Don't break if it requires approval - we want to check all policies
        // But break for deny actions
        if (!(result as any).requiresApproval && !(result as any).flaggedForReview) {
          break;
        }
      } else if ((result as any).flaggedForReview) {
        flaggedForReview = true;
      }
    }

    await this.db.recordPurchaseAttempt({
      userId: request.userId,
      productId: request.productId || `temp-${Date.now()}`,  // Generate temp ID if missing
      productName: (request as any).productName || 'Unknown Product',
      amount: request.price,
      merchant: request.merchant,
      category: request.category,
      allowed,
      requiresApproval: requiresApproval || false,
      policyCheckResults: matchedPolicies,
    });

    return { 
      allowed, 
      reason, 
      requiresApproval: requiresApproval || undefined,
      flaggedForReview: flaggedForReview || undefined,
      matchedPolicies 
    };
  }

  private async checkPolicy(policy: Policy, request: PurchaseRequest) {
    let hasMatchingCondition = false;
    
    // Budget check
    if (policy.type === 'budget') {
      hasMatchingCondition = true;
      const spent = await this.db.getUserSpending(request.userId, policy.rules.period!);
      if (spent + request.price > (policy.rules.maxAmount || 0)) {
        return {
          passed: false,
          reason: `Would exceed ${policy.rules.period} budget of $${policy.rules.maxAmount}`,
        };
      }
    }

    // Transaction amount check
    if (policy.type === 'transaction') {
      hasMatchingCondition = true;
      if (request.price > (policy.rules.maxTransactionAmount || Infinity)) {
        return {
          passed: false,
          reason: `Exceeds transaction limit of $${policy.rules.maxTransactionAmount}`,
        };
      }
    }

    // Merchant check
    if (policy.type === 'merchant') {
      hasMatchingCondition = true;
      const merchantLower = request.merchant.toLowerCase();
      
      // Check blocked merchants first
      if (policy.rules.blockedMerchants && policy.rules.blockedMerchants.length > 0) {
        const isBlocked = policy.rules.blockedMerchants.some(
          (blocked) => blocked.toLowerCase() === merchantLower
        );
        if (isBlocked) {
          return {
            passed: false,
            reason: `Merchant "${request.merchant}" is blocked`,
          };
        }
      }
      
      // Check allowed merchants (if list exists, merchant must be in it)
      if (policy.rules.allowedMerchants && policy.rules.allowedMerchants.length > 0) {
        const isAllowed = policy.rules.allowedMerchants.some(
          (allowed) => allowed.toLowerCase() === merchantLower
        );
        if (!isAllowed) {
          return {
            passed: false,
            reason: `Merchant "${request.merchant}" is not in the allowed list`,
          };
        }
      }
    }

    // Category check
    if (policy.type === 'category' && request.category) {
      hasMatchingCondition = true;
      const categoryLower = request.category.toLowerCase();
      
      // Check blocked categories first
      if (policy.rules.blockedCategories && policy.rules.blockedCategories.length > 0) {
        const isBlocked = policy.rules.blockedCategories.some(
          (blocked) => blocked.toLowerCase() === categoryLower
        );
        if (isBlocked) {
          return {
            passed: false,
            reason: `Category "${request.category}" is blocked`,
          };
        }
      }
      
      // Check allowed categories (if list exists, category must be in it)
      if (policy.rules.allowedCategories && policy.rules.allowedCategories.length > 0) {
        const isAllowed = policy.rules.allowedCategories.some(
          (allowed) => allowed.toLowerCase() === categoryLower
        );
        if (!isAllowed) {
          return {
            passed: false,
            reason: `Category "${request.category}" is not in the allowed list`,
          };
        }
        
        // Category matches - now check amount limit
        if (policy.rules.maxTransactionAmount && request.price > policy.rules.maxTransactionAmount) {
          // Amount exceeds limit - check fallback action
          const fallbackAction = policy.rules.fallbackAction || 'require_approval';
          
          switch (fallbackAction) {
            case 'deny':
              return {
                passed: false,
                reason: `Amount $${request.price} exceeds category limit of $${policy.rules.maxTransactionAmount}`,
              };
            case 'require_approval':
              return {
                passed: false,
                reason: `Amount $${request.price} exceeds ${request.category} category limit of $${policy.rules.maxTransactionAmount} - manual approval required`,
                requiresApproval: true,
              };
            case 'flag_review':
              return {
                passed: true,
                reason: `Amount $${request.price} exceeds category limit - flagged for review`,
                flaggedForReview: true,
              };
            case 'approve':
            default:
              // Continue to approve
              break;
          }
        }
      }
    }

    // Time-based checks
    if (policy.type === 'time' || policy.rules.allowedTimeRanges || policy.rules.allowedDaysOfWeek) {
      hasMatchingCondition = true;
      if (request.timeOfDay) {
        // Check time ranges
        if (policy.rules.allowedTimeRanges && policy.rules.allowedTimeRanges.length > 0) {
          const requestTime = this.parseTime(request.timeOfDay);
          const isInAllowedRange = policy.rules.allowedTimeRanges.some(range => {
            const start = this.parseTime(range.start);
            const end = this.parseTime(range.end);
            return requestTime >= start && requestTime <= end;
          });
          if (!isInAllowedRange) {
            return {
              passed: false,
              reason: `Transaction time ${request.timeOfDay} is not in allowed time ranges`,
            };
          }
        }
      }

      // Check day of week
      if (policy.rules.allowedDaysOfWeek && policy.rules.allowedDaysOfWeek.length > 0 && request.dayOfWeek !== undefined) {
        if (!policy.rules.allowedDaysOfWeek.includes(request.dayOfWeek)) {
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          return {
            passed: false,
            reason: `Transactions are not allowed on ${dayNames[request.dayOfWeek]}`,
          };
        }
      }
    }

    // Agent-based checks
    if (policy.type === 'agent' || policy.rules.allowedAgentNames || policy.rules.blockedAgentNames || 
        policy.rules.allowedAgentTypes || policy.rules.blockedAgentTypes) {
      hasMatchingCondition = true;
      // Check agent name
      if (request.agentName) {
        const agentNameLower = request.agentName.toLowerCase();
        
        if (policy.rules.blockedAgentNames && policy.rules.blockedAgentNames.length > 0) {
          const isBlocked = policy.rules.blockedAgentNames.some(
            (blocked) => blocked.toLowerCase() === agentNameLower
          );
          if (isBlocked) {
            return {
              passed: false,
              reason: `Agent "${request.agentName}" is blocked`,
            };
          }
        }
        
        if (policy.rules.allowedAgentNames && policy.rules.allowedAgentNames.length > 0) {
          const isAllowed = policy.rules.allowedAgentNames.some(
            (allowed) => allowed.toLowerCase() === agentNameLower
          );
          if (!isAllowed) {
            return {
              passed: false,
              reason: `Agent "${request.agentName}" is not in the allowed list`,
            };
          }
        }
      }

      // Check agent type
      if (request.agentType) {
        const agentTypeLower = request.agentType.toLowerCase();
        
        if (policy.rules.blockedAgentTypes && policy.rules.blockedAgentTypes.length > 0) {
          const isBlocked = policy.rules.blockedAgentTypes.some(
            (blocked) => blocked.toLowerCase() === agentTypeLower
          );
          if (isBlocked) {
            return {
              passed: false,
              reason: `Agent type "${request.agentType}" is blocked`,
            };
          }
        }
        
        if (policy.rules.allowedAgentTypes && policy.rules.allowedAgentTypes.length > 0) {
          const isAllowed = policy.rules.allowedAgentTypes.some(
            (allowed) => allowed.toLowerCase() === agentTypeLower
          );
          if (!isAllowed) {
            return {
              passed: false,
              reason: `Agent type "${request.agentType}" is not in the allowed list`,
            };
          }
        }
      }

      // Check recipient agent
      if (request.recipientAgent) {
        const recipientLower = request.recipientAgent.toLowerCase();
        
        if (policy.rules.blockedRecipientAgents && policy.rules.blockedRecipientAgents.length > 0) {
          const isBlocked = policy.rules.blockedRecipientAgents.some(
            (blocked) => blocked.toLowerCase() === recipientLower
          );
          if (isBlocked) {
            return {
              passed: false,
              reason: `Recipient agent "${request.recipientAgent}" is blocked`,
            };
          }
        }
        
        if (policy.rules.allowedRecipientAgents && policy.rules.allowedRecipientAgents.length > 0) {
          const isAllowed = policy.rules.allowedRecipientAgents.some(
            (allowed) => allowed.toLowerCase() === recipientLower
          );
          if (!isAllowed) {
            return {
              passed: false,
              reason: `Recipient agent "${request.recipientAgent}" is not in the allowed list`,
            };
          }
        }
      }
    }

    // Purpose-based checks
    if (policy.type === 'purpose' && request.purpose) {
      hasMatchingCondition = true;
      const purposeLower = request.purpose.toLowerCase();
      
      if (policy.rules.blockedPurposes && policy.rules.blockedPurposes.length > 0) {
        const isBlocked = policy.rules.blockedPurposes.some(
          (blocked) => blocked.toLowerCase() === purposeLower
        );
        if (isBlocked) {
          return {
            passed: false,
            reason: `Purpose "${request.purpose}" is blocked`,
          };
        }
      }
      
      if (policy.rules.allowedPurposes && policy.rules.allowedPurposes.length > 0) {
        const isAllowed = policy.rules.allowedPurposes.some(
          (allowed) => allowed.toLowerCase() === purposeLower
        );
        if (!isAllowed) {
          return {
            passed: false,
            reason: `Purpose "${request.purpose}" is not in the allowed list`,
          };
        }
      }
    }

    // Composite conditions (for complex rules with multiple field checks)
    if (policy.type === 'composite' && policy.rules.compositeConditions) {
      hasMatchingCondition = true;
      for (const condition of policy.rules.compositeConditions) {
        const result = this.checkCompositeCondition(condition, request);
        if (!result.passed) {
          return result;
        }
      }
    }

    // If no conditions matched, apply fallback action
    if (!hasMatchingCondition) {
      const fallbackAction = policy.rules.fallbackAction || 'require_approval';
      
      switch (fallbackAction) {
        case 'deny':
          return {
            passed: false,
            reason: 'No matching conditions found - transaction denied by default',
          };
        case 'require_approval':
          return {
            passed: false,
            reason: 'No matching conditions found - manual approval required',
            requiresApproval: true,
          };
        case 'flag_review':
          return {
            passed: true, // Allow but flag for review
            reason: 'No matching conditions found - flagged for review',
            flaggedForReview: true,
          };
        case 'approve':
        default:
          return { passed: true };
      }
    }

    return { passed: true };
  }

  private parseTime(timeStr: string): number {
    // Convert HH:MM to minutes since midnight
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private checkCompositeCondition(
    condition: { field: string; operator: string; value: string | number },
    request: PurchaseRequest
  ): { passed: boolean; reason?: string } {
    let fieldValue: any;
    
    // Map frontend field names to request properties
    switch (condition.field) {
      case 'amount':
        fieldValue = request.price;
        break;
      case 'merchant_name':
        fieldValue = request.merchant;
        break;
      case 'merchant_category':
        fieldValue = request.category;
        break;
      case 'agent_name':
        fieldValue = request.agentName;
        break;
      case 'agent_type':
        fieldValue = request.agentType;
        break;
      case 'time_of_day':
        fieldValue = request.timeOfDay;
        break;
      case 'day_of_week':
        fieldValue = request.dayOfWeek;
        break;
      case 'recipient_agent':
        fieldValue = request.recipientAgent;
        break;
      case 'purpose':
        fieldValue = request.purpose;
        break;
      default:
        return { passed: true }; // Unknown field, skip
    }

    if (fieldValue === undefined || fieldValue === null) {
      return { passed: true }; // Field not provided, skip check
    }

    const conditionValue = typeof condition.value === 'string' ? condition.value.toLowerCase() : condition.value;
    const requestValue = typeof fieldValue === 'string' ? fieldValue.toLowerCase() : fieldValue;

    switch (condition.operator) {
      case 'equals':
        return { passed: requestValue === conditionValue };
      case 'not_equals':
        return { passed: requestValue !== conditionValue };
      case 'greater_than':
        return { passed: Number(requestValue) > Number(conditionValue) };
      case 'greater_than_or_equal':
        return { passed: Number(requestValue) >= Number(conditionValue) };
      case 'less_than':
        return { passed: Number(requestValue) < Number(conditionValue) };
      case 'less_than_or_equal':
        return { passed: Number(requestValue) <= Number(conditionValue) };
      case 'contains':
        return { passed: String(requestValue).includes(String(conditionValue)) };
      case 'not_contains':
        return { passed: !String(requestValue).includes(String(conditionValue)) };
      case 'starts_with':
        return { passed: String(requestValue).startsWith(String(conditionValue)) };
      case 'in_list':
        // For in_list, value might be a comma-separated string or array
        const list = String(conditionValue).split(',').map(s => s.trim().toLowerCase());
        return { passed: list.includes(String(requestValue).toLowerCase()) };
      default:
        return { passed: true }; // Unknown operator, skip
    }
  }
}
