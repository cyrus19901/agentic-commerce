# 🛍️ Agentic Commerce - ChatGPT Shopping Assistant

A complete ChatGPT-powered shopping assistant with policy enforcement, product search, and express checkout capabilities. Built with Express, TypeScript, and SQLite.

## ✨ Features

- 🤖 **ChatGPT Integration** - Natural conversation-based shopping
- 🔍 **Product Search** - Search Etsy products (with mock data for testing)
- 📋 **Policy Enforcement** - Automatic budget and transaction limit checking
- 💰 **Spending Tracking** - Daily, weekly, and monthly spending reports
- ⚡ **Express Checkout** - Quick purchase flow
- 🐳 **Docker Ready** - Run anywhere with Docker
- 🔒 **JWT Authentication** - Secure API access
- 📊 **SQLite Database** - Lightweight and portable

## 🚀 Quick Start (5 Minutes)

### Prerequisites

- **Docker Desktop** installed and running ([Install Guide](./DOCKER_SETUP.md))
- **ChatGPT Plus** subscription (for creating custom GPTs)

### Option 1: Automated Setup (Recommended)

```bash
cd /Users/cyrus19901/Repository/agentic-commerce

# Run the quick start script
./scripts/quick-start.sh
```

This will:
- ✅ Check Docker installation
- 📝 Create .env file
- 🔨 Build Docker images
- 🚀 Start containers
- 📦 Setup database
- 🔑 Generate JWT token

**Copy the JWT token** from the output - you'll need it for ChatGPT!

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

### Configure ChatGPT GPT

1. Go to https://chat.openai.com/gpts/editor
2. Click **Create a GPT**
3. Follow the detailed instructions in [`docs/chatgpt-gpt-config.md`](./docs/chatgpt-gpt-config.md)
4. Add your JWT token to the authentication settings
5. Use `http://localhost:3000` as the API URL (or your deployed URL)

### Test It!

In your ChatGPT GPT, try:
- "Find me a leather notebook under $50"
- "What's my spending this month?"
- "Show me handmade jewelry"

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

## 📚 Additional Resources

- [ChatGPT GPT Configuration Guide](./docs/chatgpt-gpt-config.md)
- [Architecture Documentation](./docs/architecture.md)
- [Policy Configuration](./docs/policies.md)
- [API Reference](./docs/api-reference.md)

## 💡 What's Next?

- [ ] Add real Etsy API integration
- [ ] Implement Stripe payment processing
- [ ] Add webhook support for order updates
- [ ] Create admin dashboard for policy management
- [ ] Add multi-tenant support
- [ ] Implement caching layer
- [ ] Add comprehensive test suite
- [ ] Set up CI/CD pipeline

## ⭐ Support

If you find this project helpful, please give it a star on GitHub!

---

Built with ❤️ using TypeScript, Express, and ChatGPT
