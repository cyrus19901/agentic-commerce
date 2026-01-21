# ⚡ START HERE - Quick Setup Guide

## Current Status: Docker Not Running ⚠️

Your Agentic Commerce project is ready, but Docker needs to be started.

## 🚨 Action Required

### Step 1: Start Docker Desktop

**macOS:**
1. Open **Docker Desktop** from Applications folder
2. Wait for the whale icon to appear in the menu bar
3. Click the icon - it should say "Docker Desktop is running"

**Windows:**
1. Open **Docker Desktop** from Start Menu
2. Wait for it to fully start
3. Check system tray - Docker icon should be steady (not animated)

**Linux:**
```bash
sudo systemctl start docker
```

### Step 2: Verify Docker is Running

```bash
cd /Users/cyrus19901/Repository/agentic-commerce
./scripts/verify-setup.sh
```

This will check:
- ✓ Docker installed
- ✓ Docker running
- ✓ Ports available
- ✓ Configuration files

### Step 3: Start Your Application

Once Docker is running:

```bash
# Automated setup (recommended)
./scripts/quick-start.sh

# This will:
# - Build Docker images
# - Start containers
# - Setup database
# - Generate JWT token
```

**Or manually:**

```bash
make dev              # Start containers
make db-setup         # Setup database
make generate-token   # Generate auth token
```

## ✅ Verification

After starting, verify everything works:

```bash
# Check services are running
make status

# Test API health
curl http://localhost:3000/health

# Should return: {"status":"healthy"}

# Run full test suite
./scripts/test-api.sh
```

## 🎯 What You'll Have

Once running:

| Service | URL | Purpose |
|---------|-----|---------|
| API | http://localhost:3000 | Main REST API |
| Health | http://localhost:3000/health | Status check |
| DB Viewer | http://localhost:8080 | View database |

## 📝 Next Steps After Starting

1. **Copy your JWT token** (shown after quick-start.sh)
2. **Configure ChatGPT GPT**:
   - Go to https://chat.openai.com/gpts/editor
   - Follow instructions in `docs/chatgpt-gpt-config.md`
   - Use your JWT token for authentication
3. **Test in ChatGPT**: "Find me a leather notebook under $50"

## 🆘 Troubleshooting

### Docker Desktop Not Installed?

**macOS:**
```bash
brew install --cask docker
```

Or download from: https://www.docker.com/products/docker-desktop

**Windows:**
Download from: https://www.docker.com/products/docker-desktop

**Linux:**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

### Docker Won't Start?

1. Restart your computer
2. Check Docker Desktop settings
3. Ensure virtualization is enabled in BIOS (Windows/Linux)
4. Check Docker Desktop logs for errors

### Port Already in Use?

```bash
# Find what's using port 3000
lsof -ti:3000

# Kill it
lsof -ti:3000 | xargs kill -9

# Or change port in .env
echo "PORT=3001" >> .env
```

### Still Having Issues?

```bash
# Check Docker status
docker info

# View detailed logs
make dev-logs

# Clean everything and restart
make clean
make dev
```

## 📚 Documentation

- **[GETTING_STARTED.md](./GETTING_STARTED.md)** - Detailed setup guide
- **[DOCKER_SETUP.md](./DOCKER_SETUP.md)** - Docker troubleshooting
- **[README.md](./README.md)** - Full documentation
- **[docs/chatgpt-gpt-config.md](./docs/chatgpt-gpt-config.md)** - ChatGPT configuration

## 🎬 Quick Command Reference

```bash
# Verify setup
./scripts/verify-setup.sh

# Start everything
./scripts/quick-start.sh

# View logs
make dev-logs

# Stop services
make dev-down

# Restart
make restart

# Test API
./scripts/test-api.sh

# Generate new token
make generate-token USER=user-123

# Help
make help
```

## 📊 Project Structure

```
agentic-commerce/
├── packages/
│   ├── api/              # Express REST API
│   ├── core/             # Policy Service
│   ├── database/         # SQLite DB
│   ├── integrations/     # Etsy Client
│   └── shared/           # Types & Utils
├── scripts/
│   ├── quick-start.sh    # Automated setup
│   ├── verify-setup.sh   # Check prerequisites
│   └── test-api.sh       # Test endpoints
├── docs/
│   └── chatgpt-gpt-config.md  # GPT configuration
├── docker-compose.dev.yml     # Dev environment
├── Dockerfile.dev             # Dev image
├── Makefile                   # Convenient commands
└── .env                       # Configuration
```

## ✨ Features

- 🤖 ChatGPT-powered shopping assistant
- 🔍 Product search (mock Etsy data included)
- 📋 Automatic policy enforcement
- 💰 Budget tracking (daily/weekly/monthly)
- ⚡ Express checkout flow
- 🔒 JWT authentication
- 🐳 Docker containerized
- 📊 SQLite database with viewer

## 🎯 Default Policies

Your system includes:
- **Monthly Budget**: $1,000 maximum
- **Transaction Limit**: $500 per purchase

These are enforced automatically!

## 💡 Tips

1. **Always check Docker is running** before starting
2. **Save your JWT token** - you'll need it for ChatGPT
3. **Use make commands** - they're easier than docker compose
4. **Check logs** if something doesn't work: `make dev-logs`
5. **Test locally first** before deploying to production

---

## 🚀 Ready to Start?

1. ✅ Start Docker Desktop
2. ✅ Run `./scripts/verify-setup.sh`
3. ✅ Run `./scripts/quick-start.sh`
4. ✅ Configure ChatGPT GPT
5. ✅ Start shopping!

**Questions?** Check the docs or run `make help`

**Let's get started!** 🎉

