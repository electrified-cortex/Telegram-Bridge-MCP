# 10-3035 — Restore memory/telegram/session.token path in session/start and ONBOARDING_TOKEN_SAVE

## Status
done

## Context
The PR diff (release/7.15.0 vs master) showed two regressions where specific path guidance
was changed to vague placeholders. Both restored to the specific path.

## Changes made

### 1. src/tools/session/start.ts — 3 locations (lines 286, 356, 629)
Changed: `save_token_to: "<private-file-in-your-workspace>"`
To:      `save_token_to: "memory/telegram/session.token"`

### 2. src/service-messages.ts — ONBOARDING_TOKEN_SAVE.text
Changed: `e.g. a private file in your workspace`
To:      `e.g. \`memory/telegram/session.token\``

### 3. src/tools/session/start.test.ts
- SAVE_TOKEN_PATH constant updated to "memory/telegram/session.token"
- it() description strings updated to match
- All 3 assertions pass via the constant

## Verification

- Commit: `7b94b7a4` on `release/7.15.0`
- Tests: 3907/3907 PASS
- `git diff master...release/7.15.0 -- src/service-messages.ts src/tools/session/start.ts`
  shows ONLY the hint text changes from 10-3032 — no save_token_to or ONBOARDING regressions ✓
- Delegation: foreman-direct

## Outcome
PASS — awaiting Overseer push gate with 10-3032 and 10-3033
