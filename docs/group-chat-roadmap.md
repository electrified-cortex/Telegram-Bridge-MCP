# Group Chat Roadmap

This document tracks the design decisions and implementation plan for a group-capable edition of Telegram Bridge MCP.

The 1-on-1 edition (`master`) remains unchanged — group support is being developed separately to keep the security models cleanly isolated.

---

## Why a Separate Edition?

The current server is built around a strict single-user / single-chat contract:

- Every inbound update is from *one* trusted operator.
- Every outbound message goes to *one* configured chat.
- `dequeue` returns the *next* queued update from one trusted operator — no routing needed.

Group chat breaks every one of those assumptions. Rather than bolt-on conditionals that weaken the 1-on-1 security story, this edition starts fresh with group-native assumptions.

---

## Core Design Problems to Solve

### 1. Authorization Model

Who is allowed to address the bot?

**Decision required:** Choose one or a combination of:

| Model | Description | Notes |
| --- | --- | --- |
| Group membership | Any member of the allowed group | Open, easy to abuse |
| Allowlist | Explicit `user_id` whitelist in config | Easiest to audit |
| Admin-only | Only group admins can issue tasks | Good for managed deployments |
| Role-based | Config maps `user_id` → role (`owner`, `member`, `read-only`) | Most flexible, most complex |

Starting recommendation: **allowlist** for v1, admin-only as an alternative flag, role-based deferred.

---

### 2. Trigger Model

How does the bot know it's being addressed?

In a group, the bot sees *all* messages. It must filter for intentional ones:

| Trigger | Reliability | UX |
| --- | --- | --- |
| `@bot_username` mention | High | Natural, easy to forget |
| Reply to bot message | High | Great for follow-ups, awkward cold-start |
| Slash command (`/ask ...`) | High | Feels clunky but unambiguous |
| Any message (open) | N/A | Bot-loop risk, noise |

**Recommended pattern:** `@mention` for cold-start + reply-chain for follow-up. Slash commands as an optional escape hatch (e.g. `/cancel`, `/status`).

---

### 3. Session / Context Boundaries

How are concurrent conversations tracked?

A single group produces messages from multiple users at once. The agent needs to know *which conversation* each message belongs to.

**Options:**

| Strategy | Isolation | Complexity |
| --- | --- | --- |
| Reply thread (chain from first bot message) | Per conversation | Low — Telegram does the threading |
| Forum topic per user | Per user | Medium — requires forum-enabled supergroup |
| Active session lock | One at a time, queued | Low — simple but users wait |
| Parallel sessions | Fully concurrent | High — agent needs multi-context support |

**Recommended for v1:** Reply-thread isolation. Each task starts from a trigger message; all replies in that chain are part of the same session. No topic infrastructure required.

---

### 4. The `dequeue` Problem

Currently `dequeue` returns the *next* update from the operator. In a group that contract is undefined.

Group-native replacement must:

1. Accept a `thread_root_message_id` — listen only for replies in that chain.
2. Accept a `user_id` filter — optionally limit to the user who triggered the session.
3. Include `from` in every returned update (who said it, their display name).

A new `wait_for_reply` tool may be cleaner than extending `dequeue` with thread-scoping.

---

### 5. Outbound Targeting

Sending must be scoped to the right thread so replies appear in context.

All send tools need:

- `reply_to_message_id` for threading (already supported on most tools, but not always passed)
- `chat_id` as a passable param (already exists on most tools)
- A conversation context object the agent can pass through rather than tracking manually

A **session context** struct — `{ chat_id, thread_root_message_id, user_id }` — could be returned by `wait_for_trigger` and passed to all subsequent sends.

---

### 6. Bot-vs-Bot Loop Prevention

In a group with multiple bots, one bot's reply can trigger another. Must filter out:

- Messages where `from.is_bot === true`
- Our own messages (match against `get_me()` result)

---

## Implementation Plan

### Phase 1 — Foundation (no new tools yet)

- [ ] New entry point / package config
- [ ] Group-aware config: `ALLOWED_GROUP_ID`, `ALLOWED_USER_IDS` (array), `TRIGGER_MODE` (`mention` | `reply` | `command` | `any`)
- [ ] `isAuthorized(update)` helper — user allowlist + bot filter
- [ ] `isTrigger(update, botUsername)` helper — trigger mode routing
- [ ] Update filter pipeline: incoming updates pass through `isAuthorized` → `isTrigger` → buffer

### Phase 2 — Session Model

- [ ] `SessionContext` type: `{ chat_id, trigger_message_id, user_id, username }`
- [ ] `wait_for_trigger` tool — long-polls for next authorized trigger message, returns `SessionContext`
- [ ] `wait_for_reply` tool — long-polls for next reply in a session's thread, returns message + `from`
- [ ] Session recording keyed by `(chat_id, trigger_message_id)`

### Phase 3 — Adapted Send Tools

- [ ] All send tools accept `SessionContext` (or explicit `reply_to_message_id` + `chat_id`)
- [ ] `show_typing` (with `cancel: true` to stop) scoped per session
- [ ] `confirm` / `choose` / `ask` work within reply thread

### Phase 4 — Multi-Session Concurrency (deferred)

- [ ] Multiple simultaneous `wait_for_trigger` loops (one per pending session)
- [ ] Agent architecture guidance for concurrent sessions

### Phase 5 — Forum Topic Mode (deferred)

- [ ] Optional `ISOLATION_MODE=topic` — creates/reuses a forum topic per user on first contact
- [ ] Topic ID tracked in session context
- [ ] All session messages go to user's dedicated topic

---

## Security Model Differences

| Aspect | 1-on-1 Edition | Group Edition |
| --- | --- | --- |
| Inbound trust | Single `ALLOWED_USER_ID` | Allowlist of `user_id`s |
| Outbound targeting | Single user ID (= chat target) | Locked to `ALLOWED_GROUP_ID` |
| Session isolation | Implicit (only one conversation) | Explicit via reply thread or topic |
| Bot loop risk | N/A | Must filter `from.is_bot` |
| Authorization surface | 1 user | N users — larger attack surface |

The group security model will be documented in a separate `GROUP-SECURITY-MODEL.md` once Phase 1 design is finalized.

---

## Open Questions

1. **Package structure** — Same repo (separate entry point/config) or new repo? Current lean: same repo, different entry point, shared `src/` utilities.
2. **Config format** — `ALLOWED_USER_IDS=123,456,789` env var string, or a config file (`group-config.json`)?
3. **Trigger mode default** — `mention` only, or `mention + reply`? Affects how conversational the bot feels.
4. **Multi-agent groups** — What if two AI agents share one group? Out of scope for now but worth flagging.
5. **Rate limiting per user** — Should each user in the group get their own rate-limit bucket?
