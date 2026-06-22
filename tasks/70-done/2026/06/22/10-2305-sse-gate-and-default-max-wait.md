---
Created: 2026-06-10
Status: stamped-pass
Gate: PASS (R21 — 2026-06-10)
Priority: 10
Target: 7.10.0
Delegation: foreman → worker
Branch: worker/10-2305-sse-gate-max-wait
Dev-branch: dev-7.10.0
Spec: tasks/10-drafts/notification-wake-contract-SPEC.md §5-c
Depends-on: 10-2303 (must be merged to dev-7.10.0 first)
---

# 10-2305: SSE/Listen Path Under Gate + 90 s Default max_wait (§5-c)

## Problem

`notifySseSubscriber(sid)` at `src/sse-endpoint.ts:24` is a **raw `res.write("data: kick\n\n")`** — no debounce, no lockout check, no cancel-on-drain. It is called from:
- `session-queue.ts:253, 287, 458, 539, 576, 616, 642` — 7 direct call sites
- `reminder-state.ts:129` — via `_notifySseSubscriber` injection (set by `initReminderSseNotify` called from `index.ts`)

And `fireRevaluationNotify` at `file-state.ts:256` is a direct file touch with no SSE notification — so even the re-evaluation path misses SSE.

An agent using SSE receives N raw writes for N events. File-monitor agents receive one debounced touch. "Both monitors behave identically" is false today.

Also: no mechanism today to set a 90 s default `max_wait` when an agent opens an SSE connection. Reference implementation: `src/channel.ts:52-57`.

## Design

### 1. Make `notifyIfAllowed` return `boolean`

Modify `notifyIfAllowed` in `src/tools/activity/file-state.ts:303` to return `boolean`. Make the following changes to that function:

1. Change the function signature at line 307 from `: void` to `: boolean`.
2. Change every suppression exit to `return false;` (currently bare `return;`). Exact changes:
   - Line 309: `if (!entry) return;` → `if (!entry) return false;`
   - Line 312: `if (!classify(source, inflightAtEnqueue)) return;` → `if (!classify(source, inflightAtEnqueue)) return false;`
   - Line 315: `if (entry.inflightDequeue) return;` → `if (entry.inflightDequeue) return false;`
   - Lines 318-321 (`touchInFlight` branch): `entry.notifyPendingBecauseLocked = true; return;` → `entry.notifyPendingBecauseLocked = true; return false;`
   - Lines 325-328 (`lockout active` branch): `entry.notifyPendingBecauseLocked = true; return;` → `entry.notifyPendingBecauseLocked = true; return false;`
3. At step 5 (after `void doTouchWithRollback(sid, entry);` at line 334), add `return true;` — the function currently falls off the end (returns `undefined`); this makes it explicitly return `true` when the touch was initiated.

All existing callers use `void` — adding a return value is backward compatible (no call sites break).

### 2. Create `notifySession(sid, source, inflightAtEnqueue)` in `src/tools/notify.ts`

```ts
// src/tools/notify.ts
import { notifyIfAllowed } from "./activity/file-state.js";
import { notifySseSubscriber } from "../sse-endpoint.js";

export function notifySession(
  sid: number,
  source: NotifySource,
  inflightAtEnqueue: boolean,
): void {
  if (notifyIfAllowed(sid, source, inflightAtEnqueue)) {
    notifySseSubscriber(sid);
  }
}
```

This is the ONLY place that calls both paths. The boolean return value from `notifyIfAllowed` gates the SSE call. `NotifySource` is exported from `file-state.ts` (line 84) — import it directly: `import type { NotifySource } from "./activity/file-state.js";`. **Create this file** (`src/tools/notify.ts` does not exist today).

### 3. Replace paired call sites with `notifySession`

Every location that currently calls `notifyIfAllowed(sid, ...) + notifySseSubscriber(sid)` must be replaced with `notifySession(sid, ...)`. Affected locations:

**`src/session-queue.ts`** — ALL 7 call sites. At each site the current pattern is three consecutive calls: `notifyIfAllowed(...) + notifyChannelSubscriber(...) + notifySseSubscriber(...)`. Replace as follows: remove `notifyIfAllowed(...)` and `notifySseSubscriber(...)`, add `notifySession(sid, ...)` **before** `notifyChannelSubscriber(...)`. Result at each site: `notifySession(sid, ...) ; notifyChannelSubscriber(sid, event)`. **Note on ordering:** This moves SSE notification from after `notifyChannelSubscriber` to before it. This is **intentional** — SSE and channel are independent delivery mechanisms, and ordering between them has no behavioral impact. No code depends on SSE firing after channel notify.

