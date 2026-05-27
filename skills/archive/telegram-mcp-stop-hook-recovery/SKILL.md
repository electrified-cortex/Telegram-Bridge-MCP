---
name: telegram-mcp-stop-hook-recovery
description: >-
  Immediate recovery action when the VS Code Stop hook fires during an active
  Telegram session. Use when the stop hook feedback mentions an active Telegram loop.
compatibility: "Requires Telegram MCP bridge"
---

# Telegram MCP Stop Hook Recovery

Stop hook fires → active Telegram loop detected → **FIRST AND ONLY** action: call `dequeue`.

## Rules

- No text output.
- No explanation.
- No analysis.
- Just: `dequeue` (re-enters **telegram-mcp-dequeue-loop**).

## Why

Stop hook fires when VS Code terminates agent conversation. Session memory file (`$env:TELEGRAM_SESSION_FILE` for Claude Code; VS Code memory for Copilot Chat) signals active Telegram session → should not terminate. Hook catches this, gives agent one more turn — use it to re-enter loop.

---

## "No Tokens Left" Edge Case

### The Sequence

1. **Stop hook fires (first time).** `stop_hook_active` = `false` → hook returns `block`. Agent gets one more turn.
2. **Agent near-zero tokens.** Can't run full dequeue loop, write handoff, or DM fleet.
3. **Stop hook fires again.** `stop_hook_active` = `true` → hook **passes through**. Process terminates.

At this point:
- `action(type: "session/close")` never called.
- No handoff written (for agents using them).
- `TELEGRAM_SESSION_FILE` still has token → fleet sees apparently-live but orphaned session.

### Minimal Tokens Remaining

Actions in strict priority order — stop when tokens run out:

1. **Write checkpoint** to session memory immediately (don't wait for 10-cycle interval):

   ```markdown
   ## Checkpoint

   Written: <ISO 8601 timestamp>
   Cycle: <current cycle count>
   SID: <your SID>
   Status: <idle | in-progress: task-id>
   Note: forced-stop imminent — checkpoint written at hook boundary
   ```

2. **Call `dequeue`** — re-enters loop, may give more time.

3. If `dequeue` returns with tokens remaining, DM Overseer:

   ```text
   ⚠️ Context near-exhaustion. Checkpoint written. May stop uncleanly.
   ```

### No Tokens At All

Second hook fires → process terminates → **periodic checkpoint** (every 10 dequeue cycles) is recovery artifact. Next session detects unclean stop via checkpoint timestamp → follows **`telegram-mcp-forced-stop-recovery`**.

### What the Next Session Does

1. Read session memory → find checkpoint.
2. Compare checkpoint timestamp to `handoff.md` (or use checkpoint alone for Workers).
3. Checkpoint newer than handoff (or handoff blank while checkpoint exists) → follow **`telegram-mcp-forced-stop-recovery`** → announce unclean stop to Curator → proceed with normal startup.
