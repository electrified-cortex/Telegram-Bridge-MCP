# telegram-mcp-stop-hook-recovery — uncompressed

## What this skill governs

The single, immediate action an agent takes when the host runtime's Stop hook fires while a Telegram bridge session is active. The Stop hook fires when the host (e.g., Claude Code) decides to terminate the conversation; the bridge wants the agent to keep the session alive instead of letting it die mid-loop.

Applies ONLY when: the agent is currently inside a Telegram MCP dequeue loop AND the Stop hook fires.

Not covered: forced stop due to context exhaustion (`telegram-mcp-forced-stop-recovery`), compaction recovery (`telegram-mcp-post-compaction-recovery`), operator-initiated graceful shutdown (`telegram-mcp-graceful-shutdown`), any non-Telegram session.

## The rule

Stop hook fires + Telegram session active = call `dequeue`. Nothing else.

```text
dequeue
```

That is the entire recovery action. Re-enters `telegram-mcp-dequeue-loop`.

## Detection signal

Either of these signals indicates active Telegram session:
- Stop hook feedback explicitly mentions an active Telegram loop.
- Session memory file (e.g., `TELEGRAM_SESSION_FILE` or equivalent) is present and non-empty.

## What NOT to do on the recovery turn

- No text output.
- No explanation.
- No analysis.
- No handoff writes.
- No DMs to anyone.
- No session liveness checks before calling `dequeue` — the bridge handles liveness; agent second-guessing wastes the recovery turn.

The recovery turn is one action. Anything else risks being cut off.

## "No tokens left" edge case

The Stop hook may fire when the agent is near or at context limit.

First hook fire: `stop_hook_active` is `false` -> hook blocks exit, agent gets one more turn.

If the agent is near zero tokens on that turn:
1. Write checkpoint to session memory immediately (don't wait for the 10-cycle interval).
2. Call `dequeue` — may give more time.
3. If `dequeue` returns with tokens remaining, notify a superior that context is near-exhaustion.

Second hook fire: `stop_hook_active` is `true` -> hook passes through, process terminates. At that point: no `session/close` was called, no handoff written, session memory still has token. The session appears live but is orphaned.

Recovery for the NEXT session: read session memory, find checkpoint, determine forced stop via checkpoint timestamp vs handoff state, then follow `telegram-mcp-forced-stop-recovery`.

## Cross-references

- Loop re-entry: `telegram-mcp-dequeue-loop`.
- Forced-stop path: `telegram-mcp-forced-stop-recovery`.
