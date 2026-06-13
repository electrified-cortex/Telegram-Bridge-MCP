---
id: 05-0831
title: wire attachHookRoutes(app) into src/index.ts
priority: 5
status: queued
type: feature-wire-up
delegation: any
---

# Wire attachHookRoutes into src/index.ts

`attachHookRoutes(app)` is exported from `src/hook-animation.ts:132` but is never called. As a result, `POST /hook/animation` is unreachable even though the handler is fully implemented.

## Work

In `src/index.ts`:

1. Add import: `import { attachHookRoutes } from "./hook-animation.js";`
2. Call `attachHookRoutes(app)` immediately after the Express app is configured (before `app.listen`). The call site is around line 226.

## Acceptance criteria

- `POST /hook/animation` responds correctly with a valid token (token auth already coded in `hook-animation.ts`).
- Existing tests still pass.
- Build clean (`pnpm build` no errors).
- Commit and push branch. Merge to dev when done.

## Notes

- Bridge restart is deferred — operator schedules. Goal is to have the route wired and proven via build; live test against the running bridge happens after restart.
- Do not change `hook-animation.ts` or token auth logic — only the wiring in `src/index.ts`.

## Activity Log

- **2026-04-25** — Pipeline started. Variant: Implement-only.
- **2026-04-25** — [Stage 4] Task Runner dispatched. 1 file changed (`src/index.ts`): import + call site + HTTP-mode comment.
- **2026-04-25** — [Stage 5] Verification: tsc clean, 2780 tests pass.
- **2026-04-25** — [Stage 6] Code Reviewer ×2. Round 1: 3 major (2 pre-existing in hook-animation.ts filed as 05-0832/05-0833, 1 in-scope comment fix). Round 2: clean.
- **2026-04-25** — [Stage 7] Complete. Branch: 05-0831. Ready for Overseer review.

## Completion

Wired `attachHookRoutes(app)` into `src/index.ts`. `POST /hook/animation` is now reachable when the bridge runs in HTTP mode.

**Changes (`src/index.ts`):**
- Import: `import { attachHookRoutes } from "./hook-animation.js";`
- Call site before `app.listen` with comment: `// POST /hook/animation — only available in HTTP mode (requires Express app)`

**Subagent passes:** Task Runner ×2, Code Reviewer ×2.

**Final review:** 0 critical, 0 major, 0 minor — clean.

**Pre-existing issues noted (filed separately):** rate limiting absent on hook route (05-0832); array query param coercion to NaN in hook-animation.ts (05-0833).

**Tests:** 2780 passing (unchanged).
