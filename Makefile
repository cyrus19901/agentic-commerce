# Use docker compose (v2) or docker-compose (v1)
DOCKER_COMPOSE := $(shell command -v docker-compose 2> /dev/null || echo "docker compose")

.PHONY: help build up down logs shell db-setup generate-token clean restart dev dev-down check-docker tunnel tunnel-url ngrok ngrok-url

help: ## Show this help message
	@echo '🛍️  Agentic Commerce - Local Testing with HTTPS Tunnel'
	@echo ''
	@echo '🚀 Quick Start (ChatGPT Testing):'
	@echo ''
	@echo '  1. Start tunnel:'
	@echo '     make tunnel              → Cloudflare (free, no signup)'
	@echo '     make ngrok               → Ngrok (requires token)'
	@echo ''
	@echo '  2. Get URL:'
	@echo '     make tunnel-url          → Copy your HTTPS URL'
	@echo '     make ngrok-url           → Copy your HTTPS URL'
	@echo ''
	@echo '  3. Setup:'
	@echo '     make tunnel-db-setup     → Initialize database'
	@echo '     make ngrok-db-setup      → Initialize database'
	@echo ''
	@echo '  4. Update ChatGPT schema with your URL and test!'
	@echo ''
	@echo '📚 All Commands:'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

check-docker: ## Check if Docker is running
	@docker info > /dev/null 2>&1 || (echo "❌ Docker is not running. Please start Docker Desktop." && exit 1)
	@echo "✓ Docker is running"

build: check-docker ## Build Docker images
	$(DOCKER_COMPOSE) build

up: check-docker ## Start containers in production mode
	$(DOCKER_COMPOSE) up -d
	@echo "✓ API running at http://localhost:3000"
	@echo "✓ Health check: http://localhost:3000/health"

down: ## Stop and remove containers
	$(DOCKER_COMPOSE) down

logs: ## View container logs
	$(DOCKER_COMPOSE) logs -f agentic-commerce-api

shell: ## Open shell in API container
	$(DOCKER_COMPOSE) exec agentic-commerce-api sh

db-setup: ## Setup database with default policies
	$(DOCKER_COMPOSE) exec agentic-commerce-api npm run db:setup

generate-token: ## Generate JWT token (usage: make generate-token USER=user-123)
	@$(DOCKER_COMPOSE) exec agentic-commerce-api npm run generate-token $(or $(USER),user-123)

