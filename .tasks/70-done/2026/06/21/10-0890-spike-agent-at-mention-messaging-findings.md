# Spike Findings: @mention Agent-to-Agent Messaging in Telegram

**Task:** 10-0890  
**Date:** 2026-06-21  
**Branch:** `worker/10-0890-spike-agent-at-mention-messaging`  
**Investigator:** Worker agent (worker/10-0890)

---

## Feasibility Verdict

**Cosmetic @mention (text only): FEASIBLE TODAY — zero code changes required.**

**End-to-end @mention (send → notify → receive): NOT FEASIBLE in the current 1-on-1 architecture.**

TMCP is architecturally a single-user private-chat bridge. The send pipeline passes `@username` text through unchanged, so an agent can write `@botusername` and it renders as a clickable mention link in Telegram. But the current model hard-wires all traffic to one private conversation (`ALLOWED_USER_ID`). A mentioned bot has no presence in that private chat and receives no updates.

Full end-to-end routing requires the group-chat edition (already roadmapped in `docs/group-chat-roadmap.md`).

---

## Core Questions — Answered

### Q1: Can an agent send a message that @mentions another bot/agent by its Telegram username?

**Yes.** The `send` tool accepts any text string. The `@` character is not blocked or validated. Passing `text: "Hey @OtherBot, status?"` results in that string being sent to Telegram.

### Q2: Does TMCP's `send` tool support MarkdownV2 @mention syntax, or does it strip/escape it?

**`@` passes through unchanged.** The `markdownToV2()` conversion function in `src/markdown.ts` (line 23) defines the MarkdownV2 special-character set as:

```ts
const V2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;
```

`@` is absent from this regex. For text sent with `parse_mode: "Markdown"` (the default), `markdownToV2()` escapes MarkdownV2 specials but leaves `@` alone. Telegram clients auto-render `@username` as a clickable mention entity.

**Evidence:** `src/markdown.ts:23`

### Q3: What's the Telegram API behavior when a bot @mentions another bot — does it trigger a notification in the second bot's update queue?

**Depends entirely on the chat context:**

| Context | Behavior |
|---|---|
| **Private chat (current TMCP model)** | Mentioned bot receives **nothing** — it is not a participant in the private chat. The `@mention` is just display text. |
| **Group chat (future group edition)** | Mentioned bot receives a `message` update containing the text, with an `entities` array including `{ type: "mention", offset, length }`. No special push-notification; the bot sees it on its next `getUpdates` poll. |

Key Bot API constraint: Bots in groups only receive messages where they are @mentioned (or replies to their messages) unless the group has `privacy_mode` disabled for that bot. They do **not** get a real-time push notification distinct from the message update itself. The receiving bot polls `getUpdates` and processes the message.

**TMCP-specific blocker:** `filterAllowedUpdates()` in `src/telegram.ts` (lines 366–379) filters out any update whose sender is not `ALLOWED_USER_ID`. Bot-originated messages have `from.is_bot = true` and a different `from.id` — they would be silently dropped even if TMCP were running in a group.

**Evidence:** `src/telegram.ts:59-64` (`DEFAULT_ALLOWED_UPDATES`), `src/telegram.ts:366-379` (`filterAllowedUpdates`)

### Q4: Is there a routing pattern where Agent A @mentions Agent B and B can respond in-thread?

**Not in the current architecture.** Three hard constraints block it:

1. **Single private chat** — `resolveChat()` (`src/telegram.ts:391-400`) always returns `ALLOWED_USER_ID`. There is no shared group context where both bots participate.
2. **Inbound filter** — `filterAllowedUpdates()` drops all non-operator updates; a second bot's message would be silently consumed.
3. **No peer dequeue** — the dequeue system exposes only operator messages to agents. There is no mechanism for Agent B to "receive" a Telegram message from Agent A through TMCP's queue.

The existing `send(type: "dm")` already provides private inter-agent messaging, but it routes through TMCP's internal session queue and never appears in Telegram at all. It is the correct tool for agent-to-agent signaling in the current architecture.

**What would be required** (see Q5 below for complexity): group-chat edition.

### Q5: What's the difference between @mentioning a Telegram username vs. the name-tag system TMCP uses internally?

They are entirely separate mechanisms with no overlap:

