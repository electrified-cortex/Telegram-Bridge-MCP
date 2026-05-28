# telegram-mcp-forced-stop-recovery spec

## Purpose

Define the detection and recovery procedure for an agent that was force-terminated due to context exhaustion (or unconditional host termination) while inside an active Telegram session. Forced stop is distinct from compaction — the agent had zero tokens left and could not write a handoff, call `session/close`, or signal anyone before the host killed it.

This skill exists because the recovery path for this case is fundamentally different from a graceful close or a compaction round-trip: the new agent process arrives with no continuity from the previous run beyond what was checkpointed to disk.

## Scope

Applies on agent startup when the session memory file is non-empty AND no graceful-shutdown handoff exists from the prior run AND no active recent activity from the prior session is observable in the bridge.

Does NOT cover:

- Compaction recovery (see `telegram-mcp-post-compaction-recovery`).
- Graceful shutdown (see `telegram-mcp-graceful-shutdown`).
- Stop hook handling mid-session (see `telegram-mcp-stop-hook-recovery`).

## Requirements

R1. The skill MUST cover the detection signals:
   - Session memory file present + non-empty (token recoverable).
   - No graceful-handoff document exists for the prior run (or the document is incomplete).
   - Bridge `session/list` shows the prior SID still registered, indicating no `session/close` was called.

R2. The skill MUST instruct on periodic checkpoint reading: agents that follow this skill should write lightweight checkpoints during their dequeue loop so a recovering successor can pick up state. The skill defines the checkpoint format at a high level (timestamp, last-handled message ID, brief state summary).

R3. The skill MUST present the recovery procedure:
   1. Read session memory file → recover token.
   2. Read most recent checkpoint (if any) for state hints.
   3. Probe session liveness via silent `dequeue(max_wait: 0)`.
   4. If session live → re-enter loop, optionally announce recovery briefly.
   5. If session dead → call `session/start` fresh and announce the prior session was lost.

R4. The skill MUST cross-reference `telegram-mcp-post-compaction-recovery` for the silent-probe pattern and `telegram-mcp-session-startup` for the cold-start fallback.

## Constraints

C1. Runtime card under ~120 lines. The procedure is recovery-specific; agents read it only after a forced stop.

C2. Checkpoint format is host-flexible — the skill states required fields, not implementation. Agents may use NDJSON, sqlite, or a single rolling file.

C3. The skill must NOT prescribe a fixed checkpoint cadence; the agent's loop characteristics determine that. The skill states "frequent enough to be useful for recovery, not so frequent it dominates the loop."

## Don'ts

DN1. Do NOT instruct agents to assume the prior session is dead without probing. Force-stop ≠ session-dead — bridges often outlive agent processes.
DN2. Do NOT recommend always calling `session/start` fresh. That sends the operator a reconnect prompt unnecessarily.
DN3. Do NOT bake workspace-specific paths or handoff doc conventions.
