# 🛍️ Agentic Commerce - ChatGPT Shopping Assistant

A complete ChatGPT-powered shopping assistant with policy enforcement, product search, and express checkout capabilities. Built with Express, TypeScript, Stripe, and SQLite.

## ✨ Features

- 🤖 **ChatGPT Integration** - Natural conversation-based shopping
- 🔍 **Product Search** - Search Etsy products (with mock data for testing)
- 📋 **Policy Enforcement** - Automatic budget and transaction limit checking
- ✅ **Approval Workflows** - Manual approval for purchases exceeding policy limits
- 💰 **Spending Tracking** - Daily, weekly, and monthly spending reports
- ⚡ **Express Checkout** - Quick purchase flow via Stripe
- 🔄 **ACP-Compliant** - Implements Agentic Commerce Protocol endpoints
- 🐳 **Docker Ready** - Run anywhere with Docker
- 🔒 **JWT Authentication** - Secure API access
- 📊 **SQLite Database** - Lightweight and portable

## 🚀 Quick Start: GPT Agent + Docker Backend

### Prerequisites & Dependencies

#### Required for Docker Setup

1. **Docker Desktop** (Mac/Windows) or **Docker Engine** (Linux)
   - **Mac**: [Download Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/)
   - **Windows**: [Download Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/)
   - **Linux**: Install Docker Engine + Docker Compose
     ```bash
     # Ubuntu/Debian
     curl -fsSL https://get.docker.com -o get-docker.sh
     sudo sh get-docker.sh
     sudo apt-get install docker-compose-plugin
     ```
   - **Verify installation**:
     ```bash
     docker --version          # Should show v20.10 or higher
     docker compose version    # Should show v2.0 or higher
     ```

2. **System Requirements**
   - **RAM**: 4GB minimum (8GB recommended)
   - **Disk Space**: 2GB free for Docker images and containers
   - **OS**: 
     - macOS 10.15 or later (Catalina+)
     - Windows 10/11 with WSL2
     - Linux (kernel 3.10+)

3. **Build Dependencies** (automatically installed in Docker)
   - **Node.js 20+**: JavaScript runtime
   - **Python 3**: Required for building native modules (SQLite, Prisma)
   - **g++**: C++ compiler for native bindings (Stripe SDK, SQLite)
   - **make**: Build tool for native modules
   - **SQLite**: Database engine

4. **ChatGPT Plus** subscription (for creating a custom GPT that calls this API)

#### Optional Dependencies (for local development without Docker)

