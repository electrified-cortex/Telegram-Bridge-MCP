---
Created: 2026-04-03
Status: Completed
Priority: 10
Source: Operator directive (voice) + Overseer request
Repo: electricessence/Telegram-Bridge-MCP
Branch target: dev
Breaking: true (major version bump)
---

# 10-201: Identity Token Redesign — Single Integer Auth

## Summary

Replace the `identity: [sid, pin]` tuple with a single integer token across all
MCP tools. This eliminates array parsing, string-coercion bugs, and agent
confusion. Major version bump required.

## Motivation

The current `[SID, PIN]` array format causes friction:
- Agents frequently coerce to strings, causing type errors (10-178 added
  defensive parsing)
- Array syntax is clunky in tool calls: `"identity": [1, 692554]`
- Agents must track two values and remember to combine them correctly
- String coercion edge cases required dedicated error handling code

With a single integer, agents just pass one number: `"token": 1692554`

## Encoding

```
token = sid * 1_000_000 + pin
```

| SID | PIN | Token |
|-----|-----|-------|
| 1 | 692554 | 1692554 |
| 4 | 981408 | 4981408 |
| 10 | 500000 | 10500000 |

### Constraints
- **PINs:** 6-digit integers, range 100000–999999 (current behavior)
- **SIDs:** Auto-incrementing from 1, no upper bound in practice
- **PIN floor of 100000 is critical:** Prevents ambiguity (PIN 001234 with
  SID 1 → token 1001234, which could be SID 100 + PIN 1234 if PIN < 100000)
- **JS number safety:** Tokens up to SID 9007199 are safe (2^53 precision).
  In practice, SIDs rarely exceed single digits.

### Decoding
```typescript
function decodeToken(token: number): { sid: number; pin: number } {
  const pin = token % 1_000_000;
  const sid = Math.floor(token / 1_000_000);
  return { sid, pin };
}
```

## Changes Required

### Bridge Side
1. **`session_start` return value:** Return `{ token: 1692554 }` instead of
   `{ sid: 1, pin: 692554 }`
2. **All tool schemas:** Replace `identity: [number, number]` parameter with
   `token: number` parameter across all 50+ tools
3. **Token validation:** Centralize decode + validate (SID exists, PIN matches)
4. **Remove 10-178 workarounds:** String coercion handling, error messages about
   array format — all obsolete
5. **Backward compatibility:** Consider accepting both formats during transition
   (optional — could just break cleanly with major version)

### Agent Side
1. **Agent instructions:** Update all references from `identity: [sid, pin]`
   to `token: <number>`
2. **Spawn scripts:** Update to parse single token from `session_start` response
3. **Session files:** Store `token` instead of separate `sid` + `pin`
4. **Human-readable display:** Tell agents "Your token is 1692554 (SID 1)"

### Documentation
1. **Changelog:** Major version entry documenting the breaking change
2. **README / Quick Start:** Update examples
3. **Agent guide:** Update identity section

## Self-Describing Tokens

When presenting tokens to agents, include the breakdown:
```
Your session token is 4981408 (SID 4, PIN 981408).
Use this single number for all tool calls.
```

This helps agents understand what they're holding without having to decode.

## Acceptance Criteria

- [x] `session_start` returns `{ token: number }` instead of `{ sid, pin }`
- [x] All 50+ tool schemas updated to accept `token: number`
- [x] Central token decode/validate function
- [x] 10-178 string coercion workarounds removed
- [x] All existing tests updated
- [x] New tests for token encode/decode edge cases
- [x] Changelog entry for major version bump
- [x] Agent guide updated
- [x] Quick start guide updated

## Migration Path

**Option A — Clean break (recommended):**
Major version bump. All tools accept only `token`. Agents must update.
Simple, clean, no legacy code.

**Option B — Transitional:**
Accept both `token` (new) and `identity` (old) for one minor version.
Emit deprecation warnings for `identity`. Remove in next major.

## Reversal Plan

Revert to `identity: [sid, pin]` format. Re-add 10-178 string coercion handling.

## Completion

**Branch:** `10-201`
**Commits:** `66fb5b9`, `f2bbc8b`
**All 1790 tests pass.**

### Code Review Summary
- **Reviewer:** Code Reviewer subagent (2 rounds)
- **Round 1 findings:** 1 Major, 3 Minor, 2 Info
- **Round 2 findings:** APPROVED — Major finding resolved, no new issues

### What was done
- All 50+ tool schemas updated: `identity: [number, number]` → `token: number`
- `session_start` returns `{ token, sid, pin, ... }` with self-describing breakdown
- Central `decodeToken()` in `identity-schema.ts`, `requireAuth()` in `session-gate.ts`
- 10-178 string coercion workarounds removed
- All test files updated; new edge-case tests for encode/decode
- `package.json` bumped to `5.0.0`
- `changelog/2026-04-03_v5.0.0.md` added
- `AGENTS.md`, `README.md`, `docs/multi-session-flow.md` updated

### Minor findings (noted, not blocking)
- Stale comments in `dequeue_update.test.ts` (lines 562, 716) referencing old param shape
- Spurious `identity` key in mock data in `send_direct_message.test.ts` and `route_message.test.ts`
- Indentation anomaly in `send_message.ts` line 67
