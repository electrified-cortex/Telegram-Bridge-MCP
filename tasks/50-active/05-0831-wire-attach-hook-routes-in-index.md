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
