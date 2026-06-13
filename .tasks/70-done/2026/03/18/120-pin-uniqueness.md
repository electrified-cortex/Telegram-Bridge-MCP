# Ensure PIN Uniqueness Across Live Sessions

**Type:** Hardening
**Priority:** 120 (High)

## Description

When generating PINs for new sessions, verify the generated PIN is not already in use by another live session. A collision would allow one session's agent to authenticate as another.

## Current Behavior

- `createSession()` generates a random PIN
- No check against existing live session PINs
- Collision is statistically unlikely (6-digit PIN, few sessions) but not impossible

## Desired Behavior

- After generating a PIN, check it against all active sessions
- If collision detected, regenerate
- Loop until unique (with a safety cap to avoid infinite loops)

## Code Path

- `src/session-manager.ts` — `createSession()`, PIN generation logic

## Acceptance Criteria

- [ ] PIN generation checks against all live session PINs
- [ ] Collision triggers regeneration
- [ ] Safety cap prevents infinite loop (e.g., max 10 attempts, then error)
- [ ] Test: mock a collision scenario, verify regeneration
- [ ] Build passes, lint clean, all tests pass
- [ ] `changelog/unreleased.md` updated
