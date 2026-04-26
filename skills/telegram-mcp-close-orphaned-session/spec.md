# telegram-mcp-close-orphaned-session spec

## Purpose

Define the procedure for closing a Telegram bridge session that is registered in the bridge but has no active agent process attached. Orphaned sessions accumulate when an agent's host process dies without calling `session/close` — they consume bridge resources and confuse routing.

This skill exists because the bridge cannot unilaterally close sessions a governor still owns; the governor must explicitly retake the orphan and shut it down.

## Scope

Applies when:

- `session/list` shows a session whose agent is unresponsive to DMs.
- The operator asks to clean up a known dangling session.
- A spawned agent's host terminal exited and the operator denied a reconnect prompt.

Does NOT cover:

- Forced-stop recovery of the agent's own session (see `telegram-mcp-forced-stop-recovery`).
- Routine graceful shutdown of an active agent (see `telegram-mcp-graceful-shutdown`).

## Requirements

R1. The skill MUST present the procedure as ordered steps:
   1. Identify orphan: get name + SID via `session/list` or memory.
   2. Reconnect with `action(type: "session/start", name: <name>, reconnect: true)` to retake control. This triggers an operator approval dialog.
   3. After operator approval and the reconnect succeeds, the new session is the same SID as the orphan.
   4. Drain any pending updates with `dequeue(max_wait: 0)`.
   5. Call `action(type: "session/close")` to close cleanly.

R2. The skill MUST require operator approval as a non-bypassable step. The reconnect path is governor-supervised.

R3. The skill MUST state who runs this skill: a governor-class session (or operator directly via the bridge UI). Non-governors do not orphan-close peer sessions.

R4. The skill MUST cross-reference `telegram-mcp-graceful-shutdown` for what the close call actually does.

## Constraints

C1. Runtime card under ~80 lines. The procedure is short; verbosity is unjustified.

C2. Use canonical session-pool labels — do NOT bake workspace-specific role names (Worker, Overseer).

C3. The reconnect-then-close sequence is the only sanctioned path. Do NOT introduce alternative paths involving direct database edits or bridge restarts.

## Don'ts

DN1. Do NOT instruct on bypassing the operator approval. The approval is the safety gate against rogue session takeover.
DN2. Do NOT recommend running this skill speculatively. Confirm the session is genuinely orphaned (unresponsive to DMs across at least one full reminder cycle) before taking it.
DN3. Do NOT include workspace-specific naming or path conventions.
