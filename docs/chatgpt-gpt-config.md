# ChatGPT GPT Configuration

## GPT Settings

### Name
**Smart Shopping Assistant**

### Description
An AI shopping assistant that helps you find and purchase products from Etsy while enforcing company purchasing policies. I can search for products, check if purchases comply with your organization's policies, and help you complete purchases.

### Instructions

```
You are a Smart Shopping Assistant that helps users find and purchase products while enforcing company purchasing policies.

## Your Capabilities

1. **Product Search**: Search for products on Etsy based on user queries, price limits, and categories
2. **Policy Checking**: Verify if purchases comply with company policies (budget limits, transaction limits, merchant restrictions, etc.)
3. **Spending Tracking**: Show users their current spending (daily, weekly, monthly)
4. **Express Checkout**: Help users complete purchases quickly

## Conversation Flow

### When a user asks to find products:
1. Ask clarifying questions if needed (price range, specific features, category)
2. Use the search_products action to find matching items
3. Present 3-5 top results with key details (title, price, merchant, description)
4. Ask if they'd like to see more or purchase any item

### When a user wants to buy something:
1. Use check_policy action to verify the purchase is allowed
2. If ALLOWED: Explain why it's approved and offer to proceed with checkout
3. If DENIED: Explain the specific policy violation and suggest alternatives
4. Show current spending if relevant to the policy violation

### When initiating checkout:
1. Confirm the item and price
2. Use initiate_checkout to get the checkout URL
3. Provide the checkout link and explain next steps
4. After user completes payment, use complete_checkout to finalize

## Important Guidelines

- Always check policies BEFORE initiating checkout
- Be transparent about policy violations - explain the specific rule and current spending
- Suggest alternatives when purchases are denied (lower price items, different merchants, etc.)
- Keep responses concise and friendly
- If a policy check fails, offer to show their current spending breakdown
- Never bypass or ignore policy violations
- Format prices clearly with currency symbols

## Response Style

- Friendly and helpful, like a personal shopping assistant
- Concise but informative
- Use emojis sparingly for visual appeal (🛍️, ✅, ❌, 💰)
- Structure responses with clear sections when showing multiple products
- Always include relevant details: price, merchant, key features

## Example Interactions

**User**: "Find me a leather notebook under $50"
**You**: Search products, show 3-5 results with prices and merchants, ask which they prefer

**User**: "I want to buy the first one"
**You**: Check policy, if approved explain why and offer checkout link, if denied explain the violation

**User**: "How much have I spent this month?"
**You**: Use get_spending action and show a clear breakdown
```

### Conversation Starters

1. "Find me a unique gift under $50"
2. "Show me handmade leather goods"
3. "What's my spending this month?"
4. "Search for vintage home decor"

## Actions Configuration

### OpenAPI Schema

Use this OpenAPI schema for the actions:

```yaml
openapi: 3.1.0
info:
  title: Agentic Commerce API
  description: API for ChatGPT shopping assistant with policy enforcement
  version: 1.0.0
servers:
  - url: http://localhost:3000
    description: Local development server
  - url: https://your-domain.com
    description: Production server (update with your actual domain)

paths:
  /api/products/search:
    post:
      operationId: searchProducts
      summary: Search for products
      description: Search for products on Etsy with optional filters
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - query
              properties:
                query:
                  type: string
                  description: Search query (e.g., "leather notebook", "vintage lamp")
                max_price:
                  type: number
                  description: Maximum price filter
                limit:
                  type: integer
                  description: Number of results to return (default 10)
                  default: 10
      responses:
        '200':
          description: Successful search
          content:
            application/json:
              schema:
                type: object
                properties:
                  products:
                    type: array
                    items:
                      type: object
                      properties:
                        id:
                          type: string
                        title:
                          type: string
                        description:
                          type: string
                        price:
                          type: number
                        currency:
                          type: string
                        merchant:
                          type: string
                        merchantId:
                          type: string
                        url:
                          type: string
                        imageUrl:
                          type: string
                        category:
                          type: string
                        inStock:
                          type: boolean

  /api/policy/check:
    post:
      operationId: checkPolicy
      summary: Check if purchase complies with policies
      description: Verify if a purchase is allowed based on company policies
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - user_id
                - product_id
                - price
                - merchant
              properties:
                user_id:
                  type: string
                  description: User identifier
                product_id:
                  type: string
                  description: Product identifier
                price:
                  type: number
                  description: Product price
                merchant:
                  type: string
                  description: Merchant/shop name
                category:
                  type: string
                  description: Product category
      responses:
        '200':
          description: Policy check result
          content:
            application/json:
              schema:
                type: object
                properties:
                  allowed:
                    type: boolean
                  reason:
                    type: string
                  matchedPolicies:
                    type: array
                    items:
                      type: object
                      properties:
                        id:
                          type: string
                        name:
                          type: string
                        passed:
                          type: boolean
                        reason:
                          type: string

  /api/policy/spending:
    post:
      operationId: getSpending
      summary: Get user spending summary
      description: Retrieve user's spending for different time periods
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - user_id
              properties:
                user_id:
                  type: string
                  description: User identifier
      responses:
        '200':
          description: Spending summary
          content:
            application/json:
              schema:
                type: object
                properties:
                  userId:
                    type: string
                  spending:
                    type: object
                    properties:
                      daily:
                        type: number
                      weekly:
                        type: number
                      monthly:
                        type: number

  /api/checkout/initiate:
    post:
      operationId: initiateCheckout
      summary: Initiate checkout process
      description: Create a checkout session for a product
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - user_id
                - product_id
                - amount
              properties:
                user_id:
                  type: string
                product_id:
                  type: string
                amount:
                  type: number
                merchant:
                  type: string
      responses:
        '200':
          description: Checkout session created
          content:
            application/json:
              schema:
                type: object
                properties:
                  checkout_session_id:
                    type: string
                  checkout_url:
                    type: string
                  expires_at:
                    type: string

  /api/checkout/complete:
    post:
      operationId: completeCheckout
      summary: Complete checkout
      description: Finalize a purchase after payment
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - session_id
                - user_id
              properties:
                session_id:
                  type: string
                user_id:
                  type: string
      responses:
        '200':
          description: Purchase completed
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                  message:
                    type: string
                  invoice:
                    type: object
                    properties:
                      id:
                        type: string
                      orderId:
                        type: string
                      amount:
                        type: number
                      status:
                        type: string

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

security:
  - BearerAuth: []
```

## Authentication Setup

1. **Authentication Type**: API Key
2. **Auth Type**: Bearer
3. **Header Name**: Authorization
4. **Token Format**: `Bearer <your-jwt-token>`

### Getting Your JWT Token

After starting the Docker container, generate a token:

```bash
make generate-token USER=user-123
```

Or manually:

```bash
docker-compose exec api npm run generate-token user-123
```

Copy the generated token and paste it in the GPT authentication settings.

## Privacy Policy

**Data Usage**: This GPT uses your shopping queries and purchase history to enforce company policies and provide personalized recommendations. Data is stored securely and only used for shopping assistance.

## Testing Your GPT

Once configured, test with these queries:

1. "Find me a leather notebook under $50"
2. "What's my spending this month?"
3. "Show me handmade jewelry"
4. "I want to buy [product name]"

## Updating the Server URL

When you deploy to production:

1. Update the `servers` section in the OpenAPI schema
2. Replace `http://localhost:3000` with your production URL
3. Update CORS settings in your `.env` file
4. Regenerate and update the JWT token in GPT settings

