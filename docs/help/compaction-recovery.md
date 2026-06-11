# compaction-recovery

Your session token is intact — no need to start a new session.

1. **Drain** — call `dequeue` to catch up on queued messages. Note the ID of the oldest message you receive.
2. **Reorient** — review context prior to what you just drained:
   ```
   action(type: "message/history", token: <token>, count: 3, before_id: <oldest_dequeued_id>)
   ```
   Returns the 3 messages before your dequeue window. Page back further by passing the oldest returned ID as `before_id` again. See `help('message/history')`.
