---
Created: 2026-04-07
Status: Draft
Host: local
Priority: 10-365
Source: Operator
---

# MCP startup should log transport mode

## Objective

When the Telegram MCP starts without `--http`, the startup logs show no indication of what transport mode is active. The HTTP path clearly logs `MCP Streamable HTTP server listening on ...`, but the stdio path produces zero transport-related output. The operator couldn't tell if the server started in stdio mode or silently failed.

## Context

In `src/index.ts` lines ~206–209, the stdio branch just connects without logging:

```typescript
} else {
  // ── stdio mode (original behavior) ──
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

The HTTP branch (line ~203) logs clearly:

```typescript
process.stderr.write(`[info] MCP Streamable HTTP server listening on http://127.0.0.1:${mcpPort}/mcp\n`);
```

## Acceptance Criteria

- [x] stdio mode logs a startup message to stderr (e.g., `[info] MCP stdio transport connected`)
- [x] Message appears after successful `server.connect(transport)` call
- [x] No stdout pollution (stderr only — stdout is the stdio transport channel)

## Completion

**Branch:** `10-365` | **Commit:** `f37d459`

### What changed (2 files)

- **`src/index.ts`** — Added `process.stderr.write("[info] MCP stdio transport connected\n")` after `server.connect(transport)` in the stdio branch. Matches `[info]` prefix and `process.stderr.write` pattern used by HTTP branch.
- **`src/action-registry.ts`** — Removed redundant `Promise<unknown> |` from `ActionHandler` return type (pre-existing lint error, same fix as 10-485/10-488).

### Notes

- No test added: top-level `await` startup code requires full process-spawn harness to test; absence accepted by Code Reviewer.
- Code review: Clean — no findings.
- 2201 tests pass.
