# ── builder ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Native module build deps (required by better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Generate Prisma client
RUN node_modules/.bin/prisma generate

COPY . .
RUN npm run build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache python3 make g++
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Install production deps (includes prisma + better-sqlite3, rebuilt for this image)
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev

# Re-generate Prisma client in runner stage
RUN node_modules/.bin/prisma generate

# Copy built Next.js output
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Entrypoint
COPY docker/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

RUN mkdir -p /data && chown -R appuser:appgroup /app /data
USER appuser

EXPOSE 3000

# /data is the volume mount point for the SQLite database
VOLUME ["/data"]

CMD ["./docker-entrypoint.sh"]
