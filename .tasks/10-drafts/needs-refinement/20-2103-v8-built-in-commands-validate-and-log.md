---
Created: 2026-05-27
Status: backlog
Priority: medium-high
Source: 2026-05-27 refactor scan
---

# built-in-commands.ts — Add validateText and dlog to catch blocks

## Problem

`src/built-in-commands.ts` (1590 lines) has two related issues:

1. **No text length validation** before `sendMessage` / `editMessageText` calls in panel handlers (lines 85–504). If text exceeds Telegram limits, API rejects silently.
2. **50+ silent `catch { /* ignore */ }` blocks** throughout the file. Real errors (network, rate-limit, permission) vanish with no diagnostic signal.

## Action

1. Add `validateText()` (or equivalent length check) before every `sendMessage` call in the panel handlers.
2. Replace silent `catch { /* ignore */ }` blocks with `catch { dlog(...) }` at minimum — keep them non-fatal but make them visible.
3. Focus on the `/logging`, `/voice`, `/governor`, `/approve`, `/shutdown` panel sections (lines 85–1590).

## Notes

- `dlog()` is the existing debug logger — use it, don't add a new logging dependency.
- Cosmetic Telegram operations (delete, edit) should stay non-fatal but should log.
- Text validation: Telegram's hard limit is 4096 chars for messages, 1024 for captions.

## Acceptance Criteria

- [ ] No `sendMessage` / `editMessageText` call in panel handlers is missing pre-send length validation.
- [ ] No `catch { /* ignore */ }` without at least one `dlog()` call inside.
- [ ] Existing tests pass; new tests for length-exceeded path added.

## Overseer bounce (2026-06-01)
- verdict: REJECT — 3 structural gaps
- finding: (1) dlog not imported in built-in-commands.ts — worker has no import guidance or DebugCategory values. (2) validateText utility referenced but does not exist in codebase. (3) No automated way to enforce catch-block dlog AC. Missing agent_type and model_class.
- action: Add dlog import guidance + DebugCategory values, clarify whether to create validateText or use inline comparison, add lint rule or test strategy for catch-block AC, add frontmatter.