Sites:
- Broadcast loop (~line 249-253): `notifySession(sid, "operator", isDequeueActive(sid))`
- `enqueueToSession` (line 278-288, SSE at 287): `notifySession(sid, "operator", isDequeueActive(sid))`
- `deliverDirectMessage` (~line 455, SSE at 458): `notifySession(targetSid, "operator", isDequeueActive(targetSid))`
- `deliverServiceMessage` (~line 537, SSE at 539): `notifySession(targetSid, "service", isDequeueActive(targetSid))`
- `deliverChildNotifyEvent` (~line 574, SSE at 576): `notifySession(parentSid, "service", isDequeueActive(parentSid))`
- `deliverReminderEvent` (SSE at 616): `notifySession(targetSid, "reminder", isDequeueActive(targetSid))`
- `routeMessage` (~line 639, SSE at 642): `notifySession(targetSid, "operator", isDequeueActive(targetSid))`

After replacement, grep confirms: zero `notifySseSubscriber` calls remain in `session-queue.ts`.

**`src/reminder-state.ts`** (sweep at lines 129-130):
The sweep body currently calls BOTH `_notifySseSubscriber?.(sid)` (line 129) AND `notifyIfAllowed(sid, "reminder", false)` (line 130). Replace BOTH lines with a single call:
```ts
notifySession(sid, "reminder", false);
```
Import `notifySession` directly from `"../tools/notify.js"`. This eliminates the `_notifySseSubscriber` injection entirely for `reminder-state.ts`. Remove:
- `initReminderSseNotify` export function (lines 26-28 of `reminder-state.ts`)
- `let _notifySseSubscriber: ((sid: number) => void) | null = null;` module-level variable (line 20 of `reminder-state.ts`)
- The call to `initReminderSseNotify` in `index.ts`

These are now dead code once `notifySession` is used directly.

**`fireRevaluationNotify` in `src/tools/activity/file-state.ts:256`**:
- Currently does a direct file touch with no SSE call. After this task, it must also notify SSE.
- Since `file-state.ts` cannot import `notifySseSubscriber` directly (circular: `file-state` → `sse-endpoint` → `session-queue` → `file-state`), use an injection pattern. In `src/tools/activity/file-state.ts`, add near the top of the module (after the existing imports, before the first exported function):
```ts
let _sseNotifyCallback: ((sid: number) => void) | null = null;

export function initSseNotifyCallback(fn: (sid: number) => void): void {
  _sseNotifyCallback = fn;
}
```
In `fireRevaluationNotify` (`src/tools/activity/file-state.ts:256`), add `_sseNotifyCallback?.(sid);` after `void doTouchWithRollback(sid, entry);` at **line 268**, before the closing `}` of the function at line 269. (`fireRevaluationNotify` has exactly one `void doTouchWithRollback` call — there is no ambiguity.) **Note:** `doTouchWithRollback` is async/fire-and-forget (`void` prefix); calling SSE synchronously before it completes is correct — SSE and file-touch are independent notification channels and SSE does not need to wait for the touch to confirm. The "at most once" invariant is satisfied by this path being called only from `releaseNotifyLockout` or the retry handler, both of which are gated by the lockout state machine.
- **Deferred SSE contract:** When `notifyIfAllowed` returns `false` (suppression steps 1–4), `notifySession` does NOT call SSE at that moment. The deferred paths are: (a) `touchInFlight` path sets `notifyPendingBecauseLocked = true`; when `doTouchWithRollback` completes it calls `releaseNotifyLockout` or the retry handler, which calls `fireRevaluationNotify` → `_sseNotifyCallback?.(sid)` → SSE fires once. (b) Lockout-active path: same — when lockout expires, `releaseNotifyLockout` → `fireRevaluationNotify` → SSE. In all suppression cases, SSE fires at most once via the deferred `fireRevaluationNotify` path. This is the "one notify per idle→busy transition" invariant. A worker does NOT need to add extra SSE calls for the suppression cases — the injection on `fireRevaluationNotify` covers them.

### 4. 90 s default `max_wait` on SSE connect, with restore on close