| Aspect | Telegram @mention | TMCP name-tag |
|---|---|---|
| **What it is** | Telegram username link — native API-level entity (`type: "mention"`) | Display label injected as monospace prefix in messages |
| **Source** | `@botusername` — Telegram account username | `session.name_tag` or auto-computed `<color> <name>` |
| **Where defined** | Telegram platform | `src/tools/name-tag.ts` — arbitrary string (max 64 chars) |
| **Injection** | Agent writes it in text | `outbound-proxy.ts` `buildHeader()` prepends it when 2+ sessions active |
| **Routing capability** | Delivers Telegram mention entity to mentioned user (if in same chat) | None — cosmetic only |
| **Operator visibility** | Clickable link in Telegram UI | Monospace prefix in message body (e.g., `` `🔵 Agent-1` ``) |
| **Agent routing** | Not connected to any agent routing | Not connected — identifies sender for operator's benefit |

The name-tag system was designed to let the human operator see which TMCP session sent each message. It has no Telegram-username correlation and provides no routing capability.

**Evidence:** `src/tools/name-tag.ts:12-15` (`resolveNameTag`), `src/outbound-proxy.ts:36-57` (`buildHeader`)

---

## TMCP Changes Needed

### For cosmetic @mention only (already works — zero changes)

None. Agents can include `@botusername` in any `send` text today. Telegram renders it as a mention link.

### For full end-to-end @mention routing (group-chat edition required)

| Change | Scope | File(s) |
|---|---|---|
| Group-chat config (`ALLOWED_GROUP_ID`, group member auth) | New architecture | `src/config.ts`, `src/telegram.ts` |
| `resolveChat()` — support group chat IDs | Architecture | `src/telegram.ts:391-400` |
| `filterAllowedUpdates()` — accept messages from other bots (with loop guard) | Medium | `src/telegram.ts:366-379` |
| Dequeue/session queue — expose peer-bot messages as addressable events | Medium-large | `src/dequeue-endpoint.ts`, `src/session-queue.ts` |
| Bot-loop prevention (`from.is_bot` filter) | Small | `src/telegram.ts` |
| `send` tools — accept `chat_id` / `reply_to` context for thread replies | Medium | `src/tools/send.ts`, `src/tools/send/*.ts` |

This is the Phase 1–3 scope of `docs/group-chat-roadmap.md`. It is not a standalone @mention feature.

---

## Complexity Estimate

| Scenario | Estimate |
|---|---|
| Send `@botusername` in text (cosmetic only) | **Trivial — already works** |
| `text_mention` entity support (mention bots without usernames) | **Small feature** — add `entities` param to API call |
| Full end-to-end bot-to-bot @mention with delivery and response | **New architecture** — this is the group-chat edition |

---

## Proceed / No-Proceed Recommendation

**NARROW PROCEED — document the cosmetic capability; no code change.**  
**NO STANDALONE PROCEED on full @mention routing.**

Rationale:

1. **Cosmetic @mention already works.** Agents can include `@botusername` in any `send` message today. Worth documenting in the send help docs (e.g., `docs/help/send.md`) so agents know they can use it. Cost: 0.

2. **Full routing is the group-chat problem.** The missing pieces (shared group context, `resolveChat()` rework, inbound bot-message handling, dequeue extensions) are exactly the scope of the group-chat roadmap. Filing a separate @mention task that requires all this infrastructure is redundant.

3. **DM is the right tool for agent-to-agent now.** `send(type: "dm")` already provides private, reliable inter-agent signaling. It is internal, doesn't hit Telegram rate limits, and has full attribution (`sid` is server-injected and unforgeable). @mention does not improve on it for the 1-on-1 edition.

4. **Proceed path if group-chat edition starts:** Add @mention trigger detection (`isTrigger()` helper) to Phase 1 of the group roadmap. Bots replying to `@mention` is the recommended trigger model already in the roadmap.

---

## Evidence Summary

| Claim | Source |
|---|---|
| `@` not escaped in MarkdownV2 | `src/markdown.ts:23` — `V2_SPECIAL` regex |
| `parse_mode: "Markdown"` default converts via `markdownToV2` | `src/tools/send.ts:473` |
| `resolveChat()` always targets single `ALLOWED_USER_ID` | `src/telegram.ts:391-400` |
| Inbound filter drops non-operator updates | `src/telegram.ts:366-379` |
| DM is internal-only, never hits Telegram | `src/tools/send/dm.ts:13-14` |
| Group-chat edition roadmapped | `docs/group-chat-roadmap.md` |
| @mention recommended as group trigger mode | `docs/group-chat-roadmap.md:43-55` |
| Name-tag system is cosmetic only | `src/outbound-proxy.ts:36-57`, `src/tools/name-tag.ts:12-15` |
