---
created: 2026-06-28
status: draft
priority: 20
source: TMCP V8 quality audit swarm wave 2, 2026-06-28
repo: electrified-cortex/Telegram-Bridge-MCP
type: TechDebt
severity: low
dimension: Timer cleanup
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# TMCP Overhaul: GET /mcp keepalive timer missing try-finally (inconsistent with POST pattern)

**ID**: 30-9101
**Date**: 2026-06-28
**Dimension**: Timer cleanup
**File**: `D:/Users/essence/Development/cortex.lan/electrified-cortex/Telegram-Bridge-MCP/src/index.ts`

## Problem

The GET /mcp handler (lines 243-250) sets up a keepalive timer and clears it only via res.on("close"). If transport.handleRequest throws before the response is fully established, the close event may never fire, leaving the timer running indefinitely. The POST /mcp handler at lines 226-230 already wraps the same pattern in try-finally, making the GET handler inconsistent. The practical blast radius is mitigated because the timer's guard condition (res.headersSent && !res.writableEnded && !res.destroyed) causes it to silently no-op once the response is in a terminal state, so this is a resource leak rather than an active error source. It is worth fixing for consistency and defensive correctness, but severity is low, not medium.

## Offending Code

```typescript
res.on("close", () => { clearInterval(keepaliveTimer); });

    await transport.handleRequest(req, res);
```

## Fix

No change to the suggested fix. It is minimal, correct, and exactly mirrors the POST /mcp handler at lines 226-230.

## Verification Notes

The finding is real and verified against the actual source. Lines 248-250 show res.on("close", ...) with no try-finally, while lines 226-230 in the POST handler already apply the pattern the finding recommends. The gap is genuine: an exception from transport.handleRequest on GET would bypass the close event cleanup, leaving a dangling setInterval. The severity downgrade from medium to low is warranted because the timer's own guard conditions (writableEnded, destroyed) prevent it from writing to a dead response — it leaks memory/CPU cycles but does not cause active failures.

## Acceptance Criteria

- [ ] Issue resolved per fix description
- [ ] `tsc --noEmit` passes
- [ ] All pre-existing tests pass

## Delegation

Executor: Worker / Reviewer: Curator

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-28
- Verdict: PASS — ACs binary and testable, scope bounded (single targeted fix per file), delegation correct (Worker/Curator), self-contained fix with explicit location. PASS.

## Verification

- Verifier: af31579d24e59a7f6
- Date: 2026-06-27
- Verdict: APPROVED — try-finally confirmed at GET /mcp handler in src/index.ts; mirrors POST handler pattern exactly. tsc clean. 4005/4005 tests pass.
- Sealed-By: Foreman, squash commit f2e0adb4547e81b3e768f1bdca4fb08d136e6d9e, tests 4005/4005
