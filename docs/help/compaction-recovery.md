# compaction-recovery

Your session token is intact — no need to start a new session.

1. **Drain** — call `dequeue` to catch up on queued messages.
2. **Reorient** — review recent context before proceeding:
   ```
   action(type: "message/history", token: <token>, count: 10)
   ```
   Returns the last N messages so you know what was just said without resending. See `help('message/history')`.
