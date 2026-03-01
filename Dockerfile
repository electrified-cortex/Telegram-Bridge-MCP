# syntax=docker/dockerfile:1

# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

# pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Install dependencies (cached layer)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Compile TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Production deps only
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Compiled output
COPY --from=build /app/dist ./dist

# Behaviour / resource files read at runtime
COPY BEHAVIOR.md COMMUNICATION.md FORMATTING.md SETUP.md LOOP-PROMPT.md ./

# Model cache directory — mount a volume here to persist downloaded weights
# e.g. docker run -v telegram-mcp-cache:/root/.cache ...
ENV XDG_CACHE_HOME=/root/.cache

# MCP over stdio — no port needed
CMD ["node", "dist/index.js"]
