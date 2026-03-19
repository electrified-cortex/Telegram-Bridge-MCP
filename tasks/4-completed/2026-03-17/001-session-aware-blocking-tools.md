# Task 001 — Session-Aware Blocking Tools

## Problem

PR #40 review comments (7 of 16) flag that `confirm`, `choose`, and `ask` poll
from the **global** message-store queue, not the per-session queue. In
multi-session mode this means:

- A tool in session 2 can consume session 1's callback/text reply
- `dequeue_update` with explicit `sid` falls back to global if session queue is
  missing, leaking updates cross-session

The **pending guards** are already session-aware (they query `sq.pendingCount()`
when a session exists). The **polling loops** are not.

## Root Cause

`button-helpers.ts` functions (`pollButtonPress`, `pollButtonOrTextOrVoice`)
import `dequeueMatch` and `waitForEnqueue` from `message-store.js` — the global
queue. They have no concept of session queues.

`ask.ts` has its own inline polling loop using the same global imports.

## Files to Change

| File | Change |
| --- | --- |
| `src/tools/button-helpers.ts` | Add optional `sid?: number` param to `pollButtonPress` and `pollButtonOrTextOrVoice`. When `sid > 0`, dequeue from `getSessionQueue(sid).dequeueMatch()` and `.waitForEnqueue()` instead of global. |
| `src/tools/confirm.ts` | Pass `getCallerSid()` (or `getActiveSession()`) to `pollButtonOrTextOrVoice`. |
| `src/tools/choose.ts` | Same as confirm. |
| `src/tools/ask.ts` | Replace inline `dequeueMatch` / `waitForEnqueue` calls with session-queue equivalents when `sid > 0`. |
| `src/tools/dequeue_update.ts` | When `explicitSid` is provided but `getSessionQueue(sid)` returns `undefined`, return an error instead of falling back to global. |

## Key Constraint

`TwoLaneQueue<T>` already has `.dequeueMatch()` and `.waitForEnqueue()` with the
same signatures as the message-store exports. The change is plumbing, not new
logic.

## Acceptance Criteria

1. `confirm`, `choose`, `ask` never consume events from another session's queue
2. `dequeue_update(sid: N)` returns an error if session N has no queue
3. All existing tests still pass
4. New tests verify:
   - Two sessions: session 1's `confirm` callback is invisible to session 2
   - Two sessions: session 1's `ask` text reply is invisible to session 2
   - `dequeue_update` with invalid SID returns error, not global queue data
5. Build + lint clean

## PR Review Comments Addressed

- `confirm.ts` line 85 (global poll)
- `choose.ts` line 85 (global poll)
- `ask.ts` line 8 (global poll) + line 68 (pending guard — already fixed)
- `confirm.ts` line 95 (pending guard — already fixed)
- `choose.ts` line 95 (pending guard — already fixed)
- `dequeue_update.ts` line 74 (fallback to global)
