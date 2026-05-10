# syntax=docker/dockerfile:1

# Node.js Version Selection: v24 (Krypton - Active LTS until Feb 24, 2026)
# 
# Rationale:
# - v24 is the latest Active LTS version with the most recent security patches
# - All stable LTS versions (v20, v22, v24) share identical critical CVEs as of Jan 2026:
#   * CVE-2025-55131: Buffer allocation race conditions (High)
#   * CVE-2025-55130: Permission model bypass via symlinks (High)
#   * CVE-2025-59465: HTTP/2 malformed HEADERS crash (High)
# - v24 provides the best security posture: latest patches applied first, longest remaining support
# - slim variant reduces image size by excluding documentation and man pages
#
# Security awareness:
# - OS package upgrades applied in runtime stage (line 39) to patch system-level CVEs
# - Pin exact versions in production when feasible; v24.13.0+ includes Jan 2026 security patches
# - Monitor nodejs-sec mailing list: https://groups.google.com/forum/#!forum/nodejs-sec

# ── Stage 1: production dependencies (native modules compiled here) ───────────
FROM node:26-slim AS deps

# Build tools needed for native modules (onnxruntime-node, opusscript, sharp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ── Stage 2: TypeScript build ─────────────────────────────────────────────────
FROM node:26-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN pnpm build

# ── Stage 3: runtime (no build tools, no dev deps, non-root) ─────────────────
FROM node:26-slim AS runtime

# Patch all OS packages to eliminate known CVEs
RUN apt-get update && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Prod node_modules (pre-compiled native modules from stage 1)
COPY --from=deps /app/node_modules ./node_modules

# Compiled JS output
COPY --from=build /app/dist ./dist

# Resource files read at runtime by the MCP server
COPY docs/communication.md docs/formatting.md docs/setup.md ./docs/
COPY docs/help/ ./docs/help/
COPY LOOP-PROMPT.md ./
COPY package.json ./

# Cache dir for Whisper/TTS model weights — mount a volume here to persist
# e.g. docker run -v telegram-mcp-cache:/home/node/.cache ...
ENV XDG_CACHE_HOME=/home/node/.cache

# Run as non-root
USER node

# MCP over stdio — no port needed
CMD ["node", "dist/index.js"]
