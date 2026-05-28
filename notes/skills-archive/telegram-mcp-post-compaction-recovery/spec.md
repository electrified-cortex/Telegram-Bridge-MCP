# telegram-mcp-post-compaction-recovery spec

## Purpose

Define the recovery procedure an agent runs after its host runtime compacts the conversation. Compaction truncates the in-memory turn history but does NOT kill the Telegram session — the bridge token is still valid and the dequeue loop should resume seamlessly.

This skill exists because agents emerging from compaction often misdiagnose their state and call `session/start` or `profile/load`, which sends the operator a fresh reconnect prompt and overwrites session settings — both noisy and unnecessary when the session is alive.

## Scope

Applies on agent post-compaction wake-up when:

- The session memory file is present and non-empty.
- The host signals (or hooks indicate) a compaction event preceded this turn.

Does NOT cover:

- Forced-stop recovery (see `telegram-mcp-forced-stop-recovery`).
- Stop hook handling (see `telegram-mcp-stop-hook-recovery`).
- Cold-start session join (see `telegram-mcp-session-startup`).

## Requirements

R1. The skill MUST present the recovery procedure as ordered steps:
   1. **Step 0**: Read session memory file. The file contains a plain integer token.
   2. **Step 1**: Distinguish from forced-stop by silent probe: call `dequeue(max_wait: 0)`. If the call returns a normal response (empty, timed_out, or with updates), the session is alive.
   3. **Step 2**: Re-enter the dequeue loop using the recovered token.

R2. The skill MUST state the critical rule: do NOT call `action(type: "session/start")` or `action(type: "profile/load")` unless the silent probe indicates the session is dead. Both actions are noisy:
   - `session/start` (with `reconnect: true`) sends the operator a reconnect prompt.
   - `profile/load` overwrites preserved session settings (voice, animations, reminders).

R3. The skill MUST cover the dead-session fallback: if the silent probe returns an error indicating session not found, fall through to `telegram-mcp-session-startup`.

R4. The skill MUST cross-reference `telegram-mcp-forced-stop-recovery` (related but distinct) and `telegram-mcp-dequeue-loop` (the loop being re-entered).

## Constraints

C1. Runtime card under ~120 lines.

C2. The silent-probe pattern (using `dequeue(max_wait: 0)` instead of an explicit liveness call) is the canonical detection mechanism. Earlier versions used animation-based liveness checks; those are deprecated.

C3. No host-specific recovery hooks are baked into the skill. Hosts (Claude Code's PostCompact hook, etc.) feed the skill; the skill doesn't depend on a specific hook implementation.

## Don'ts

DN1. Do NOT instruct the agent to ask the operator for a status check. Compaction recovery should be silent unless the session is genuinely dead.
DN2. Do NOT introduce a "verify all settings" step — `profile/load` is destructive in this context, not corrective.
DN3. Do NOT bake workspace path conventions for the memory file (`memory/telegram/session.token` is one convention; the skill states "session memory file" abstractly).