- **Node.js**: v18+ ([Download](https://nodejs.org/))
- **npm**: v8+ (comes with Node.js)
- **Python 3**: For building native modules
- **Make & g++**: Build tools
  - Mac: `xcode-select --install`
  - Windows: `choco install make` (requires Chocolatey) or use WSL2
  - Linux: `sudo apt-get install build-essential`

#### Network Requirements

- Port **3000** available (or customize with `PORT` in `.env`)
- Port **8080** available (for SQLite DB viewer in dev mode)
- Internet access for:
  - Docker image pulls
  - ChatGPT API calls to your backend
  - Stripe API (for payments)
  - (Optional) Real Etsy API integration

#### Verify Docker Installation

Before starting, make sure Docker is working:

```bash
# Check Docker is installed
docker --version
docker compose version

# Check Docker daemon is running
docker info

# Test Docker with hello-world
docker run hello-world

# Check available resources
docker system df
```

If any command fails:
- **Mac/Windows**: Open Docker Desktop application and wait for it to start
- **Linux**: Run `sudo systemctl start docker` or `sudo service docker start`

### Option 1: Automated Setup (Recommended)

```bash
cd /Users/cyrus19901/Repository/agentic-commerce

# Run the quick start script
./scripts/quick-start.sh
```

This will:
- ✅ Check Docker installation
- 📝 Create `.env` file
- 🔨 Build Docker images
- 🚀 Start the backend in Docker (`api` on `http://localhost:3000`)
- 📦 Setup SQLite database in `./data`
- 🔑 Generate a **JWT token** for the GPT to use

**Copy the JWT token** from the output – this is what your GPT will send in the `Authorization` header.

### Option 2: Manual Setup

#### 1. Start Docker Desktop

Make sure Docker Desktop is running. Check with:
```bash
docker info
```

If not running, open Docker Desktop and wait for it to start.

#### 2. Setup Environment

```bash
cd /Users/cyrus19901/Repository/agentic-commerce

# Copy environment file
cp .env.example .env

# Optional: Add Stripe API key for real payments
# Edit .env and set STRIPE_SECRET_KEY=sk_test_...
```

#### 3. Build and Start

```bash
# Build and start containers
make dev

# Or without make:
docker compose -f docker-compose.dev.yml up -d
```

Wait for containers to start (check with `make dev-logs`)

#### 4. Setup Database

```bash
make db-setup
```

#### 5. Generate JWT Token

```bash
make generate-token USER=user-123
```

**Save this token** - you'll need it for ChatGPT configuration.

### Services Running

Once started, you'll have:
- **API**: http://localhost:3000
- **Health Check**: http://localhost:3000/health
- **DB Viewer**: http://localhost:8080 (dev mode only)

### How the GPT Talks to the Docker Backend

At a high level:

1. **Docker** runs the Express API on `http://localhost:3000` (inside your machine).
2. Your **custom GPT** is configured with an **OpenAPI schema** that describes the API (search, policy check, checkout, etc.).
3. The GPT uses **actions** (e.g. `searchProducts`, `checkPolicy`) that the OpenAI platform turns into HTTP requests to your Docker API.
4. Each request includes `Authorization: Bearer <your-jwt>` so the backend can authenticate the GPT.

### Configure the GPT (end‑to‑end)

1. Go to `https://chat.openai.com/gpts/editor`.
2. Click **Create a GPT**.
3. In **Actions → Import schema**, paste the OpenAPI YAML from [`docs/chatgpt-gpt-config.md`](./docs/chatgpt-gpt-config.md).
4. In **Authentication**:
   - **Type**: API Key / Bearer
   - **Header name**: `Authorization`
   - **Value format**: `Bearer <your-jwt-token>`
   - Use the token you generated via `make generate-token USER=user-123` (or the quick‑start script).
5. In the OpenAPI `servers` section, set:
   - `url: http://localhost:3000` for local testing.
   - If ChatGPT cannot reach `localhost` directly, expose your Docker API via a tunnel (e.g. ngrok) and use that HTTPS URL instead.
6. Save the GPT and start chatting – when it needs to search products or check policies, it will issue HTTP calls to your Dockerized backend.

### Test It!

In your ChatGPT GPT, try:
- "Find me a leather notebook under $50"
- "What's my spending this month?"
- "Show me handmade jewelry"
- "Buy this notebook" (will trigger policy checks)

### Troubleshooting

**Docker not running?**
```bash
# Check Docker status
docker info

# Start Docker (Linux)
sudo systemctl start docker

# Or open Docker Desktop (Mac/Windows)
```

**Build fails with native module errors?**
- Ensure Python 3, make, and g++ are installed
- Try cleaning Docker build cache:
  ```bash
  docker system prune -a
  docker compose build --no-cache
  ```

**Port already in use?**
```bash
# Change port in .env
echo "PORT=3001" >> .env
make restart
```

**Need help?**
```bash
make help              # Show all commands
make dev-logs          # View logs
./scripts/test-api.sh  # Test API endpoints
```

## 📁 Project Structure

```
agentic-commerce/
├── packages/
│   ├── api/              # Express REST API
│   ├── core/             # Business logic (Policy Service)
│   ├── database/         # SQLite database layer
│   ├── integrations/     # External APIs (Etsy, Stripe)
│   └── shared/           # Shared types and utilities
├── scripts/              # Utility scripts
├── docs/                 # Documentation
├── docker-compose.yml    # Production Docker setup
├── docker-compose.dev.yml # Development Docker setup
├── Dockerfile            # Production image
├── Dockerfile.dev        # Development image
└── Makefile             # Convenient commands
```

## 🛠️ Development

### Available Commands

```bash
make help              # Show all available commands
make dev               # Start development server with hot reload
make dev-logs          # View development logs
make dev-shell         # Open shell in container
make db-setup          # Setup database with default policies
make generate-token    # Generate JWT token
make status            # Show container status
```

### Manual Commands

```bash
# Build images
docker-compose build

# Start in production mode
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop containers
docker-compose down

# Clean everything
docker-compose down -v --rmi all
```

### Local Development (without Docker)

If you prefer to run locally:

```bash
# Install dependencies
npm install

# Build packages
npm run build

# Setup database
npm run db:setup

# Generate token
npm run generate-token user-123

# Start dev server
npm run dev
```

## 🧪 Local Testing Guide

### Quick Test: Health Check

First, verify the API is running:

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-10T12:00:00.000Z"
}
```

### 1. Generate JWT Token

```bash
# Generate token (save this for testing)
TOKEN=$(docker-compose exec api npm run generate-token user-123 | grep "Token:" | cut -d' ' -f2)

# Or use make command
make generate-token USER=user-123
```

### 2. Test API Endpoints with curl

#### Test Product Search

```bash
curl -X POST http://localhost:3000/api/products/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "leather notebook",
    "max_price": 50,
    "limit": 10
  }'
