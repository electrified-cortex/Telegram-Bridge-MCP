# 10-841 - activity/file/create needs a `refresh: true` flag

## Context

`session/start` already accepts `refresh: true` (see `src/tools/action.ts:286-294`) — collapses first-boot / reconnect-of-live / re-establish-after-drop into one idempotent call. The same shortcut was operator-specced for `activity/file/create` but never shipped (gap discovered 2026-05-18 during a production incident).

Today's `activity/file/create` (src/tools/activity/create.ts) hard-errors `ALREADY_REGISTERED` if any registration exists for the session. Agents recovering from compaction (or any state-loss restart) have to do a get-or-delete-then-create dance, which the telegram-participation skill across 8 pod copies currently encodes via prompt-engineering with the literal comment "bridge `refresh` mode is not yet wired up to reclaim cleanly".

That comment is the spec.

## Acceptance Criteria

1. `action(type: 'activity/file/create')` without refresh: **unchanged**. Still errors `ALREADY_REGISTERED` if a registration exists. Back-compat preserved.
2. `action(type: 'activity/file/create', refresh: true)`:
   - If no registration exists: behave exactly as today's create (TMCP-generated path or agent-supplied path).
   - If a registration exists: delete the existing file + clear its registration, then immediately create the new file + register, return the new path. Effectively `delete -> create` server-side in one atomic call (no wait). In-flight watchers on the OLD path will emit `gone` and exit on their own.
3. Response shape: success returns `{hint, file_path, monitor, refreshed: <bool>, pending: <int>}`.
   - `refreshed: true` when an existing registration was replaced; `false` for fresh-create path.
   - `pending` reports the queued-message count for the session at the moment the new registration is in place. Any messages that landed during the 5 s wait window MUST be counted. Caller uses this to decide whether to dequeue immediately.
4. The `action.ts` schema gains a `refresh` description on the activity/file/create branch matching the session/start one.
5. `help(topic: 'activity/file')` doc updated to recommend `refresh: true` as the canonical startup + compaction-recovery call. Removes the current "do not call create on compaction, use get" guidance.

## Race conditions to handle

- **Messages arriving mid-swap**: inbound poller may receive updates between `delete` and `create`. They must queue against the session normally (session and SID don't change — only the activity file is being swapped). When the new registration is committed, `pending` MUST include any updates queued during the swap. Do NOT drop them.
- **Concurrent `refresh: true` from the same session**: two near-simultaneous calls (operator double-tap, agent retry on perceived timeout). The handler must serialize per-SID — second call sees a partial swap and either waits for the in-flight refresh to complete (and returns its result) or returns a clean `REFRESH_IN_PROGRESS` error. NOT a half-applied state.
- **Watcher firing during the swap**: an in-flight `tail`/`FileSystemWatcher` on the OLD path will emit `gone` and exit on its own. That's intended. Agent re-arms watcher on the new path after the call returns. Bridge should ensure no `kick`/mtime-touch is attempted against the deleted-but-not-yet-recreated path mid-swap (queue any pending kicks to fire once the new path is registered).
- **Agent-supplied `file_path` registrations** (`tmcpOwned: false`): refresh:true MUST NOT silently delete an external file the agent or another process owns. Either (a) error with a clear message ("cannot refresh agent-supplied path; call delete + create explicitly"), or (b) require a new `file_path` arg to swap to a different external path without deleting the old. Pick one; document.

## Constraints

- Must NOT clobber an agent-supplied `file_path` (`tmcpOwned: false` registrations) without warning. If the existing registration is agent-supplied and the caller passes `refresh: true` without a new `file_path`, prefer to error with a clear message rather than silently delete the agent's external file.
- Watch out for the kick-lockout state (`kickLockedUntil`, `kickPendingBecauseLocked`) in file-state.ts — the new registration must start with a clean lockout slate, same as the existing `replaceActivityFile` path.

## Priority

10 - bug-shaped feature gap, depth-3 (cross-fleet skill simplification). Removes a class of compaction-recovery foot-guns and unblocks simplifying telegram-participation skill across all pod classes.

## Delegation

Worker (TMCP) — straightforward additive change to create.ts + schema. Curator already specced (this file). Operator-acknowledged 2026-05-18 as a required missing feature.

## Related

- `src/tools/action.ts` line 286-294 — existing session/start refresh as the model.
- `src/tools/activity/create.ts` — handler to extend.
- `src/tools/activity/file-state.ts` — `replaceActivityFile` already handles the state-swap atomically; the delete-and-wait wrapper is new.
- `src/tools/activity/delete.ts` — refresh path should reuse this for the existing file teardown.
- Yesterday's telegram-participation SKILL.md tightening (8 pod copies): the workaround that this task obsoletes.
