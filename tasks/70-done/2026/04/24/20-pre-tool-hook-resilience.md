---
Created: 2026-04-08
Status: Draft
Host: local
Priority: 20
Source: Codex swarm review finding 2
---

# Pre-Tool Hook Resilience — Circuit Breaker

## Problem

The global pre-tool hook in `tool-hooks.ts` is fail-closed: if the hook throws,
the tool call is blocked. A transient hook defect becomes a total control-plane
outage (all tools blocked).

## Investigation Needed

1. Verify current error handling in `invokePreToolHook`
2. Determine if hook errors are already caught/logged
3. Assess whether a circuit-breaker pattern is justified

## Possible Solution

- Scoped fail-closed: high-risk tools (session_start, approve) stay fail-closed
- Low-risk tools (send, dequeue, help) fail-open on hook errors
- Circuit breaker: after N consecutive hook failures, bypass hook temporarily
- All hook errors logged with severity

## Verification

- [ ] Investigation confirms actual risk level
- [ ] Tests cover hook failure scenarios
- [ ] Build, lint, test green

## Completion

Investigation: `invokePreToolHook` was already fail-closed with error logging. Production hook (`buildDenyPatternHook`) is pure/synchronous — current risk zero. Latent risk: future hooks doing I/O. Circuit breaker omitted (no current risk to justify the complexity).

**Changes:**
- `src/tool-hooks.ts`: discriminated union `PreToolHookResult` with `hookError?: true`; set in catch block; `FAIL_CLOSED_TOOLS` constant with rationale; non-null assertion on `compiled[i]!`.
- `src/server.ts`: removed dead try/catch; fail-open branch — hook errors on non-`FAIL_CLOSED_TOOLS` tools log `[hook:error]` (sanitized via `normalizeLogField`) and allow call to proceed.
- `src/tool-hooks.test.ts`: two new tests for `hookError` discriminator.

Build/lint/test: all pass (2602 tests). Code review: 2 substantive passes.
Follow-up: server-level integration tests for fail-open/fail-closed; `logBlockedToolCall` module coupling; `console.error` toolName sanitization (requires shared utility).

Branch: `pre-tool-hook`
