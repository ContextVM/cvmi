FROM oven/bun:alpine

WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy application code
COPY . .

# Environment variables
ENV SERVER_PRIVATE_KEY=""
ENV RELAYS="wss://relay.contextvm.org,wss://cvm.otherstuff.ai"
ENV LOG_LEVEL="info"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD bun run healthcheck.ts || exit 1

# Run as non-root user
USER bun

CMD ["bun", "run", "server.ts"]
