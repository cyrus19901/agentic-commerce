# Use docker compose (v2) or docker-compose (v1)
DOCKER_COMPOSE := $(shell command -v docker-compose 2> /dev/null || echo "docker compose")

.PHONY: help build up down logs shell db-setup generate-token clean restart dev dev-down check-docker

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

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
	$(DOCKER_COMPOSE) logs -f api

shell: ## Open shell in API container
	$(DOCKER_COMPOSE) exec api sh

db-setup: ## Setup database with default policies
	$(DOCKER_COMPOSE) exec api npm run db:setup

generate-token: ## Generate JWT token (usage: make generate-token USER=user-123)
	@$(DOCKER_COMPOSE) exec api npm run generate-token $(or $(USER),user-123)

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
	$(DOCKER_COMPOSE) -f docker-compose.dev.yml exec api sh

status: ## Show container status
	$(DOCKER_COMPOSE) ps

db-viewer: ## Start database viewer
	$(DOCKER_COMPOSE) --profile tools up -d db-viewer
	@echo "✓ DB Viewer at http://localhost:8080"

