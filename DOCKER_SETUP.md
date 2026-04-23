# Docker Setup

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop) (macOS / Windows) or Docker Engine (Linux)
- `make` (pre-installed on macOS/Linux; on Windows use WSL2)

Verify Docker is running:
```bash
docker info
```

---

## Which compose file to use?

| File | Use case |
|------|----------|
| `docker-compose.dev.yml` | Local development with hot-reload (SQLite path, source mounts) |
| `docker-compose.postgres.yml` | Local dev against a real **PostgreSQL 16** database |
| `docker-compose.yml` | Production-like build (no source mounts) |
| `docker-compose.ngrok.yml` | Expose API via ngrok for ChatGPT Actions testing |
| `docker-compose.tunnel.yml` | Expose API via Cloudflare Tunnel |

---

## Local Development (PostgreSQL — recommended)

```bash
# 1. Copy env
cp .env.production.example .env
# Fill in DATABASE_URL (postgres), JWT_SECRET, etc.

# 2. Start Postgres + API
docker compose -f docker-compose.postgres.yml up -d

# 3. Run migrations and seed
docker compose -f docker-compose.postgres.yml exec api npm run db:migrate
docker compose -f docker-compose.postgres.yml exec api npm run db:seed

# 4. Verify
curl http://localhost:3001/health
```

Expected:
```json
{"status":"healthy","db":"connected"}
```

---

## Without Docker (bare Node.js)

```bash
# Requires: Node 20+, PostgreSQL 14+ running locally
cp .env.production.example .env
npm install
npm run build
npm run db:migrate
npm run db:seed
npm run dev        # http://localhost:3001
```

---

## Useful Commands

### Containers
```bash
make dev            # Start docker-compose.dev.yml
make dev-down       # Stop dev containers
make dev-logs       # Tail logs
make dev-shell      # Shell into the api container
make restart        # Restart all containers
make status         # Container status
```

### Database
```bash
npm run db:migrate  # Apply pending migrations
npm run db:seed     # Seed default policies and demo org
npm run db:rollback # Roll back the last migration
```

### Build & Clean
```bash
npm run build       # Compile all packages
npm run clean       # Remove node_modules + dist
make clean          # Remove Docker containers, volumes, images
```

---

## Your First API Call

```bash
# Health
curl http://localhost:3001/health

# Execute a payment (sandbox mode — no real TX)
curl -X POST http://localhost:3001/api/v1/payments/execute \
  -H 'X-API-Key: ak_test_sandbox_key_2024' \
  -H 'Content-Type: application/json' \
  -d '{"provider":"zyte","action":"scrape","params":{"url":"https://example.com"}}'
```

---

## Troubleshooting

### Port already in use
```bash
lsof -ti:3001 | xargs kill -9
```

### Migrations fail
Ensure `DATABASE_URL` is set and PostgreSQL is reachable:
```bash
psql "$DATABASE_URL" -c "SELECT 1"
```

### Container won't start
```bash
make dev-logs   # or:
docker compose -f docker-compose.postgres.yml logs api
```

### Full reset
```bash
make clean
docker volume prune -f
# Then redo setup from step 1
```

---

## Tunnel / ChatGPT Testing

```bash
# ngrok
docker compose -f docker-compose.ngrok.yml up -d

# Cloudflare Tunnel
docker compose -f docker-compose.tunnel.yml up -d
```

Set the tunnel URL as the server URL in your ChatGPT Action schema (`docs/gpt-action-schema-seamless.yaml`).
