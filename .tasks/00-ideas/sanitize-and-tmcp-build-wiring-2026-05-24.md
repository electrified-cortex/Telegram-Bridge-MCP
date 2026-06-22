# Sanitize + TMCP build wiring (already in place for containers)

**Captured:** 2026-05-24 (PT)
**Source:** operator voice msgs 60945, 60947

---

## Context — msgs 60945, 60947

The operator flagged two concerns: (1) a sanitize script should run to strip CRLFs before pod boot to prevent startup failures, and (2) a build step (`pnpm build`) should run before launching a pod. The operator was cautious about adding a `prestart` hook due to potential failure modes but wanted the build step enforced before pod launch. A follow-up confirmed the sanitize step was already expected and asked whether it ran before pod start.

---

## Current state — both concerns already wired for containers

**docker-compose.yml (in each `- pod-spaces/<container>/`):**

- `bridge` service command: `sh /workspace/sanitize.sh; exec bash /workspace/start-bridge.sh` — sanitize then start TMCP bridge
- `pod` service command: `sh /workspace/sanitize.sh; exec bash spawn.sh` — sanitize then spawn claude pod
- `pod depends_on bridge` (healthcheck-gated)

**sanitize.sh** (one per container dir): strips CRLF from every `.sh` under `/workspace`, wipes stale `.pid`, reaps stray `tail -f` watchers.

**start-bridge.sh** (one per container dir): `rm -rf node_modules; pnpm install --frozen-lockfile; pnpm build; node dist/index.js --http 3098`. Already rebuilds on every container start.

## Host TMCP (port 3099) — not auto-wired

The `.mcp.json` at host root points at `http://127.0.0.1:3099/mcp`. No `start-bridge.sh` exists for the host. Operator presumably runs `pnpm build && pnpm start` manually in `electrified-cortex/Telegram-Bridge-MCP/` to start the host bridge. No automatic rebuild.

## Gap analysis

- **Container pods:** fully covered. sanitize runs before spawn AND before bridge; bridge rebuilds every start.
- **Host pods:** rely on git autocrlf for CRLF safety, and on operator manually managing host TMCP lifecycle.

## What operator might still want

- Host-side `start-bridge.sh` equivalent that wraps the host TMCP launch — gives parity with containerized pods.
- A `sanitize.sh` runner for host pods' spawn.sh — defensive, even though autocrlf is the primary defense.

## Recommendation

Containers already do what the operator is asking. If host parity is desired, propose a single host `start-bridge.sh` + a sanitize-call in host spawn.sh. Two small additions.
