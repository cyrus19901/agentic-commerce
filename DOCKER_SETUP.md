# 🐳 Docker Setup Guide

## Prerequisites

### 1. Install Docker Desktop

**macOS:**
```bash
# Download from: https://www.docker.com/products/docker-desktop
# Or install with Homebrew:
brew install --cask docker
```

**Windows:**
- Download from: https://www.docker.com/products/docker-desktop
- Run the installer
- Restart your computer

**Linux:**
```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
# Log out and back in

# Start Docker
sudo systemctl start docker
sudo systemctl enable docker
```

### 2. Start Docker Desktop

**macOS/Windows:**
- Open Docker Desktop from Applications/Start Menu
- Wait for Docker to start (whale icon in menu bar/system tray)
- Verify it's running: `docker info`

**Linux:**
```bash
sudo systemctl start docker
docker info
```

## Quick Start (Automated)

Once Docker is running, use the automated script:

```bash
cd /Users/cyrus19901/Repository/agentic-commerce
./scripts/quick-start.sh
```

This script will:
1. ✅ Check Docker installation and status
2. 📝 Create .env file if needed
3. 🔨 Build Docker images
4. 🚀 Start containers
5. 📦 Setup database with default policies
6. 🔑 Generate JWT token for testing

## Manual Setup

If you prefer manual control:

### Step 1: Prepare Environment

```bash
cd /Users/cyrus19901/Repository/agentic-commerce

# Copy environment file
cp .env.example .env

# (Optional) Edit configuration
nano .env
```

### Step 2: Build Images

```bash
# Using make (recommended)
make build

# Or directly with docker compose
docker compose -f docker-compose.dev.yml build
```

### Step 3: Start Containers

```bash
# Development mode (with hot reload)
make dev

# Or directly
docker compose -f docker-compose.dev.yml up -d
```

### Step 4: Setup Database

```bash
make db-setup

# Or directly
docker compose -f docker-compose.dev.yml exec api npm run db:setup
```

### Step 5: Generate Token

```bash
make generate-token USER=user-123

# Or directly
docker compose -f docker-compose.dev.yml exec api npm run generate-token user-123
```

## Verify Installation

### Check Services

```bash
# Check container status
make status

# View logs
make dev-logs

# Test API
curl http://localhost:3000/health
```

Expected response:
```json
{"status":"healthy"}
```

### Test Endpoints

```bash
# Get your token
TOKEN="your-generated-token-here"

# Search products
curl -X POST http://localhost:3000/api/products/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"leather","max_price":50}'

# Check policy
curl -X POST http://localhost:3000/api/policy/check \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id":"user-123",
    "product_id":"mock-1",
    "price":35.99,
    "merchant":"ArtisanLeatherCo"
  }'

# Get spending
curl -X POST http://localhost:3000/api/policy/spending \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"user-123"}'
```

## Useful Commands

### Container Management

```bash
make dev              # Start development containers
make dev-down         # Stop development containers
make dev-logs         # View logs
make dev-shell        # Open shell in container
make restart          # Restart containers
make status           # Show container status
```

### Database

```bash
make db-setup         # Setup/reset database
make db-viewer        # Start database viewer (port 8080)
```

### Cleanup

```bash
make clean            # Remove everything (containers, volumes, images)
make dev-down         # Just stop containers
```

## Troubleshooting

### Docker Not Running

**Error:** `Cannot connect to the Docker daemon`

**Solution:**
1. Open Docker Desktop
2. Wait for it to fully start
3. Check status: `docker info`
4. Try again

### Port Already in Use

**Error:** `port is already allocated`

**Solution:**
```bash
# Find process using port 3000
lsof -ti:3000

# Kill the process
lsof -ti:3000 | xargs kill -9

# Or change PORT in .env
echo "PORT=3001" >> .env
```

### Build Fails

**Error:** Build errors or timeouts

**Solution:**
```bash
# Clean Docker cache
docker system prune -a

# Rebuild
make build
```

### Database Locked

**Error:** `database is locked`

**Solution:**
```bash
# Stop containers
make dev-down

# Remove volumes
docker volume rm agentic-commerce_data

# Restart and setup
make dev
make db-setup
```

### Container Won't Start

**Solution:**
```bash
# Check logs
make dev-logs

# Check container status
docker compose -f docker-compose.dev.yml ps

# Restart
make restart
```

### Permission Denied

**Linux only:**

```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in
# Or run with sudo
sudo make dev
```

## Development Workflow

### Hot Reload Development

The dev setup includes hot reload:

1. Start containers: `make dev`
2. Edit files in `packages/*/src/`
3. Changes auto-reload in container
4. View logs: `make dev-logs`

### Accessing the Database

```bash
# Option 1: Use DB Viewer (GUI)
make db-viewer
# Open http://localhost:8080

# Option 2: Use SQLite CLI
make dev-shell
sqlite3 /app/data/shopping.db
```

### Debugging

```bash
# Open shell in container
make dev-shell

# Check environment
env | grep -E 'PORT|JWT|DATABASE'

# Test database
npm run db:setup

# Generate token manually
npm run generate-token test-user
```

## Production Deployment

### Build Production Image

```bash
docker compose build
```

### Run Production Container

```bash
# Start
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f api
```

### Environment Variables

For production, update `.env`:

```bash
NODE_ENV=production
JWT_SECRET=your-secure-random-secret-here
PORT=3000
DATABASE_URL=/app/data/shopping.db
ALLOWED_ORIGINS=https://your-domain.com,https://chat.openai.com
```

## Docker Compose Files

### docker-compose.dev.yml
- Development environment
- Hot reload enabled
- Source code mounted
- DB viewer included
- Debug logging

### docker-compose.yml
- Production environment
- Optimized image
- No source mounting
- Health checks
- Restart policies

## Resource Limits

Default limits are generous. To restrict:

```yaml
# Add to docker-compose.yml under services.api
deploy:
  resources:
    limits:
      cpus: '0.5'
      memory: 512M
    reservations:
      cpus: '0.25'
      memory: 256M
```

## Next Steps

1. ✅ Verify all services are running
2. 📝 Configure ChatGPT GPT (see `docs/chatgpt-gpt-config.md`)
3. 🧪 Test the API endpoints
4. 🚀 Deploy to production (Railway, Render, Fly.io)

## Support

- Check logs: `make dev-logs`
- View README: `README.md`
- ChatGPT config: `docs/chatgpt-gpt-config.md`
- Open an issue on GitHub

---

Need help? Run `make help` to see all available commands.

