# telegram-mcp-stop-hook-recovery spec

## Purpose

Define the single, immediate action an agent must take when the host runtime's Stop hook fires while a Telegram bridge session is active. The hook fires when the host (e.g. Claude Code) decides to terminate the conversation; the bridge wants the agent to keep the session alive instead of letting it die mid-loop.

This skill exists because Stop hook firings are a known false-positive vector — the hook does not know the agent is in an active dequeue loop and would terminate prematurely without intervention.

## Scope

Applies only to agents currently inside a Telegram MCP dequeue loop when the Stop hook fires. Does NOT cover:

- Forced stop due to context exhaustion (see `telegram-mcp-forced-stop-recovery`).
- Compaction recovery (see `telegram-mcp-post-compaction-recovery`).
- Operator-initiated graceful shutdown (see `telegram-mcp-graceful-shutdown`).
- Any non-Telegram session.

## Requirements

R1. The skill MUST instruct the agent to call `dequeue` immediately as the first and only action. No text output, no explanation, no analysis preceding the call.

R2. The skill MUST state the detection signal explicitly: stop hook feedback mentions an active Telegram loop, OR the session memory file (e.g. `$env:TELEGRAM_SESSION_FILE` or equivalent) is present and non-empty.

R3. The skill MUST cross-reference `telegram-mcp-dequeue-loop` as the loop the agent re-enters via the `dequeue` call.

R4. The skill MUST NOT ask the operator a question, write a status message, or take any action other than `dequeue` on the recovery turn.

## Constraints

C1. Runtime card stays under ~30 lines. The whole point is that the rule is a single action — verbosity defeats the purpose.

C2. No platform-specific instructions beyond noting the Stop hook is host-runtime-supplied. Bridge consumers may run the skill on Claude Code, Copilot Chat, or other hosts.

## Don'ts

DN1. Do NOT instruct the agent to verify session liveness before calling `dequeue`. The bridge handles that; agent guessing wastes the recovery turn.
DN2. Do NOT instruct the agent to write a handoff or DM anyone. Stop hook recovery is one turn — anything else gets cut off.
DN3. Do NOT enumerate every possible Stop hook trigger; the rule is "fired AND Telegram session active = call dequeue."
