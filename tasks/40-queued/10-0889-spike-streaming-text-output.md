---
id: "10-0889"
title: "Spike: streaming text output from agents to Telegram"
type: spike
priority: 10
status: queued
created: 2026-05-07
filed-by: Overseer (operator-approved)
delegation: Worker
target_repo: telegram-bridge-mcp
target_branch: release/7.4
---

# Spike: streaming text output from agents to Telegram

## Operator priority

Highest-priority new feature (msg 51226, 2026-05-07). "I would love to see streaming
text actually working."

## Problem

Agents currently send complete text messages — the operator waits for the full output
before seeing anything. For long code reviews, audit summaries, or analysis, this means
30–90 second silences. Streaming would show text appearing live, matching the UX of
native ChatGPT/Claude web interfaces.

## Constraint: MCP tool model

A TMCP tool call (`send`) returns a single response. Claude Code has no native streaming
primitive for MCP tools. This is the core architectural challenge.

## Options to research

### Option A — Progressive editMessageText (MCP-native)

1. Agent calls `send(type: "stream/start")` → TMCP sends a placeholder message, returns `{ message_id, stream_id }`.
2. Agent calls `send(type: "stream/chunk", stream_id, text: "partial content")` → TMCP appends and calls `editMessageText`.
3. Agent calls `send(type: "stream/flush", stream_id)` → finalizes, removes "typing..." indicator.

**Pros:** Pure MCP, works with any Claude Code version.
**Cons:** Each chunk = 1 round-trip MCP call. Rate-limited by Telegram edit API (1 edit/sec per message). Not true streaming — it's polling.

### Option B — HTTP streaming endpoint

TMCP exposes a new `POST /stream/:token` endpoint that accepts chunked transfer encoding
or newline-delimited JSON. Agent writes chunks to the HTTP endpoint; TMCP relays to
Telegram via progressive edits on a single message.

**Pros:** True streaming — agent can write at full generation speed.
**Cons:** Claude Code agents don't have built-in HTTP client beyond `fetch`. Would need
a tool or shell script wrapper.

### Option C — show-typing + chunked send

Simpler: agent sends `show-typing` while generating, then sends one complete message.
Partial improvement but not true streaming.

## Spike deliverables

1. **Architecture decision**: which option is feasible given Claude Code + MCP constraints?
2. **Proof of concept**: implement the simplest working version of the chosen approach.
3. **Rate limit analysis**: Telegram allows ~20 edits/sec burst, ~1/sec sustained per message.
4. **Claude Code integration**: how does an agent call this from a normal task flow?
5. **Recommendation**: file implementation task(s) based on findings.

## Acceptance criteria

- [ ] Architecture decision documented with rationale.
- [ ] At least Option A prototyped end-to-end (start → chunk → flush).
- [ ] Telegram rate limit behavior characterized.
- [ ] Recommendation filed as follow-on task(s).

## Bailout

4 hours. If neither Option A nor B is feasible in TMCP without major refactoring,
document why and propose an alternative path.
