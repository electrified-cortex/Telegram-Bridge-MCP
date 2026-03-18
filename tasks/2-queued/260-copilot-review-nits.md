# Fix Copilot Review Nits (batch)

**Type:** Code Quality
**Priority:** 260 (Low — cleanup batch)
**Source:** Copilot PR review #3 + #4 (2026-03-18)

## Description

Low-priority items from Copilot reviews. Bundle into one task.

### From Review #3

#### 1. `get_debug_log.ts` zod import

Uses `import { z } from "zod/v4"` — should be `import { z } from "zod"` for consistency.

#### 2. `rename_session.ts` regex constant

Inline regex should be extracted to a named module-level constant.

#### 3. `rename_session.ts` error code mismatch

Uses `NAME_TAKEN` but central `TelegramErrorCode` has `NAME_CONFLICT`. Standardize.

#### 4. `routing-mode.ts` stale doc comment

Module comment says "only governor supported" but we have 3 routing modes.

### From Review #4

#### 5. `server.ts:72-73` — `any[]` escape hatch

`CallableCb` type uses `(...a: any[]) => unknown` with an eslint-disable comment. Replace with a proper typed signature or add a justification comment explaining why `any` is necessary here.

#### 6. `get_debug_log.ts:20` — z.enum cast pattern

`z.enum(CATEGORIES as unknown as [string, ...string[]])` — double-cast through `unknown`. Fix by declaring `CATEGORIES` as `[string, ...string[]]` or use a const assertion that satisfies zod's tuple requirement.

#### 7. `send_message.test.ts:40-41` — duplicate mock setup

`mocks.validateSession.mockReturnValue(true)` appears twice in sequence. Remove the duplicate.

#### 8. `docs/multi-session-flow.md:11` — stale credentials claim

Line 11 says "Tools accept optional `sid`/`pin` but never require them." This contradicts the current implementation where all tools require identity. Update to reflect mandatory identity.

#### 9. PR #40 description — stale DM permission claim

PR body references the old directional DM permission model. Update to match current "all sessions can DM each other — implicit" design.

## Code Path

- `src/tools/get_debug_log.ts` — fix import + z.enum cast
- `src/tools/rename_session.ts` — extract regex, fix error code
- `src/routing-mode.ts` — update module doc comment
- `src/server.ts` — fix or justify `any[]`
- `src/tools/send_message.test.ts` — remove duplicate mock line
- `docs/multi-session-flow.md` — fix stale credentials claim
- PR #40 description (GitHub) — update DM permission wording

## Acceptance Criteria

- [ ] zod import uses `"zod"` not `"zod/v4"`
- [ ] Regex extracted to named constant
- [ ] Error code standardized to `NAME_CONFLICT`
- [ ] Module doc updated to reflect 3 routing modes
- [ ] `server.ts` `any[]` either replaced or justified with comment
- [ ] `get_debug_log.ts` z.enum cast cleaned up
- [ ] Duplicate mock line removed from `send_message.test.ts`
- [ ] `multi-session-flow.md` credentials claim corrected
- [ ] PR #40 description updated on GitHub
- [ ] Reply to all related Copilot comments on GitHub PR
- [ ] Build passes, lint clean, all tests pass
- [ ] `changelog/unreleased.md` updated
