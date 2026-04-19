Stop Hook Recovery — Action when VS Code Stop hook fires during active Telegram session.

Stop hook fires → active Telegram loop detected → FIRST AND ONLY action: call dequeue.

## Rules
- No text output.
- No explanation.
- No analysis.
- Just: dequeue (re-enters dequeue loop).

## Why
Stop hook fires when VS Code terminates agent conversation. Session memory file signals
active Telegram session → should not terminate. Hook catches this, gives one more turn —
use it to re-enter loop.

## "No Tokens Left" Edge Case
Sequence:
1. Stop hook fires (first time). stop_hook_active = false → hook blocks. Agent gets one more turn.
2. Agent near-zero tokens. Can't run full dequeue, write handoff, or DM fleet.
3. Stop hook fires again. stop_hook_active = true → hook passes through. Process terminates.

Result: session/close never called, no handoff, session file still has token → orphaned.

## Minimal Tokens Remaining — Priority Order

1. Write checkpoint to session memory immediately
   (don't wait for 10-cycle interval):

   ```text
   ## Checkpoint
   Written: <ISO 8601>
   Cycle: <count>
   SID: <your SID>
   Status: <idle | in-progress: task-id>
   Note: forced-stop imminent
   ```

2. Call dequeue — re-enters loop, may give more time.
3. If tokens remain after dequeue, DM Overseer:
     "⚠️ Context near-exhaustion. Checkpoint written. May stop uncleanly."

## Recovery Path
Next session: reads session memory → finds checkpoint → compares to handoff →
checkpoint newer than handoff (or handoff blank) → follow forced-stop topic →
announce unclean stop to Curator → proceed with normal startup.

Full reference: skills/telegram-mcp-stop-hook-recovery/SKILL.md
