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

# ── Stage 1: production dependencies (prebuilt native binaries, no compile) ───
FROM node:26-slim AS deps

# No build toolchain (TMCP is a python-free zone). Native deps install via
# `--ignore-scripts` (see the pnpm install line below) — every one ships or resolves
# a PREBUILT binary, so nothing compiles and no python/make/g++/git is needed.

# corepack was removed from Node.js distributions in v25+; install pnpm directly.
# Version pinned to match package.json "packageManager".
RUN npm install -g pnpm@11.9.0

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# --ignore-scripts: every native dependency ships/resolves a PREBUILT binary
# (onnxruntime-node bundles its .node, sharp uses @img/sharp-<platform>, opusscript
# is pure JS), so no build script needs to run. This keeps the image python-free
# (no node-gyp), avoids onnxruntime's cmake/git source fallback, and is more secure
# (no arbitrary install scripts). pnpm 11 would otherwise hard-fail with
# ERR_PNPM_IGNORED_BUILDS on unapproved build scripts.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ── Stage 2: TypeScript build ─────────────────────────────────────────────────
FROM node:26-slim AS build

# No build toolchain — prebuilt native binaries only (see Stage 1 note). tsc is
# pure JS and needs no python/make/g++.

# corepack was removed from Node.js distributions in v25+; install pnpm directly.
# Version pinned to match package.json "packageManager".
RUN npm install -g pnpm@11.9.0

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# --ignore-scripts (see Stage 1): no build scripts run; the build below is pure
# tsc (no esbuild/vite needed), so prebuilt binaries are sufficient.
RUN pnpm install --frozen-lockfile --ignore-scripts

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

# Prod node_modules (prebuilt native binaries from stage 1 — no compilation)
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
