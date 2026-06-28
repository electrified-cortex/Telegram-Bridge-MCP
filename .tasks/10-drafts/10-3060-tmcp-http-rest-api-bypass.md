---
created: 2026-06-28
status: draft
priority: 10
source: Operator voice TG 80303, 2026-06-28
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
severity: medium
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
---

# TMCP — Native HTTP REST API (MCP bypass path)

**ID**: 10-3060
**Date**: 2026-06-28
**Priority**: Medium
**Origin**: Operator TG 80303

## Operator verbatim (TG 80303)

> "I want to be able to dodge the MCP completely and offer up an HTTP equivalent API for the Telegram MCP. It has a port, it has an address. If, like, you guys come online and you're like, you know what, I can't get to the MCP, I don't see it, you can still target it directly over HTTP and you don't even need it. So I want the equivalent of it existing as an HTTP because then you can say, oh, well, I'm going to DQ. Well, DQ should behave exactly the same. It should be a long pole that sits there and does exactly the same thing that the existing DQ does and, you know, pretty much have it all publicly exposed. The actions, all that stuff should be basically a REST, you know, API for those major tools, right? That needs to be spec'd out. There's no reason why we don't have it at this point."

## Problem

TMCP's tools are only accessible via MCP stdio protocol. When an agent cannot reach the MCP (server unreachable, MCP config missing, tool not registered), there is no fallback. A native HTTP REST API would allow agents to reach the bridge directly over HTTP, bypassing the MCP layer entirely.

Note: TMCP already runs an HTTP server (the SSE/dequeue endpoint IS HTTP). The MCP tool calls are already routed through the same HTTP server internally. This feature exposes those same operations as public REST endpoints.

## Required behavior

Every major TMCP MCP tool must have an HTTP equivalent at the same port and address as the existing SSE endpoint:

### Authentication
- Same token-based auth as current tools (session token in header or query param)

### Endpoints required (minimum for MVP)

| HTTP Method | Path | MCP equivalent |
|---|---|---|
| GET | `/dequeue` | `dequeue()` — long-poll, same semantics as SSE dequeue |
| POST | `/send` | `send()` |
| POST | `/action` | `action()` |
| GET | `/session/list` | `action(type: 'session/list')` |
| POST | `/session/start` | `action(type: 'session/start')` |
| POST | `/session/spawn-child` | `action(type: 'session/spawn-child')` |

### Dequeue behavior
The `/dequeue` endpoint must be a long-poll — blocks until a message is available or timeout, exactly like the current dequeue MCP tool. Should accept `max_wait` as a query parameter.

### Response format
Identical to the MCP tool responses. Same JSON shape. Same error codes.

## Needs spec

This task requires a spec phase before implementation:
1. Full endpoint inventory (which tools get REST equivalents?)
2. Authentication scheme (header vs query param vs both)
3. Versioning strategy (`/v1/...` prefix?)
4. Dequeue long-poll mechanism (reuse existing dequeue infrastructure)
5. Error response shape consistency with MCP error responses
6. Security considerations (CORS, rate limiting, who can reach this port)

## Acceptance Criteria

*To be defined during spec phase. At minimum:*
- [ ] All listed endpoints accessible via HTTP at TMCP's existing port
- [ ] `/dequeue` behaves as a long-poll with `max_wait` support
- [ ] Response shapes are identical to MCP tool responses
- [ ] Token authentication enforced on all endpoints
- [ ] `tsc --noEmit` passes
- [ ] All pre-existing tests pass
- [ ] New integration tests cover each HTTP endpoint

## Delegation

**Needs spec first.** Route to Overseer for spec gate before implementation.
Executor: Worker / Reviewer: Curator + Overseer

## Notes

- TMCP HTTP server already exists — this is additive, not a new server
- Dequeue SSE infrastructure already handles long-poll — can likely reuse
