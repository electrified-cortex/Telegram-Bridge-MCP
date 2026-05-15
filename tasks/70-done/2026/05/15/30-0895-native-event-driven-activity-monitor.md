---
id: "30-0895"
title: "native event-driven activity-file monitor (replace sleep-loop polling)"
type: spike
priority: 30
created: 2026-05-15
delegation: Worker
target_branch: dev
related: 30-0892
---

# 30-0895 — native event-driven activity-file monitor

## Context

`tools/monitor.sh` and `tools/monitor.ps1` shipped under 30-0892 use a 1-second sleep-loop polling stat. Functional but wasteful: every monitor process burns CPU on the poll interval and adds latency up to one tick. With 3 active agents (Curator + Overseer + foremen + workers), monitor processes proliferate; sleep-loops are a measurable share of background CPU.

Native OS file-event APIs eliminate the polling: the kernel wakes the process on actual mtime change. Zero idle CPU, no missed-during-sleep events, sub-millisecond latency.

## Acceptance criteria

1. **Windows variant — `tools/monitor.ps1`:** rewrite the watch loop using `System.IO.FileSystemWatcher`. Subscribe to `Changed` on the activity file, block on event with optional heartbeat/timeout. Same kick / heartbeat / timeout output contract as today.
2. **Linux variant — `tools/monitor.sh`:** add an `inotifywait` (inotify-tools) path. Detect at startup; if `inotifywait` is on PATH, use it; else fall back to current sleep-loop. Emits same kick lines.
3. **macOS:** `fswatch` if available; else sleep-loop fallback.
4. Output contract unchanged: `kick` / `heartbeat` / `timeout`. Existing callers don't change.
5. Document the per-OS detection + fallback in script header.

## Out of scope

- Replacing pod-local `inbox/.signal` watchers (those are file-event watchers too, but per-pod, separate concern).
- Removing sleep-loop entirely — keep as documented fallback for environments without native tools.

## Source

- Operator request 2026-05-15T01:00 UTC: "are there better options other than sleep loops? Is there something with Windows where we can use an actual file monitor?"
- Overseer concurrence (DM 2026-05-15): "process proliferation high priority this session, sleep-loop is root cause, FileSystemWatcher is right target."
- Builds on 30-0892 (sealed 2026-05-14, cherry-pick 5259c83c on dev).


## Spike findings (2026-05-15, haiku investigator)

**Linux — inotifywait:** Available in standard distros via the `inotify-tools` package (apt/yum/pacman). Command: `inotifywait -m -e modify <file>` emits one line per event. To catch editor temp+rename pattern, use `-e modify,create,moved_to`. Zero idle CPU.

**macOS — fswatch:** Requires installation via Homebrew; not present by default. Command: `fswatch -1 <file>` reports once and exits. Less granular than inotifywait but handles atomic renames well. Soft dependency — sleep-loop fallback acceptable.

**Windows — FileSystemWatcher (PowerShell):** Built-in `[System.IO.FileSystemWatcher]`. Subscribe to `Changed` event with `Register-ObjectEvent`, idle on `Start-Sleep` between events. `WaitForChanged()` is the synchronous-blocking variant. Set `NotifyFilter = LastWriteTime` to filter spurious atime/chmod. Caveat: temp+rename may need watching `Created | Deleted | Changed` together. ~100ms event latency due to Windows file buffering.

**Cross-platform detection order:**

1. Linux: `command -v inotifywait` → use it.
2. macOS: `command -v fswatch` → use it.
3. Windows: try `[System.IO.FileSystemWatcher]` constructor; catch on non-Windows.
4. Fallback (all): current sleep-loop polling.

**Gotchas:**

- Temp-file saves (Vim, VS Code): each tool needs the right event filter to catch the rename, not just modify.
- NFS / network filesystems: high spurious-event rate on all three; need debounce if used remote.
- Spurious atime/chmod: inotifywait `-e modify` filters; FileSystemWatcher `NotifyFilter = LastWriteTime` filters; fswatch fires on all → needs debounce.

**Recommendation:** Implement native variants on Linux + Windows (high-confidence wins, no external deps for Windows). macOS native is optional. Sleep-loop stays as mandatory fallback.

Findings produced by haiku investigator dispatch, 2026-05-15.

## Completion

Rewrote `tools/monitor.sh` and `tools/monitor.ps1`. `monitor.sh` detects `inotifywait` (Linux) → `fswatch` (macOS) → sleep-loop fallback at startup. `monitor.ps1` replaces poll loop with `[System.IO.FileSystemWatcher]` (NotifyFilter=LastWriteTime, WaitForChanged). Output contract (kick/heartbeat/timeout) unchanged. Commit `8e457f27` on branch `30-0895`.

## Verification

APPROVED — 2026-05-15. All 5 criteria confirmed: FileSystemWatcher in PS1, inotifywait+fswatch detection in SH, output contract unchanged, per-OS detection documented in headers, sleep-loop fallback preserved. Cherry-picked as `fd885195` onto `dev`.

Sealed-By: foreman
