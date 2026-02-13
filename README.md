# 🛍️ Agentic Commerce - Unified Commerce Platform

**One ChatGPT. Two Commerce Modes. Zero Friction.**

A complete dual-mode commerce platform that seamlessly handles:
- 🛒 **Agent-to-Merchant**: Buy products from stores via Stripe
- 🤖 **Agent-to-Agent**: Request AI services via Solana/x402 USDC micropayments

Built with Express, TypeScript, Solana, and unified policy enforcement.

## ✨ Key Features

### **Dual-Mode Commerce**
- 🛍️ **Shopping (Stripe)**: Buy physical products from merchants
- 🤖 **Services (Solana)**: Request data scraping, API calls, analytics from AI agents
- 🎯 **Auto-Detection**: ChatGPT intelligently routes based on user intent

### **Unified Policy Engine**
- 📋 **Single Policy System**: Same policies enforce both transaction types
- 💰 **Budget Tracking**: Combined spending across shopping and services
- ✅ **Approval Workflow**: Manager approval for high-value transactions
- 🔒 **Multi-User**: Isolated accounts, budgets, wallets per user

### **Agent-to-Agent (x402)**
- ⚡ **Micropayments**: USDC payments on Solana (~ $0.10-0.50 per service)
- 🔐 **x402 Protocol**: Payment-required handshake for agent services
- 💼 **Auto Wallet**: Solana wallets created automatically when needed
- 📊 **Agent Registry**: Discover and request services from registered agents

### **Technical Stack**
- 🐳 **Docker Ready** - Deploy anywhere
- 🔒 **Email Auth** - Secure user management
- 📊 **SQLite** - Lightweight, persistent storage
- 🌐 **Solana Web3** - Blockchain payments
- 💳 **Stripe** - Traditional payments

## 🚀 Quick Start - Local Testing with HTTPS Tunnel

### **Step 1: Start HTTPS Tunnel**

**Option A - Cloudflare (Easiest, no signup):**
```bash
cd /Users/cyrus19901/Repository/agentic-commerce
make tunnel          # Start docker + tunnel
make tunnel-url      # Copy this URL
make tunnel-db-setup # Setup database
```

**Option B - Ngrok (Requires account):**
```bash
# 1. Get token: https://dashboard.ngrok.com/get-started/your-authtoken
export NGROK_AUTHTOKEN=your_token_here

# 2. Start
make ngrok           # Start docker + ngrok
make ngrok-url       # Copy this URL
make ngrok-db-setup  # Setup database
```

### **Step 2: Configure ChatGPT**

1. Open `docs/gpt-action-schema-seamless.yaml`
2. Replace `https://your-tunnel-url.trycloudflare.com` with YOUR tunnel URL
3. Upload schema to ChatGPT GPT editor → Actions
4. Copy instructions from `docs/CHATGPT_INSTRUCTIONS_UNIFIED.md` → Instructions field

### **Step 3: Test**
```
"My email is test@example.com"
"Find notebooks under $30"
"Buy the first one"
"Scrape https://example.com"
```

**Note**: Tunnel URL changes each restart - update ChatGPT schema accordingly.

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
- **DB Viewer**: http://localhost:8080

### **Test Both Modes**

#### **Shopping (Agent-to-Merchant)**
```
"Find me a notebook under $30"
→ ChatGPT searches products
→ Policy check
→ Stripe checkout URL
→ Pay with credit card
```

#### **Services (Agent-to-Agent)**
```
"Scrape https://techcrunch.com"
→ ChatGPT creates Solana wallet (auto)
→ Policy check
→ Pays 0.1 USDC on Solana
→ Returns scraped data
```

**User Experience**: One ChatGPT, seamless routing, no payment method selection needed!

### Troubleshooting

**Docker not running?** See [DOCKER_SETUP.md](./DOCKER_SETUP.md)

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
│   ├── integrations/     # External APIs (Etsy client)
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

# Optional: Stripe payments
STRIPE_SECRET_KEY=your-stripe-key
```

### Default Policies

The system comes with two default policies:

1. **Monthly Budget**: $1,000 per month
2. **Transaction Limit**: $500 per transaction

To modify policies, edit `packages/database/src/setup.ts` and run:

```bash
make db-setup
```

## 📊 Database Viewer

Access the SQLite database viewer at http://localhost:8080 when running in dev mode.

View and query:
- `policies` - All configured policies
- `purchase_attempts` - Purchase history and policy checks

## 🔒 Security

- JWT tokens expire after 30 days
- CORS restricted to ChatGPT domains
- All endpoints require authentication
- Policies are enforced server-side

**Production Checklist:**
- [ ] Change `JWT_SECRET` in `.env`
- [ ] Use HTTPS for production deployment
- [ ] Update `ALLOWED_ORIGINS` with your domain
- [ ] Set up proper database backups
- [ ] Configure rate limiting
- [ ] Enable logging and monitoring

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

### Endpoints

#### `POST /api/products/search`
Search for products

```json
{
  "query": "leather notebook",
  "max_price": 50,
  "limit": 10
}
```

#### `POST /api/policy/check`
Check if purchase is allowed

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
Get spending summary

```json
{
  "user_id": "user-123"
}
```

#### `POST /api/checkout/initiate`
Start checkout process

```json
{
  "user_id": "user-123",
  "product_id": "prod-456",
  "amount": 35.99
}
```

#### `POST /api/checkout/complete`
Complete purchase

```json
{
  "session_id": "session_123",
  "user_id": "user-123"
}
```

## 🧪 Testing

Test the API directly:

```bash
# Get your token
TOKEN=$(docker-compose exec api npm run generate-token user-123 | grep "Token:" | cut -d' ' -f2)

# Test health endpoint
curl http://localhost:3000/health

# Test search
curl -X POST http://localhost:3000/api/products/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"leather","max_price":50}'

# Test policy check
curl -X POST http://localhost:3000/api/policy/check \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"user-123","product_id":"mock-1","price":35.99,"merchant":"ArtisanLeatherCo"}'
```

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

## 📚 Documentation

- **[Quick Start Guide](./docs/QUICK_START.md)** - Get started in 5 minutes
- **[Seamless Commerce Solution](./docs/SEAMLESS_COMMERCE_SOLUTION.md)** - Complete architecture guide
- **[ChatGPT Instructions](./docs/CHATGPT_INSTRUCTIONS_UNIFIED.md)** - ChatGPT configuration
- **[OpenAPI Schema](./docs/gpt-action-schema-seamless.yaml)** - API specification
- **[Solana Implementation](./docs/SOLANA_WALLET_VERIFICATION.md)** - Wallet & ATA verification
- **[Testing Guide](./docs/TEST_ON_GPT.md)** - Test scenarios

## ✅ Implementation Status

**Completed**:
- ✅ Dual-mode commerce (Stripe + Solana)
- ✅ Unified policy engine with `transactionType` support
- ✅ Agent-to-agent transactions via x402 protocol
- ✅ Solana USDC micropayments
- ✅ Auto wallet creation
- ✅ Spending tracking across both transaction types
- ✅ Approval workflow for Stripe purchases
- ✅ Multi-user with isolated wallets and budgets

**Future Enhancements**:
- [ ] Approval workflow for agent-to-agent services
- [ ] Real-time policy updates
- [ ] Advanced agent discovery and pricing
- [ ] Multi-chain support (Ethereum, Polygon)
- [ ] Analytics dashboard

## ⭐ Support

If you find this project helpful, please give it a star on GitHub!

---

Built with ❤️ using TypeScript, Express, and ChatGPT
