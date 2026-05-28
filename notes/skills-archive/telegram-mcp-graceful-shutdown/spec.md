# telegram-mcp-graceful-shutdown spec

## Purpose

Define the ordered shutdown procedure for a Telegram bridge MCP agent receiving a stop signal. Graceful shutdown is the antidote to abrupt termination: it preserves unread messages, lets superiors know state, and releases the session cleanly so the bridge can shut down or hand off to other agents.

This skill exists because a session that exits without draining its queue and signalling superior agents leaves the bridge in an inconsistent state — unread operator messages get dropped and supervising agents are blind to the close.

## Scope

Applies when an agent receives any of:

- Operator-issued stop or close directive.
- `action(type: "shutdown/warn")` DM from a governor session.
- A clear directive in conversation to wrap up.

Does NOT cover:

- Forced stop (see `telegram-mcp-forced-stop-recovery`).
- Compaction recovery (see `telegram-mcp-post-compaction-recovery`).
- Stop hook handling (see `telegram-mcp-stop-hook-recovery`).
- The bridge-level shutdown protocol (see `telegram-mcp-shutdown-protocol`).

## Requirements

R1. The skill MUST present the common shutdown sequence applicable to ALL agents:
   1. Drain queue via `dequeue(max_wait: 0)` until `pending == 0` and response is empty.
   2. Finish the current step / commit work in flight.
   3. DM superior (if applicable) with a brief status line.
   4. Wipe the session token from memory file.
   5. Call `action(type: "session/close")`.
   6. Exit the loop.

R2. The skill MUST distinguish governor-class agents (one per session pool) from non-governor agents:
   - Governors handle additional handoff responsibilities (final handoff doc, signalling other sessions, calling `shutdown` to begin bridge teardown).
   - Non-governors close themselves and exit; their superior closes after.

R3. The skill MUST instruct on `force: true` for the last remaining session — `session/close` with `force: true` is required when no other sessions remain.

R4. The skill MUST cross-reference `telegram-mcp-shutdown-protocol` for the bridge-level shutdown handshake.

R5. The skill MUST state explicitly that draining the queue is non-optional. Unread messages are lost on session close.

## Constraints

C1. Runtime card under ~150 lines. Layered: common steps → role-specific additions → cross-references.

C2. No host-runtime-specific instructions beyond noting that the host (Claude Code, etc.) terminates the agent process after `session/close` returns. Bridge does not own the host lifecycle.

C3. Use canonical session-pool role labels (governor / non-governor) — NOT workspace-specific names.

## Don'ts

DN1. Do NOT instruct the agent to skip the drain step under any circumstance. Time pressure does not justify dropping messages.
DN2. Do NOT enumerate workspace handoff doc paths or workspace conventions.
DN3. Do NOT recommend `shutdown` (bridge-wide) as a per-session action — only governors invoke it, and only after all peers have closed.
DN4. Do NOT introduce a new "soft close" or partial shutdown state. Two states only: in-loop, closed.