clean: ## Remove containers, volumes, and images
	$(DOCKER_COMPOSE) down -v --rmi all
	rm -rf data/*.db data/*.db-journal

restart: ## Restart containers
	$(DOCKER_COMPOSE) restart

dev: check-docker ## Start in development mode with hot reload
	$(DOCKER_COMPOSE) -f docker-compose.dev.yml up -d
	@echo "✓ Dev API running at http://localhost:3000"
	@echo "✓ DB Viewer at http://localhost:8080"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Wait for containers to start (check with: make dev-logs)"
	@echo "  2. Setup database: make db-setup"
	@echo "  3. Generate token: make generate-token USER=user-123"

dev-down: ## Stop development containers
	$(DOCKER_COMPOSE) -f docker-compose.dev.yml down

dev-logs: ## View development logs
	$(DOCKER_COMPOSE) -f docker-compose.dev.yml logs -f

dev-shell: ## Open shell in dev container
	$(DOCKER_COMPOSE) -f docker-compose.dev.yml exec agentic-commerce-api sh

status: ## Show container status
	$(DOCKER_COMPOSE) ps

db-viewer: ## Start database viewer
	$(DOCKER_COMPOSE) --profile tools up -d db-viewer
	@echo "✓ DB Viewer at http://localhost:8080"

tunnel: check-docker ## Start with Cloudflare tunnel (HTTPS for ChatGPT)
	@echo "🚀 Starting with Cloudflare tunnel..."
	$(DOCKER_COMPOSE) -f docker-compose.tunnel.yml up -d
	@echo ""
	@echo "✓ API started"
	@echo "⏳ Waiting for tunnel URL..."
	@sleep 5
	@echo ""
	@echo "🔗 Your HTTPS tunnel URL:"
	@$(DOCKER_COMPOSE) -f docker-compose.tunnel.yml logs cloudflared 2>&1 | grep -o "https://[a-z0-9-]*\.trycloudflare\.com" | head -1 || echo "   Run 'make tunnel-url' to get the URL"
	@echo ""
	@echo "📋 Next steps:"
	@echo "  1. Copy the HTTPS URL above"
	@echo "  2. Run: make tunnel-db-setup"
	@echo "  3. Update ChatGPT schema with your tunnel URL"
	@echo "  4. Test with ChatGPT!"

tunnel-url: ## Get current tunnel URL
	@echo "🔗 Cloudflare Tunnel URL:"
	@$(DOCKER_COMPOSE) -f docker-compose.tunnel.yml logs cloudflared 2>&1 | grep -o "https://[a-z0-9-]*\.trycloudflare\.com" | head -1

tunnel-logs: ## View tunnel logs
	$(DOCKER_COMPOSE) -f docker-compose.tunnel.yml logs -f

tunnel-down: ## Stop tunnel
	$(DOCKER_COMPOSE) -f docker-compose.tunnel.yml down

tunnel-shell: ## Open shell in tunnel API container
	$(DOCKER_COMPOSE) -f docker-compose.tunnel.yml exec agentic-commerce-api sh

tunnel-db-setup: ## Setup database in tunnel environment
	$(DOCKER_COMPOSE) -f docker-compose.tunnel.yml exec agentic-commerce-api npm run db:setup

tunnel-restart: ## Restart tunnel environment
	$(DOCKER_COMPOSE) -f docker-compose.tunnel.yml restart

ngrok: check-docker ## Start with ngrok tunnel (HTTPS for ChatGPT) - requires NGROK_AUTHTOKEN
	@if [ -z "$$NGROK_AUTHTOKEN" ]; then \
		echo "❌ NGROK_AUTHTOKEN not set"; \
		echo ""; \
		echo "Get your token from: https://dashboard.ngrok.com/get-started/your-authtoken"; \
		echo "Then run: export NGROK_AUTHTOKEN=your_token_here"; \
		echo "Or add it to .env file"; \
		exit 1; \
	fi
	@echo "🚀 Starting with ngrok tunnel..."
	$(DOCKER_COMPOSE) -f docker-compose.ngrok.yml up -d
	@echo ""
	@echo "✓ API started"
	@echo "⏳ Waiting for ngrok tunnel..."
	@sleep 3
	@echo ""
	@echo "🔗 Your HTTPS tunnel URL:"
	@curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"https://[^"]*"' | grep -o 'https://[^"]*' | head -1 || echo "   Run 'make ngrok-url' to get the URL"
	@echo ""
	@echo "🌐 Ngrok Dashboard: http://localhost:4040"
	@echo ""
	@echo "📋 Next steps:"
	@echo "  1. Copy the HTTPS URL above"
	@echo "  2. Run: make ngrok-db-setup"
	@echo "  3. Update ChatGPT schema with your ngrok URL"
	@echo "  4. Test with ChatGPT!"

ngrok-url: ## Get current ngrok URL
	@echo "🔗 Ngrok Tunnel URL:"
	@curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"https://[^"]*"' | grep -o 'https://[^"]*' | head -1

ngrok-logs: ## View ngrok logs
	$(DOCKER_COMPOSE) -f docker-compose.ngrok.yml logs -f

ngrok-down: ## Stop ngrok
	$(DOCKER_COMPOSE) -f docker-compose.ngrok.yml down

ngrok-shell: ## Open shell in ngrok API container
	$(DOCKER_COMPOSE) -f docker-compose.ngrok.yml exec agentic-commerce-api sh

ngrok-db-setup: ## Setup database in ngrok environment
	$(DOCKER_COMPOSE) -f docker-compose.ngrok.yml exec agentic-commerce-api npm run db:setup

ngrok-restart: ## Restart ngrok environment
	$(DOCKER_COMPOSE) -f docker-compose.ngrok.yml restart

