# telegram-mcp-communication spec

## Purpose

Define the canonical communication conventions for a Telegram bridge MCP agent: which tool to use for which purpose, how to route replies, when buttons beat free-text, voice vs text trade-offs, and async wait etiquette.

This skill exists because the bridge offers many emission tools (`send`, `dequeue`, `action`, `react`, `acknowledge`, etc.) and an agent that picks the wrong one for the situation creates friction (operator confusion, lost messages, costly modality mismatches).

## Scope

Covers all conversational interactions an agent has with the operator, peer sessions, and itself within an active Telegram session. Does NOT cover:

- Session lifecycle (see `telegram-mcp-session-startup`, `telegram-mcp-graceful-shutdown`).
- Recovery flows (see `telegram-mcp-post-compaction-recovery`, `telegram-mcp-forced-stop-recovery`).
- The dequeue loop itself (see `telegram-mcp-dequeue-loop`).
- Skill-internal logic for specific tool families.

## Requirements

R1. The skill MUST cover tool selection: `send` for conversational replies, `action` for non-content operations (reminders, profile, animation), `react` for ack-only, `acknowledge` for callback responses.

R2. The skill MUST present the modality priority axis: buttons > text > audio for soliciting decisions; the inverse for delivering nuance. Agents pick the highest-priority modality the situation supports.

R3. The skill MUST state the duplication rule for hybrid sends: audio and caption are COMPLEMENTARY, never duplicates. Audio carries plain English / lower-priority; caption carries highest-priority structured.

R4. The skill MUST cover button design: max 35 chars per label at columns=1, max 20 chars at columns=2 (default). Use `confirm/*` for standard yes/no, `send(type: "question", choose: [...])` for custom.

R5. The skill MUST cover routing: ambiguous messages go to the governor; targeted messages stay with their target. DMs to peer sessions use `type: "dm"` with `target_sid`.

R6. The skill MUST cover voice handling: voice messages auto-react with salute on dequeue; agents do not duplicate the salute. Reply-to-voice typically uses voice or hybrid back.

R7. The skill MUST cross-reference `help('send')`, `help('reactions')`, `help('modality')`, `help('audio')` for live tool/topic references.

## Constraints

C1. Runtime card under ~250 lines. This is the canonical reference; agents read it often.

C2. v6+ API exclusively. No legacy direct-tool patterns.

C3. Tool examples use canonical parameter names verified against `help()` — no aliases that may rename.

## Don'ts

DN1. Do NOT prescribe a single style (audio-only, text-only). Operator preference and modality priority drive the choice.
DN2. Do NOT instruct agents to send long-form text walls. Compress structured info; if it doesn't fit a Telegram-screen-tall caption, it belongs in audio or a file send.
DN3. Do NOT include workspace-specific role labels in conventions. Use generic "agent", "operator", "peer session" terminology.
DN4. Do NOT duplicate `help()` topic content verbatim — point to it.
