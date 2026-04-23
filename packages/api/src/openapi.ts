export const openapiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Agentic Commerce Platform API',
    version: '1.0.0',
    description: 'Multi-tenant facilitation-as-a-service for agentic payments. Policy enforcement, on-chain settlement, and full audit trail.',
    contact: { name: 'API Support' },
  },
  servers: [
    { url: '/api/v1', description: 'Platform API v1' },
  ],
  security: [{ ApiKeyAuth: [] }],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key (live: ak_live_..., sandbox: ak_test_...)',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string' },
              details: { type: 'object' },
              request_id: { type: 'string', example: 'req_abc123' },
            },
          },
        },
      },
      PaymentExecuteRequest: {
        type: 'object',
        required: ['provider', 'action'],
        properties: {
          provider: { type: 'string', example: 'zyte' },
          action: { type: 'string', example: 'scrape' },
          params: { type: 'object', properties: { url: { type: 'string', format: 'uri' } } },
          max_payment_usdc: { type: 'number', example: 0.10 },
          callback_url: { type: 'string', format: 'uri' },
          sandbox: { type: 'boolean', description: 'Force sandbox mode (also triggered by ak_test_ keys)' },
        },
      },
      PaymentResult: {
        type: 'object',
        properties: {
          paymentId: { type: 'string' },
          status: { type: 'string', enum: ['completed', 'failed', 'rejected', 'verification_failed'] },
          correlationId: { type: 'string' },
          provider: { type: 'string' },
          action: { type: 'string' },
          baseTxHash: { type: 'string' },
          paymentAmountUsdc: { type: 'number' },
          agentWallet: { type: 'string' },
          data: { type: 'object' },
        },
      },
      Policy: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['budget', 'transaction', 'merchant', 'category', 'time', 'agent', 'purpose', 'composite'] },
          enabled: { type: 'boolean' },
          priority: { type: 'integer' },
          conditions: { type: 'object' },
          rules: { type: 'object' },
        },
      },
      Treasury: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          orgId: { type: 'string' },
          currency: { type: 'string', example: 'USDC' },
          balanceAvailable: { type: 'number' },
          balanceReserved: { type: 'number' },
        },
      },
    },
  },
  paths: {
    '/payments/execute': {
      post: {
        tags: ['Payments'],
        summary: 'Execute a payment',
        description: 'Submit a payment request. Runs policy checks, holds treasury funds, dispatches to provider, verifies on-chain TX, and settles.',
        operationId: 'executePayment',
        security: [{ ApiKeyAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PaymentExecuteRequest' } } } },
        responses: {
          200: { description: 'Payment completed', content: { 'application/json': { schema: { $ref: '#/components/schemas/PaymentResult' } } } },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          403: { description: 'Policy rejected' },
        },
      },
    },
    '/payments': {
      get: {
        tags: ['Payments'],
        summary: 'List payments',
        operationId: 'listPayments',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Paginated payment list' } },
      },
    },
    '/payments/{id}': {
      get: { tags: ['Payments'], summary: 'Get payment details', operationId: 'getPayment', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Payment details' }, 404: { description: 'Not found' } } },
    },
    '/payments/{id}/trace': {
      get: { tags: ['Payments'], summary: 'Get payment audit trace', operationId: 'getPaymentTrace', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Audit trace' } } },
    },
    '/payments/{id}/verify': {
      get: { tags: ['Payments'], summary: 'Re-verify on-chain transaction', operationId: 'verifyPayment', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Verification result' } } },
    },
    '/policies': {
      get: { tags: ['Policies'], summary: 'List policies', operationId: 'listPolicies', responses: { 200: { description: 'Policy list' } } },
      post: { tags: ['Policies'], summary: 'Create policy', operationId: 'createPolicy', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Policy' } } } }, responses: { 201: { description: 'Created' } } },
    },
    '/policies/{id}': {
      put: { tags: ['Policies'], summary: 'Update policy', operationId: 'updatePolicy', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Updated' } } },
      delete: { tags: ['Policies'], summary: 'Delete policy', operationId: 'deletePolicy', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deleted' } } },
    },
    '/policies/check': {
      post: { tags: ['Policies'], summary: 'Dry-run policy check', operationId: 'checkPolicy', responses: { 200: { description: 'Check result' } } },
    },
    '/audit': {
      get: { tags: ['Audit'], summary: 'Query audit entries', operationId: 'queryAudit', parameters: [
        { name: 'event_type', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer' } },
        { name: 'offset', in: 'query', schema: { type: 'integer' } },
        { name: 'correlation_id', in: 'query', schema: { type: 'string' } },
      ], responses: { 200: { description: 'Audit entries' } } },
    },
    '/audit/stats': { get: { tags: ['Audit'], summary: 'Audit statistics', operationId: 'auditStats', responses: { 200: { description: 'Stats' } } } },
    '/audit/{id}': { get: { tags: ['Audit'], summary: 'Get audit entry', operationId: 'getAuditEntry', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Entry' } } } },
    '/treasury': { get: { tags: ['Treasury'], summary: 'Get treasury balance', operationId: 'getTreasury', responses: { 200: { description: 'Balance', content: { 'application/json': { schema: { $ref: '#/components/schemas/Treasury' } } } } } } },
    '/treasury/ledger': { get: { tags: ['Treasury'], summary: 'Treasury ledger', operationId: 'getTreasuryLedger', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }, { name: 'offset', in: 'query', schema: { type: 'integer' } }], responses: { 200: { description: 'Ledger entries' } } } },
    '/treasury/deposit': { post: { tags: ['Treasury'], summary: 'Record deposit (admin)', operationId: 'depositTreasury', responses: { 200: { description: 'Deposit recorded' } } } },
    '/treasury/reconcile': { get: { tags: ['Treasury'], summary: 'Reconcile on-chain vs off-chain (admin)', operationId: 'reconcileTreasury', responses: { 200: { description: 'Reconciliation result' } } } },
    '/providers': { get: { tags: ['Providers'], summary: 'List providers', operationId: 'listProviders', responses: { 200: { description: 'Provider list' } } } },
    '/providers/{id}': { get: { tags: ['Providers'], summary: 'Get provider', operationId: 'getProvider', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Provider' } } } },
    '/orgs': { post: { tags: ['Organization'], summary: 'Create organization', operationId: 'createOrg', responses: { 201: { description: 'Org created with API key and webhook secret' } } } },
    '/orgs/me': {
      get: { tags: ['Organization'], summary: 'Get current organization', operationId: 'getOrg', responses: { 200: { description: 'Organization details' } } },
      put: { tags: ['Organization'], summary: 'Update organization', operationId: 'updateOrg', responses: { 200: { description: 'Updated' } } },
    },
    '/orgs/me/api-keys': {
      get: { tags: ['Organization'], summary: 'List API keys', operationId: 'listApiKeys', responses: { 200: { description: 'Key list (prefixes only)' } } },
      post: { tags: ['Organization'], summary: 'Create API key', operationId: 'createApiKey', responses: { 201: { description: 'New API key (shown once)' } } },
    },
    '/orgs/me/api-keys/{id}': {
      delete: { tags: ['Organization'], summary: 'Revoke API key', operationId: 'revokeApiKey', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Revoked' } } },
    },
    '/orgs/me/api-keys/{id}/rotate': {
      post: { tags: ['Organization'], summary: 'Rotate API key', operationId: 'rotateApiKey', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Old key disabled, new key returned' } } },
    },
    '/orgs/me/webhook-secret': { get: { tags: ['Organization'], summary: 'Get webhook secret', operationId: 'getWebhookSecret', responses: { 200: { description: 'Secret' } } } },
    '/orgs/me/webhook-secret/rotate': { post: { tags: ['Organization'], summary: 'Rotate webhook secret', operationId: 'rotateWebhookSecret', responses: { 200: { description: 'New secret' } } } },
    '/health': { get: { tags: ['Health'], summary: 'Health check', operationId: 'health', security: [], responses: { 200: { description: 'OK' } } } },
  },
};
