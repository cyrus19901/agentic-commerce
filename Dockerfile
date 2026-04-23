# Multi-stage build for efficient image size
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY packages/integrations/package.json ./packages/integrations/
COPY packages/core/package.json ./packages/core/
COPY packages/api/package.json ./packages/api/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build packages in dependency order: shared -> database -> integrations -> core -> api
# (core imports types from integrations, so integrations must be built first)
RUN npm run build --workspace=@agentic-commerce/shared && \
    npm run build --workspace=@agentic-commerce/database && \
    npm run build --workspace=@agentic-commerce/integrations && \
    npm run build --workspace=@agentic-commerce/core && \
    npm run build --workspace=@agentic-commerce/mcp-server && \
    npm run build --workspace=@agentic-commerce/api

# Production stage
FROM node:20-alpine

RUN apk add --no-cache wget

WORKDIR /app

# Copy built artifacts and dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages ./packages

# Copy entrypoint script
COPY scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Expose port
EXPOSE 3001

# Health check with longer timeout for cold starts
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start the application
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npm", "start"]
