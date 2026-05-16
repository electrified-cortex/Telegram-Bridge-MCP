# compaction-recovery — Activity File Monitor Recovery

When Claude Code compacts a conversation, all in-memory state is lost — including active Monitor tasks. An activity-file monitor that was running before compaction **will not survive**. On resumption, its task ID is gone, its file watch is dead, and TMCP will never nudge it again.

## Why monitors don't survive compaction

Monitors are held in-process by the agent harness. Compaction replaces the conversation context with a summary; the harness re-launches into a clean state with no knowledge of the previous monitor task. The monitor process itself is killed, and the activity file is left untouched but un-watched.

## Recovery sequence

Do **not** call `activity/file/create` again — that would register a second file and cause proliferation (multiple stale activity files accumulating across compactions).

Instead:

1. **Get the current registration** — `action(type: "activity/file/get")` returns the file path TMCP already holds for this session. This is the source of truth.
2. **Stop the stale monitor** — if you have its task ID from before compaction, call `TaskStop`. If the ID is gone (it will be after compaction), skip this step — the old monitor is already dead.
3. **Re-arm a fresh monitor** — use the path returned by `activity/file/get` to start a new Monitor on the same file.

Example (pseudocode):
```
result = action(type: "activity/file/get", token: <token>)
file_path = result.file_path
// re-arm on the returned path — do NOT call activity/file/create
startMonitor(file_path)
```

## `activity/file/get` is the source of truth

TMCP holds the registration server-side. Even after compaction, `activity/file/get` returns the correct path. Always retrieve the path from TMCP rather than reconstructing it from memory or creating a new file.

## Warning: do not create a new activity file on recovery

Calling `activity/file/create` after compaction registers a **second** file. The original file remains in TMCP's registry until it is explicitly deleted. Repeated compactions accumulate stale registrations. Always recover via `activity/file/get` + re-arm, not `create`.

## See also

- `help('activity/file')` — full wake-nudge integration guide (setup, watcher patterns, lifecycle)
- `help('compacted')` — general post-compaction recovery (session token, dequeue drain)