```

**Expected response:**
```json
{
  "products": [
    {
      "id": "mock-1",
      "title": "Handmade Leather Notebook - Brown",
      "price": 35.99,
      "merchant": "ArtisanLeatherCo",
      "category": "Paper & Party Supplies"
    }
  ]
}
```

#### Test Policy Check

```bash
curl -X POST http://localhost:3000/api/policy/check \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user-123",
    "product_id": "mock-1",
    "price": 35.99,
    "merchant": "ArtisanLeatherCo",
    "category": "Paper & Party Supplies"
  }'
```

**Expected response:**
```json
{
  "allowed": true,
  "message": "Purchase approved",
  "policy_checks": [
    {
      "policy_name": "Monthly Budget",
      "passed": true,
      "current_spending": 0,
      "limit": 1000
    }
  ]
}
```

#### Test Spending Summary

```bash
curl -X POST http://localhost:3000/api/policy/spending \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user-123"
  }'
```

#### Test Checkout Flow

```bash
# 1. Initiate checkout
CHECKOUT_RESPONSE=$(curl -s -X POST http://localhost:3000/api/checkout/initiate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user-123",
    "product_id": "mock-1",
    "product_name": "Leather Notebook",
    "amount": 35.99,
    "merchant": "ArtisanLeatherCo",
    "category": "Paper & Party Supplies"
  }')

echo $CHECKOUT_RESPONSE

# 2. Extract session ID
SESSION_ID=$(echo $CHECKOUT_RESPONSE | jq -r '.checkout_session_id')

# 3. Complete checkout
curl -X POST http://localhost:3000/api/checkout/complete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\": \"$SESSION_ID\",
    \"user_id\": \"user-123\"
  }"
```

### 3. Test Approval Workflow

Test products that require manual approval (Office Supplies over $100):

```bash
# Try to buy Office Supplies over $100 (requires approval)
curl -X POST http://localhost:3000/api/checkout/initiate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user-123",
    "product_id": "approval-test-1",
    "product_name": "Office Supplies Bundle",
    "amount": 120.00,
    "merchant": "OfficeSuppliesHub",
    "category": "Office Supplies"
  }'
```

**Expected response:**
```json
{
  "requiresApproval": true,
  "purchaseId": 1,
  "status": "pending_approval",
  "message": "Purchase recorded and pending manual approval"
}
```

**Get pending approvals:**
```bash
curl -X GET "http://localhost:3000/api/approvals/pending?user_id=user-123" \
  -H "Authorization: Bearer $TOKEN"
```

**Approve a purchase:**
```bash
curl -X POST http://localhost:3000/api/approvals/1/approve \
  -H "Authorization: Bearer $TOKEN"
```

### 4. Test with ChatGPT Agent

Once your custom GPT is configured:

1. **Test Product Search:**
   - "Find me a leather notebook under $50"
   - "Show me handmade jewelry"

2. **Test Policy Enforcement:**
   - "What's my spending this month?"
   - "Do I have budget left for a $200 purchase?"

3. **Test Checkout:**
   - "Buy this product: mock-1"
   - Verify the GPT follows the checkout flow

4. **Test Approvals:**
   - Try buying "approval-test-1" (Office Supplies $120)
   - GPT should inform you it needs approval

5. **Monitor Backend:**
   ```bash
   # Watch logs in real-time
   make dev-logs
   
   # Or with docker-compose
   docker-compose logs -f api
   ```

### 5. Database Inspection

View database contents:

```bash
# Open SQLite DB viewer (dev mode only)
open http://localhost:8080

# Or use SQLite CLI
docker-compose exec api sqlite3 /app/data/shopping.db

# View all policies
sqlite> SELECT * FROM policies;

# View purchase attempts
sqlite> SELECT * FROM purchase_attempts ORDER BY created_at DESC LIMIT 10;

