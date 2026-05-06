# activity/file — Wake-Nudge Integration Guide

The activity-file feature is an **optional augment** to the primary dequeue loop. It does NOT replace dequeue — it supplements it.

## Purpose

When your harness has a filesystem watcher (e.g. Monitor, FileSystemWatcher, inotifywait), register an activity file and watch it. TMCP bumps the file's mtime when messages arrive AND the debounce window has passed AND no dequeue is in-flight. Your watcher fires, you call dequeue — done.

Without a watcher: long-poll `dequeue(max_wait: 300)` is always sufficient on its own.

## Lifecycle

| Call | Effect |
| --- | --- |
| `action(type: "activity/file/create")` | Register a file (TMCP-generated or agent-supplied). Returns `file_path`. |
| `action(type: "activity/file/edit")` | Swap the registered path. Returns `file_path` + `previous_path`. |
| `action(type: "activity/file/delete")` | Unregister and optionally delete the file. |
| `action(type: "activity/file/get")` | Introspect current registration state. |

## Wake mechanism

TMCP touches the file's mtime (not its content) when:
- A new message or event arrives for the session, AND
- The session has been silent for the configured debounce window, AND
- No dequeue call is currently in-flight.

**Content stays empty/stable — mtime is the signal.** Do not read file content.

## On wake: call dequeue

When your watcher fires, call `dequeue` with your session token and re-enter the loop:

```
dequeue(token: <your_token>, max_wait: 300)
```

## Watcher patterns

**Bash — poll loop (portable):**
```bash
f="$ACTIVITY_FILE"
prev=$(stat -c%Y "$f" 2>/dev/null)
while true; do
  cur=$(stat -c%Y "$f" 2>/dev/null)
  if [ "$cur" != "$prev" ]; then
    echo "mtime changed — call dequeue()"
    prev=$cur
  fi
  sleep 1
done
```

**PowerShell — FileSystemWatcher (event-driven, Windows-native):**
```powershell
$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = Split-Path $activityFile
$watcher.Filter = Split-Path -Leaf $activityFile
$watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite
$watcher.EnableRaisingEvents = $true
Register-ObjectEvent $watcher Changed -Action { Write-Host "mtime changed — call dequeue()" }
```

**Linux — inotifywait (Linux only, not in git-bash):**
```bash
inotifywait -e attrib -m "$ACTIVITY_FILE" | while read; do
  echo "mtime changed — call dequeue()"
done
```

**Note:** `tail -F` does NOT work — it follows appended bytes, not mtime changes.

## Permission caveat

Your harness's watcher tool (Monitor or equivalent) must be in your agent's allowlist. Without the permission, the watcher cannot start and you fall back to long-poll dequeue only — which is always sufficient.

## Error modes

- **File deleted out from under TMCP**: re-register with `activity/file/create`.
- **mtime not bumping**: check the debounce window; mtime only updates after the window expires.
- **Permission denied on stat**: check that the agent has filesystem read access to the file path.
- **No dequeue in-flight guard**: if a dequeue call is already blocking, TMCP skips the mtime touch to avoid duplicate wakes.
