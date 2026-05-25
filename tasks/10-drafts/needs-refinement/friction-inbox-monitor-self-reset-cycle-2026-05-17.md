---
type: friction
class: bug
filed-by: Foreman
filed-date: 2026-05-17
symptom: inbox monitor dies immediately on every re-arm (Windows)
---

# Friction: inbox monitor self-reset cycle on Windows

## Symptom

Every time the foreman re-arms the inbox monitor (`monitor.sh --prefix Inbox`, persistent),
it dies immediately with `Inbox: closed`. Outbox monitors are unaffected.

## Root cause (hypothesis)

`monitor.sh`'s self-reset logic (lines 109–114) unconditionally deletes `.signal` and
sleeps 5s when `.signal` exists at startup. On the first arm this is fine. On re-arms
(after a `closed` event), the cycle is:

1. New `monitor.sh` starts → self-reset deletes `.signal`
2. `watch.ps1` (still running from previous arm? or evicted by the delete?) emits `gone`
3. `monitor.sh` outputs `closed` → exits
4. Foreman re-arms again → goto 1

`watch.ps1` was verified to work correctly in isolation (ran for 3s, emitted `timeout`
cleanly). Path resolution works (Git Bash POSIX paths converted to Windows paths for
standalone pwsh args).

Possible contributing factors:
- Windows `FileSystemWatcher` behavior when a second concurrent watcher disposes
- Harness auto-restarting persistent monitors (would cause two simultaneous instances)
- Timing race between `touch "$SIGNAL"` and `Test-Path` in pwsh startup

## Proposed fix

Add a freshness check to the self-reset: only evict if `.signal` is older than the
current boot-time or a threshold (e.g. 30s). Freshly-created `.signal` files don't
need eviction. Alternatively, add a `--no-reset` flag to skip self-reset when the
foreman knows there is no existing watcher to evict.

## Workaround

Foreman re-arms on each `closed` notification. Inbox monitoring is degraded but the
foreman still processes messages via the cron scan (every 6 minutes) and worker events.