# View users
sqlite> SELECT * FROM users;
```

### 6. Local Development Testing Workflow

```bash
# 1. Start services
make dev

# 2. Check services are running
make status

# 3. Setup database (first time only)
make db-setup

# 4. Generate test token
make generate-token USER=test-user

# 5. Test health endpoint
curl http://localhost:3000/health

# 6. Test product search
curl -X POST http://localhost:3000/api/products/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"leather","limit":5}'

# 7. Watch logs while testing
make dev-logs

# 8. Make changes to code (hot reload enabled)

# 9. Restart if needed
make restart

# 10. Clean up when done
make down
```

### 7. Testing Checklist

Before pushing changes, verify:

- [ ] `curl http://localhost:3000/health` returns 200
- [ ] Product search returns mock data
- [ ] Policy check enforces limits correctly
- [ ] Checkout flow completes successfully
- [ ] Approval workflow works for purchases requiring approval
- [ ] Docker logs show no errors
- [ ] Database contains expected data
- [ ] ChatGPT GPT can communicate with the API
- [ ] JWT authentication works
- [ ] CORS allows ChatGPT domains

### 8. Performance Testing

Test API response times:

```bash
# Install Apache Bench (if not installed)
# Mac: brew install httpd
# Ubuntu: sudo apt-get install apache2-utils

# Test health endpoint (1000 requests, 10 concurrent)
ab -n 1000 -c 10 http://localhost:3000/health

# Test search endpoint with auth
ab -n 100 -c 5 -T "application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -p search-payload.json \
  http://localhost:3000/api/products/search
```

**Create `search-payload.json`:**
```json
{"query":"leather","limit":10}
```

### 9. Error Testing

Test error handling:

```bash
# Test with invalid token
curl -X POST http://localhost:3000/api/products/search \
  -H "Authorization: Bearer invalid-token" \
  -H "Content-Type: application/json" \
  -d '{"query":"test"}'
# Expected: 401 Unauthorized

# Test with missing required fields
curl -X POST http://localhost:3000/api/policy/check \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test"}'
# Expected: 400 Bad Request

# Test with invalid price
curl -X POST http://localhost:3000/api/policy/check \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test","product_id":"prod","price":-10,"merchant":"test"}'
# Expected: 400 Bad Request or policy violation
```

### Common Testing Issues

**Issue: "Connection refused"**
```bash
# Check if Docker is running
docker ps

# Check if API container is healthy
docker-compose ps

# Restart services
make restart
```

**Issue: "401 Unauthorized"**
```bash
# Generate a fresh token
make generate-token USER=test-user

# Verify token format: Authorization: Bearer <token>
```

**Issue: "Database locked"**
```bash
# Stop all containers
make down

# Remove volumes
docker-compose down -v

# Restart and setup
make dev
make db-setup
```

**Issue: "Native module build errors"**
```bash
# Rebuild with no cache
docker-compose build --no-cache

# Verify build dependencies are installed
docker-compose run api apk info | grep -E "(python|make|g++)"
```

## 🔧 Configuration

### Environment Variables

Edit `.env` file:

```bash
# Server
PORT=3000
NODE_ENV=development

# Security
JWT_SECRET=your-secret-key-change-in-production

# Database
DATABASE_URL=./data/shopping.db

# CORS (for ChatGPT)
ALLOWED_ORIGINS=https://chat.openai.com,https://chatgpt.com

# Optional: Real Etsy API
ETSY_API_KEY=your-etsy-api-key
ETSY_SHOP_ID=your-shop-id

# Optional: Stripe payments (default: mock mode)
STRIPE_SECRET_KEY=sk_test_your-stripe-key
USE_MOCK_PAYMENTS=true
```

### Default Policies

The system comes with two default policies:

1. **Office Supplies Auto-Approve**: Up to $100 automatically approved
2. **Maximum Transaction Limit**: $500 per transaction (requires approval if exceeded)

To modify policies, edit `packages/database/src/setup.ts` and run:

```bash
make db-setup
```

## 📊 Database Viewer

Access the SQLite database viewer at http://localhost:8080 when running in dev mode.

View and query:
- `policies` - All configured policies
- `purchase_attempts` - Purchase history and policy checks
- `users` - User accounts
- `user_policies` - Policy assignments

## 🔒 Security

- JWT tokens expire after 30 days
- CORS restricted to ChatGPT domains
- All endpoints require authentication
- Policies are enforced server-side
- Input validation on all endpoints

