# compaction-recovery

Your session token is intact — no need to start a new session.

1. **Drain** — call `dequeue` to catch up on queued messages.
2. **Reorient** — review recent context before proceeding:
   ```
   action(type: "message/history", token: <token>, count: 3)
   ```
   Returns the last 3 messages. For deeper context, pass `before_id: <oldest_id_from_result>` to page back further. See `help('message/history')`.
