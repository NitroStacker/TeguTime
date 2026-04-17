# syntax=docker/dockerfile:1.6

# ---- deps ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Build tools in case a native module (better-sqlite3) needs to compile
# from source instead of using its prebuilt binary.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Non-root user + writable data dir for SQLite (backed by a persistent volume)
RUN useradd --create-home --uid 1001 bot \
    && mkdir -p /data \
    && chown -R bot:bot /data

COPY --from=deps --chown=bot:bot /app/node_modules ./node_modules
COPY --chown=bot:bot package*.json ./
COPY --chown=bot:bot src ./src

ENV NODE_ENV=production \
    DATABASE_PATH=/data/timezones.db

USER bot
CMD ["node", "src/index.js"]
