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

## Bundled watcher scripts

TMCP ships ready-to-run watcher scripts in `tools/`. Use these instead of rolling your own:

| Script | Platform |
| --- | --- |
| `tools/monitor.sh` | Bash (Linux, macOS, Git-Bash on Windows) |
| `tools/monitor.ps1` | PowerShell (Windows, cross-platform pwsh) |

Both scripts take the activity file path as the first argument. On each mtime change they emit `kick` to stdout — your Monitor tool picks this up and you call `dequeue()`.

**Bash:**
```bash
bash tools/monitor.sh "$ACTIVITY_FILE_PATH"
# Optional: heartbeat every 60 s so you can detect a dead monitor
bash tools/monitor.sh "$ACTIVITY_FILE_PATH" --heartbeat 60
# Optional: exit after 5 minutes of inactivity
bash tools/monitor.sh "$ACTIVITY_FILE_PATH" --timeout 300
```

**PowerShell:**
```powershell
pwsh tools/monitor.ps1 $activityFilePath
# Optional: heartbeat every 60 s
pwsh tools/monitor.ps1 $activityFilePath -Heartbeat 60
# Optional: exit after 5 minutes of inactivity
pwsh tools/monitor.ps1 $activityFilePath -Timeout 300
```

**Output lines:**
- `kick` — mtime changed; call `dequeue()`.
- `heartbeat` — monitor is alive (emitted every `-Heartbeat`/`--heartbeat` seconds when idle).
- `timeout` — idle limit reached; exits 0.

---

## Canonical Monitor recipe (Claude Code)

Use this recipe with the Claude Code `Monitor` tool to watch the activity file. Substitute `<ACTIVITY_FILE>` with the path returned by `action(type: "activity/file/get")`.

```bash
f="<ACTIVITY_FILE>"; prev=$(stat -c%Y "$f" 2>/dev/null); while true; do cur=$(stat -c%Y "$f" 2>/dev/null); if [ "$cur" != "$prev" ]; then echo "kick @ $cur"; prev=$cur; fi; sleep 1; done
```

**Monitor parameters:**

| Parameter | Value |
| --- | --- |
| `persistent` | `true` — required so the monitor survives across dequeue calls |
| `description` | e.g. `"activity-file mtime watcher for session <sid>"` |
| `timeout_ms` | ignored when `persistent: true` — omit or set to any value |

**How to use:** pass the command above as the `command` parameter to `Monitor`. On each `kick @ <unix-seconds>` line, call `dequeue(token)` and re-enter your loop.

**Failure modes this recipe avoids:**

- `tail -F` — follows appended bytes, not mtime changes; useless here.
- `jq` missing — the recipe uses only `stat` and POSIX shell; no external JSON tools required.
- Content-vs-mtime confusion — the recipe reads mtime only (`stat -c%Y`); never reads file content.
- `persistent`-vs-`timeout_ms` confusion — when `persistent: true`, `timeout_ms` is ignored; the monitor runs until you call `TaskStop` or the session ends.

**Path substitution:** replace `<ACTIVITY_FILE>` with the literal file path. Example:

```bash
f="/tmp/tmcp-activity-abc123.txt"; prev=$(stat -c%Y "$f" 2>/dev/null); while true; do cur=$(stat -c%Y "$f" 2>/dev/null); if [ "$cur" != "$prev" ]; then echo "kick @ $cur"; prev=$cur; fi; sleep 1; done
```

The recipe is also returned as `monitor_recipe` in the `session/start` and `session/reconnect` responses — no need to copy it manually.

---

## Watcher patterns (inline, no script)

For environments where you cannot run a separate script, use these inline patterns directly.

**Bash — poll loop (portable):**
```bash
f="$ACTIVITY_FILE"
prev=$(stat -c%Y "$f" 2>/dev/null)
while true; do
  cur=$(stat -c%Y "$f" 2>/dev/null)
  if [ "$cur" != "$prev" ]; then
    echo "kick"
    prev=$cur
  fi
  sleep 1
done
```

**PowerShell — poll loop:**
```powershell
$f = $activityFile
$prev = (Get-Item $f -ErrorAction SilentlyContinue).LastWriteTimeUtc
while ($true) {
  $cur = (Get-Item $f -ErrorAction SilentlyContinue).LastWriteTimeUtc
  if ($cur -ne $prev) { Write-Output "kick"; $prev = $cur }
  Start-Sleep -Seconds 1
}
```

**Linux — inotifywait (Linux only, not in git-bash):**
```bash
inotifywait -e attrib -m "$ACTIVITY_FILE" | while read; do
  echo "kick"
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

## Compaction recovery

After a context compaction, your Monitor task is dead and the file path is no longer in your conversation context. Do **not** call `activity/file/create` — that creates a second registration. Instead, use `activity/file/get` to retrieve the existing path from TMCP and re-arm a fresh Monitor on it.

See `help('compaction-recovery')` for the full recovery sequence.