When an agent opens an SSE connection: **cap downward** — `getDequeueDefault` and `setDequeueDefault` operate in **seconds** (default is 300 s = 5 min). Add the following to `attachSseRoute` in `sse-endpoint.ts`, after the `_connections.set(sid, res)` call at line 79:

```ts
const priorDefault = getDequeueDefault(sid);
if (priorDefault > 90) {
  setDequeueDefault(sid, 90);
}
```

Add the restore inside the **existing** `req.on("close", ...)` handler at `sse-endpoint.ts:82` (the one that already calls `_connections.delete(sid)`). Add the restore call so the handler becomes:
```ts
req.on("close", () => {
  if (_connections.get(sid) === res) {
    _connections.delete(sid);
    if (priorDefault > 90) {
      setDequeueDefault(sid, priorDefault);
    }
    process.stderr.write(`[sse] connection closed sid=${sid}\n`);
  }
});
```

Add imports to `sse-endpoint.ts`: `import { getDequeueDefault, setDequeueDefault } from "./session-manager.js";` (these are exported from `session-manager.ts` at lines 319 and 328; they are already used in `channel.ts` — see `src/channel.ts:52-57` for the identical store-and-restore pattern).

## Acceptance Criteria

Test file placement: **AC-0** → `src/tools/notify.test.ts`; **AC-2** → `src/session-queue.test.ts`; **AC-10a/10b** → `src/sse-endpoint.test.ts` or `src/session-queue.test.ts`; **AC-11** → `src/tools/activity/file-state.test.ts` (uses real `file-state` module with `initSseNotifyCallback` spy injection). Use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` for time scenarios.

- [ ] **AC-0 (unit gate test in `src/tools/notify.test.ts`)**: Mock `notifyIfAllowed` to return `true` on the first call and `false` on all subsequent calls: `vi.mock('./activity/file-state.js', () => ({ notifyIfAllowed: vi.fn().mockReturnValueOnce(true).mockReturnValue(false) }))`. Mock `notifySseSubscriber`: `vi.mock('../sse-endpoint.js', () => ({ notifySseSubscriber: vi.fn() }))`. Call `notifySession(sid, "operator", false)` 10 times. Assert `notifyIfAllowed` was called exactly 10 times. Assert `notifySseSubscriber` was called exactly once (the one call where `notifyIfAllowed` returned `true`).
- [ ] **AC-2 (integration test in `src/session-queue.test.ts`)**: At top of test file: `vi.mock('./sse-endpoint.js', () => ({ notifySseSubscriber: vi.fn() }))` (path is correct from `src/session-queue.test.ts` — `sse-endpoint.ts` is at `src/sse-endpoint.ts`). Also `vi.mock('./tools/activity/file-state.js', () => ({ notifyIfAllowed: vi.fn().mockReturnValueOnce(true).mockReturnValue(false), isDequeueActive: vi.fn().mockReturnValue(false), setActivityFile: vi.fn(), getActivityFile: vi.fn() }))` — since `notifyIfAllowed` is fully mocked, `doTouchWithRollback` is never invoked and needs no separate mock. Call `deliverServiceMessage(sid, "msg", "test")` 10 times in a row with no dequeue between calls. Assert `notifySseSubscriber` was called exactly once across all 10 calls.
- [ ] **AC-10a**: Agent opens SSE connection when session dequeue default > 90 s. Assert default is capped to 90 s. Close connection. Assert prior default is restored.
- [ ] **AC-10b (no-op case)**: Agent opens SSE when default is already ≤ 90 s. Assert default unchanged.
- [ ] **AC-11 (SSE parity with file path)** — in `src/tools/activity/file-state.test.ts` using the **real** `file-state` module. Before each sub-test: call `initSseNotifyCallback(sseSpy = vi.fn())`. Register a sid via `setActivityFile(sid, makeState())` (using the existing `makeState()` helper at `file-state.test.ts:86` — do NOT inline the `ActivityFileState` fields manually, as `makeState()` already includes all required fields including `tmcpOwned`). For AC-3/AC-4: use `{ ...makeState(), notifyLockedUntil: ..., notifyPendingBecauseLocked: ..., touchInFlight: false }` as the override. Where `releaseNotifyLockout` triggers re-eval, use the **existing `queueMocks`** from the test file's `vi.mock('../../session-queue.js', ...)` declaration (already at line 52) — call `queueMocks.hasPendingUserContent.mockReturnValue(true)` in `beforeEach` or at the start of the test body. Do NOT add a second `vi.mock('../../session-queue.js', ...)` call. Note: `fireRevaluationNotify` calls `void doTouchWithRollback` (fire-and-forget) — the async file write may fail silently; test assertions run synchronously before it completes and are unaffected.
  - Parity check 1: 10 messages → 1 SSE write ✓ (covered by AC-2 in `session-queue.test.ts`)
  - **AC-3 equiv**: `setActivityFile(sid, { ...makeState(), notifyLockedUntil: Date.now() + 10_000, notifyPendingBecauseLocked: true, touchInFlight: false })`. Call `releaseNotifyLockout(sid)`. Assert `sseSpy` called exactly once. (Verifies: `releaseNotifyLockout` → `fireRevaluationNotify` → `_sseNotifyCallback?.(sid)`.)
  - **AC-4 equiv**: `setActivityFile(sid, { ...makeState(), notifyLockedUntil: null, notifyPendingBecauseLocked: false, touchInFlight: false })`. Call `releaseNotifyLockout(sid)`. Assert `sseSpy` called zero times (early-exit guard fires, no re-eval).
  - **AC-5/6/7 equiv BLOCKED on 10-2303 merge**: These three sub-tests require the `pendingReNotifyHandle` timer infrastructure from 10-2303. Mark them as `it.todo(...)` if 10-2303 is not yet merged; implement once 10-2303 is on `dev-7.10.0`:
    - AC-5 equiv: 5-min inactivity → exactly 1 re-notify SSE write (via `_sseNotifyCallback` injection on `fireRevaluationNotify`)
    - AC-6 equiv: queue drains before 5 min → no re-notify SSE write
    - AC-7 equiv: dequeue resets timer → fresh 5-min window, re-notify SSE write fires after new 5-min interval
- [ ] **`fireRevaluationNotify` now notifies SSE** (in `src/tools/activity/file-state.test.ts`): Before the test, call `initSseNotifyCallback(sseSpy)` where `sseSpy = vi.fn()`. Set up a sid entry via `setActivityFile(sid, ...)` with `notifyLockedUntil: Date.now() + 60_000` and `notifyPendingBecauseLocked: true` (simulating a suppressed notification during lockout). Call `releaseNotifyLockout(sid)`. Assert `sseSpy` was called exactly once with `sid`. This verifies `fireRevaluationNotify` → `_sseNotifyCallback?.(sid)` path.
- [ ] **`src/tools/notify.ts` exists**: file is present and exports `notifySession`. Verified by: file existence check + TypeScript type-checks clean.
- [ ] **`initReminderSseNotify` removed**: grep confirms no `initReminderSseNotify` in `reminder-state.ts` or `index.ts`. Command: `grep -r "initReminderSseNotify" src/` → zero matches.
- [ ] **`initSseNotifyCallback` wired**: `index.ts` calls `initSseNotifyCallback((sid) => notifySseSubscriber(sid))` (SSE-only — **not** `notifySession`, which would re-enter `notifyIfAllowed` after lockout release). Verified by grep: `grep "initSseNotifyCallback" src/index.ts` → at least one match present.
- [ ] **`notifyChannelSubscriber` import path**: confirm `notifyChannelSubscriber` is imported from `"./channel.js"` in `session-queue.ts` (it is an existing import — worker must not move or break it).
- [ ] **No raw paired `notifyIfAllowed + notifySseSubscriber` call sites** outside `notifySession`. Verified by grep: no `notifySseSubscriber` calls in `session-queue.ts` or `reminder-state.ts` outside of the injection callback.
- [ ] All existing SSE tests pass. No regression on file-monitor path.

## Out of Scope

- Multi-connection (concurrent SSE streams per SID) semantics.
- Per-profile configurable default `max_wait`.
- TMCP monitor liveness detection (20-backlog).
- Renaming `notifySseSubscriber` (keep the existing function; gate its call path).

## Notes

- **Depends on 10-2303**: `pendingReNotifyHandle` field + timer infrastructure must exist before AC-11 time scenarios can be implemented.
- AC-11 parity tests for AC-5/6/7 should reuse test helpers from 10-2303 if extracted to a shared fixture.
- 10-2304 has no dependency on this task; order doesn't matter relative to 10-2304.
