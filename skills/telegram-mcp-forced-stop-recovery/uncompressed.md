# telegram-mcp-forced-stop-recovery — uncompressed

## What this skill governs

Detection and recovery when an agent was force-terminated due to context exhaustion while inside an active Telegram session. Forced stop is distinct from compaction: the agent had zero tokens left — it could not write a handoff, call `session/close`, or DM anyone before the host killed it.

The new agent process arrives with no continuity from the prior run beyond what was checkpointed to disk.

Not covered: compaction recovery (`telegram-mcp-post-compaction-recovery`), graceful shutdown (`telegram-mcp-graceful-shutdown`), stop hook handling (`telegram-mcp-stop-hook-recovery`).

## Periodic checkpoint — the dead man's switch

Agents following this skill write a compact checkpoint to their session memory file on a regular interval during the dequeue loop. The checkpoint is the primary recovery artifact — it proves the prior session was alive and surfaces its last known state to the successor.

### Checkpoint schedule

Write every 10 dequeue cycles. The cycle counter increments once per `dequeue` call regardless of whether a message was received.

Write at the START of the 10th cycle (before processing new messages), not at the end.

### Checkpoint format

Append or overwrite a checkpoint block in the session memory file (same file that holds the session token):

```markdown
## Checkpoint

Written: <ISO 8601 timestamp>
Cycle: <loop cycle count>
SID: <your SID>
Status: <idle | in-progress: <task-id>>
```

Write the full file (token block + checkpoint block). Never replace the token block with the checkpoint.

If the memory write fails for any reason, skip it silently — a checkpoint failure must never interrupt the dequeue loop.

### Checkpoint format is host-flexible

The required fields are: Written (timestamp), Cycle, SID, Status. Format (NDJSON, Markdown, single rolling file, etc.) is implementation-defined.

## Detection signals on startup

Read the session memory file. Compare conditions:

| Condition | Interpretation |
| --- | --- |
| File empty or missing | Fresh start — no prior session |
| File has token, no checkpoint block | Prior session ran fewer than 10 cycles — treat as clean start |
| File has checkpoint, handoff exists and is non-blank | Clean shutdown — handoff was written after last checkpoint |
| File has checkpoint, handoff blank or missing | Forced stop — agent stopped without writing handoff |
| File has checkpoint, agent does not use handoffs | Compare checkpoint timestamp to session start: if gap > 30 min and no clean close recorded, treat as forced stop |

Do NOT assume the prior session is dead without probing. Forced stop does not equal session dead — bridges often outlive agent processes.

## Recovery procedure

```text
1. Read session memory file -> recover token.
2. Read most recent checkpoint (if any) for state hints.
3. Silent probe: dequeue(max_wait: 0).
   - Normal response (empty, timed_out, or updates) -> session alive.
     -> Re-enter loop. Announce recovery briefly (see below).
   - Error (session not found) -> session dead.
     -> Fall through to telegram-mcp-session-startup for cold start.
```

Do NOT call `session/start` before probing. The reconnect prompt is unnecessary if the session is alive.

## Announcing forced-stop recovery

If forced stop is detected, announce immediately after confirming the session state — before draining messages:

```text
Forced-stop recovery: terminated uncleanly (context limit or hard stop).
Last checkpoint: <timestamp>, Cycle: <N>, Status: <idle | task-id>.
Resuming now.
```

Use "forced-stop recovery" phrasing — distinct from compaction recovery phrasing.

## Cross-references

- Silent probe pattern: `telegram-mcp-post-compaction-recovery`.
- Cold-start fallback: `telegram-mcp-session-startup`.
- Stop hook edge case: `telegram-mcp-stop-hook-recovery`.

## Don'ts

- Do not assume the prior session is dead without probing.
- Do not call `session/start` fresh before the probe; it sends the operator an unnecessary reconnect prompt.
- Do not bake workspace-specific paths or handoff doc conventions.
