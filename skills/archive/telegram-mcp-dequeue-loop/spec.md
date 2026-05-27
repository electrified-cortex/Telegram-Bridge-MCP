# telegram-mcp-dequeue-loop spec

## Purpose

Define the heartbeat loop pattern that keeps a Telegram bridge MCP agent alive and responsive. Every Telegram-enabled agent runs this loop as its terminal state — there is no "I'm done" exit path until the agent receives a shutdown signal.

This skill exists because the dequeue loop is the load-bearing invariant of Telegram-enabled agency: a code path that ends without `dequeue` silently kills the session.

## Scope

Applies to any agent that has joined a Telegram bridge session and is operating in conversational loop mode. Does NOT cover:

- Initial cold-start session join (see `telegram-mcp-session-startup`).
- Recovery from compaction or forced stop (see `telegram-mcp-post-compaction-recovery`, `telegram-mcp-forced-stop-recovery`).
- Graceful shutdown sequence (see `telegram-mcp-graceful-shutdown`).
- The `action()` dispatcher reference (see `help('action')`).

## Requirements

R1. The skill MUST state the invariant explicitly: every code path within an active session ends with a `dequeue` call. No exceptions during normal operation.

R2. The skill MUST present the loop flow: `dequeue` → message handling → `dequeue` → service-message handling → `dequeue` → empty/timeout → `dequeue`. Each state returns to `dequeue`.

R3. The skill MUST cover handling for each event class returned by dequeue:
- User content (text, voice, callback, reaction)
- Service messages (onboarding, behavior nudges, modality hints)
- Direct messages (from other sessions)
- send_callbacks (own outbound confirmations)

R4. The skill MUST instruct on `max_wait` parameter usage: omit for session default; pass `0` for instant non-blocking poll (drain mode).

R5. The skill MUST cover the drain pattern: when `pending > 0` is returned, call `dequeue(max_wait: 0)` repeatedly until `pending == 0` before composing a reply.

R6. The skill MUST cross-reference `telegram-mcp-graceful-shutdown` as the exit path and `telegram-mcp-post-compaction-recovery` as the re-entry point after compaction.

## Constraints

C1. Runtime card under ~150 lines. This is foundational; agents read it often.

C2. Use the `action()` v6+ API exclusively. Legacy direct-tool calls (e.g. pre-v6 `dequeue` as standalone tool) must not appear.

C3. Server-side reactions (auto-salute on voice, processing preset on pending) are documented but the skill does NOT instruct agents to duplicate them.

## Don'ts

DN1. Do NOT introduce a "stop dequeueing" rule beyond shutdown. Idle does not mean stop the loop.
DN2. Do NOT instruct agents to call `session/list` or other introspection mid-loop unless required by a routing decision.
DN3. Do NOT prescribe specific timeouts beyond stating the default and the `max_wait: 0` use case.
DN4. Do NOT embed workspace-specific role names (Curator/Overseer/Worker) — this is a public TMCP skill.
