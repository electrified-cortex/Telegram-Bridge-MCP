---
Created: 2026-04-08
Status: Draft
Host: local
Priority: 20
Source: Codex swarm review finding 6
---

# Test Coverage Gaps — High-Risk Branches

## Problem

Missing test coverage on error/edge-case branches identified by Codex review:

1. **Voice chunk partial failure** (send.ts) — when TTS succeeds for first N
   chunks but fails mid-sequence, behavior is untested
2. **VOICE_RESTRICTED mapping** (send.ts) — when TTS is disabled and audio is
   requested, error path coverage
3. **Approval cleanup timeout** (session_start.ts) — pending approval timeout
   and cleanup paths

## Scope

Add targeted branch tests for each identified gap. No implementation changes —
tests only.

## Verification

- [ ] Voice chunk partial-failure test added
- [ ] VOICE_RESTRICTED test added
- [ ] Approval timeout cleanup test added
- [ ] All existing tests still pass
- [ ] Build, lint, test green
