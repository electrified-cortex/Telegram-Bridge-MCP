# telegram-mcp-session-startup spec

## Purpose

Define the cold-start procedure for an agent joining the Telegram bridge MCP chat from scratch. Cold-start is the path used when no prior session exists for this agent identity (no token in memory) — distinct from compaction recovery and forced-stop recovery.

This skill exists because the order and parameter selection of the first few bridge calls determines whether the agent enters the chat with a usable session or wastes a turn on misordered calls.

## Scope

Applies on agent initial startup when:

- Session memory file is empty or absent.
- No checkpoint or handoff indicates a prior session worth recovering.
- Host runtime is fresh (or post-recovery determined cold-start is appropriate).

Does NOT cover:

- Post-compaction recovery (see `telegram-mcp-post-compaction-recovery`).
- Forced-stop recovery (see `telegram-mcp-forced-stop-recovery`).
- Auto-resume logic (handled in Step 0 below as part of fresh-vs-resume disambiguation).

## Requirements

R1. The skill MUST present the procedure with an explicit Step 0 disambiguation: BEFORE calling `session/start`, attempt a silent `dequeue(max_wait: 0)` against any token found in memory. If the dequeue succeeds, the session is alive — fall through to `telegram-mcp-post-compaction-recovery` instead.

R2. The skill MUST present the cold-start sequence:
   1. **Step 0**: Silent probe (above). Fall through to recovery skill if alive.
   2. **Step 1**: `help()` — get tool index and overview.
   3. **Step 2**: `action(type: "session/start", name: "<Name>")` — join chat, receive `{ token, sid, pin, ... }`.
   4. **Step 3**: Save token to session memory file.
   5. **Step 4**: `action(type: "profile/load", key: "<Name>")` — load voice / animations / reminders.
   6. **Step 5**: Enter the dequeue loop (`telegram-mcp-dequeue-loop`).

R3. The skill MUST cover the operator-approval prompt that fires for non-governor sessions: the operator must approve before the session is fully active.

R4. The skill MUST cross-reference:
   - `telegram-mcp-dequeue-loop` (loop entered at end).
   - `telegram-mcp-post-compaction-recovery` (Step 0 fallback).
   - `help('action')` (canonical action reference).

## Constraints

C1. Runtime card under ~150 lines.

C2. Use canonical session/start return shape: `{ token, sid, pin, ... }`. Older artifacts may say `suffix` instead of `pin`; canonical is `pin` per the formula `token = sid * 1_000_000 + pin`.

C3. v6+ API exclusively. No legacy direct-tool patterns.

## Don'ts

DN1. Do NOT instruct the agent to skip Step 0. The silent probe is the only way to avoid a false reconnect prompt.
DN2. Do NOT instruct the agent to call `profile/load` before `session/start`. Order matters — profile binds to a session.
DN3. Do NOT bake host-specific name selection logic. The agent picks its name; the skill governs the protocol.
DN4. Do NOT include workspace agent role names. Generic name slots only.
