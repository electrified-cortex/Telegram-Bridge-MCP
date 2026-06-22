# Sanitize + TMCP build wiring (already in place for containers)

**Captured:** 2026-05-24 (PT)
**Source:** operator voice msgs 60945, 60947

---

## Verbatim — msg 60945

> Yeah, we have a problem there. There's supposed to be some sort of script that you run to make sure that all of the CRLFs are gone. So when the pods boot up, they actually succeed. I think we need to be careful about pre-start because pre-start is kind of one of those weird things that... What if there's something wrong, you know? But... Let's not do it. Let's just make it so that... Before we launch a pod, there's a PMPM build. Can you just do that? Yeah.

## Verbatim — msg 60947

> Right, sanitize. Okay. Well, we should definitely have that. Does that run before we start the pod or what?

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
- **Host pods (Curator, Agent):** rely on git autocrlf for CRLF safety, and on operator manually managing host TMCP lifecycle.

## What operator might still want

- Host-side `start-bridge.sh` equivalent that wraps the host TMCP launch — gives parity with containerized pods.
- A `sanitize.sh` runner for host pods' spawn.sh — defensive, even though autocrlf is the primary defense.

## Recommendation

Tell operator: containers already do what she's asking. If she wants host parity, propose a single host `start-bridge.sh` + a sanitize-call in host spawn.sh. Two small additions.
