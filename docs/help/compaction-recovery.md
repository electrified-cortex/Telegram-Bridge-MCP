# compaction-recovery

Your session token is intact. Resume:

1. **Drain** — call `dequeue` to catch up on queued messages.
2. **Check monitors** — in Claude Code, Monitor tasks survive compaction. Run `TaskList` to verify before re-arming.
3. **Re-arm only if needed** — use `activity/file/get` to get your registered path (never `activity/file/create`). See `help('activity/file')` or `help('activity/listen')`.
