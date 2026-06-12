# 055 — Lazy poller: start/stop with session lifecycle

## Problem

The poller starts unconditionally at server boot (`index.ts` line 93) and runs forever regardless of active sessions. When multiple MCP instances share a bot token (e.g. two VS Code windows), **idle instances consume and discard Telegram updates**, causing message loss for the active instance.

The server already detects this via update ID gap warnings, but by then the updates are permanently gone.

## Solution

Start the poller lazily when the first session connects. Stop it when the last session disconnects. An MCP instance with zero sessions never polls, never consumes updates.

## Changes

### A. `src/index.ts`

Remove the `startPoller()` call from the boot sequence (line 93). The poller will be started on-demand.

### B. `src/poller.ts`

Export `isPollerRunning()` if not already exported (it exists — verify).

### C. `src/tools/session_start.ts`

After creating the session, check `activeSessionCount()`. If it just went from 0 → 1, call `startPoller()`.

```ts
import { startPoller, isPollerRunning } from "../poller.js";
// ...
if (!isPollerRunning()) startPoller();
```

### D. `src/tools/close_session.ts`

After closing the session, check `activeSessionCount()`. If it drops to 0, call `stopPoller()`.

```ts
import { stopPoller } from "../poller.js";
import { activeSessionCount } from "../session-manager.js";
// ...
if (activeSessionCount() === 0) stopPoller();
```

### E. `src/shutdown.ts`

Verify shutdown still calls `stopPoller()` — it should already. No change expected.

### F. Tests

- Add test: poller is not running at boot (verify `isPollerRunning()` returns false initially).
- Add test: `session_start` starts poller when first session connects.
- Add test: `close_session` stops poller when last session disconnects.
- Add test: poller survives when one of multiple sessions closes (only stops on last).

## Acceptance criteria

- [ ] `pnpm build` clean
- [ ] `pnpm test` — all pass, no regressions
- [ ] `pnpm lint` clean
- [ ] Poller does not start at boot
- [ ] Poller starts on first `session_start`
- [ ] Poller stops on last `close_session`
- [ ] Multiple sessions: poller runs until all are closed
- [ ] `changelog/unreleased.md` updated

## Files

| File | Action |
|---|---|
| `src/index.ts` | Remove `startPoller()` call |
| `src/tools/session_start.ts` | Start poller on first session |
| `src/tools/close_session.ts` | Stop poller on last session |
| `src/poller.ts` | Verify `isPollerRunning` exported |
| `src/shutdown.ts` | Verify stopPoller still called |
| Tests | New test coverage |
| `changelog/unreleased.md` | Document change |

## Completion

**Date:** 2026-03-22

### Changes made

| File | Change |
|---|---|
| `src/index.ts` | Removed `startPoller` from import and removed `startPoller()` boot call + log line |
| `src/tools/session_start.ts` | Added `import { startPoller, isPollerRunning }` from poller; added `if (!isPollerRunning()) startPoller()` after `setActiveSession()` |
| `src/tools/close_session.ts` | Added `stopPoller` import from poller; added `activeSessionCount` to session-manager import; added `if (activeSessionCount() === 0) stopPoller()` before `refreshGovernorCommand()` |
| `src/poller.ts` | No change — `isPollerRunning()` already exported |
| `src/shutdown.ts` | No change — shutdown already calls `stopPoller()` |
| `src/tools/session_start.test.ts` | Added `startPoller`/`isPollerRunning` mocks and 2 new poller lifecycle tests |
| `src/tools/close_session.test.ts` | Added `stopPoller`/`activeSessionCount` mocks and 3 new poller lifecycle tests |
| `changelog/unreleased.md` | Added `Changed` entry |

### Results

- `pnpm build`: clean
- `pnpm lint`: clean
- `pnpm test`: **1698 / 1698 passed** (91 test files, no regressions)
- 5 new tests added (2 in session_start, 3 in close_session)