**Production Checklist:**
- [ ] Change `JWT_SECRET` in `.env`
- [ ] Use HTTPS for production deployment
- [ ] Update `ALLOWED_ORIGINS` with your domain
- [ ] Set up proper database backups
- [ ] Configure rate limiting
- [ ] Enable logging and monitoring
- [ ] Use real Stripe API key (not test key)

## 🌐 Deployment

### Deploy to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

Update your ChatGPT GPT with the Railway URL.

### Deploy to Render

1. Connect your GitHub repo to Render
2. Create a new Web Service
3. Use Docker deployment
4. Set environment variables
5. Deploy!

### Deploy to Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Launch app
fly launch
fly deploy
```

## 📖 API Documentation

### Core Endpoints

#### `POST /api/products/search`
Search for products from Etsy (mock or real API)

**Request:**
```json
{
  "query": "leather notebook",
  "max_price": 50,
  "limit": 10,
  "category": "Office Supplies"
}
```

#### `POST /api/policy/check`
Check if purchase is allowed by policies

**Request:**
```json
{
  "user_id": "user-123",
  "product_id": "prod-456",
  "price": 35.99,
  "merchant": "ArtisanLeatherCo",
  "category": "Paper & Party Supplies"
}
```

#### `POST /api/policy/spending`
Get spending summary (daily, weekly, monthly)

#### `GET /api/purchases?user_id=user-123`
Get purchase history

#### `POST /api/checkout/initiate`
Start checkout process

#### `POST /api/checkout/complete`
Complete purchase

### Approval Management Endpoints

#### `GET /api/approvals/pending?user_id=user-123`
Get pending approvals for a user

#### `POST /api/approvals/:id/approve`
Approve a pending purchase

#### `POST /api/approvals/:id/reject`
Reject a pending purchase

#### `GET /api/approvals/:id/status`
Get approval status for a purchase

### ACP-Compliant Endpoints

#### `POST /checkout`
ACP-compliant checkout endpoint

#### `POST /delegate-payment`
Delegate payment token between parties

#### `GET /fulfillment/:orderId`
Get order fulfillment status

#### `POST /fulfillment`
Update fulfillment status

### Admin & Dashboard Endpoints

- `GET /api/dashboard` - Comprehensive user dashboard
- `GET /api/reports/spending` - Detailed spending report
- `GET /api/invoices` - Invoice/receipt history
- `GET /api/users` - List all users
- `GET /api/policies` - List all policies
- `GET /api/policy/compliance` - Policy compliance statistics

See [API Reference](./docs/api-reference.md) for complete documentation.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with Docker
5. Submit a pull request

## 📝 License

MIT License - see LICENSE file for details

## 🆘 Troubleshooting

### Port already in use
```bash
# Change PORT in .env or stop the conflicting service
lsof -ti:3000 | xargs kill -9
```

### Database locked
```bash
# Stop containers and remove volumes
make clean
make dev
make db-setup
```

### Token not working
```bash
# Generate a new token
make generate-token USER=user-123
# Update it in ChatGPT GPT settings
```

### Docker build fails
```bash
# Clean and rebuild
docker-compose down -v
docker system prune -a
make build
make dev
```

### Native module build errors
```bash
# Ensure build dependencies are installed
# The Dockerfile already includes python3, make, g++

# Try rebuilding with no cache
docker-compose build --no-cache

# Check logs for specific errors
docker-compose logs api
```

## 📚 Additional Resources

- [ChatGPT GPT Configuration Guide](./docs/chatgpt-gpt-config.md)
- [Architecture Documentation](./docs/architecture.md)
- [Policy Configuration](./docs/policies.md)
- [API Reference](./docs/api-reference.md)
- [Stripe Integration](./docs/stripe.md)
- [Agentic Commerce Protocol (ACP)](./docs/acp.md)

## 💡 What's Next?

- [ ] Add real Etsy API integration
- [ ] Implement full Stripe payment processing
- [ ] Add webhook support for order updates
- [ ] Create admin dashboard for policy management
- [ ] Add multi-tenant support
- [ ] Implement caching layer
- [ ] Add comprehensive test suite
- [ ] Set up CI/CD pipeline

## ⭐ Support

If you find this project helpful, please give it a star on GitHub!

---

Built with ❤️ using TypeScript, Express, Stripe, and ChatGPT
