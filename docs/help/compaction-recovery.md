# compaction-recovery

Your session token is intact — no need to start a new session.

1. **Drain** — call `dequeue` to catch up on queued messages.
2. **Reorient** — use `message/history` to review recent context and pick up where you left off without resending. See `help('message/history')`.
