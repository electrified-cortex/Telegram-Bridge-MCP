---
id: "10-0890"
title: "Spike: @mention agent-to-agent messaging in Telegram"
type: spike
priority: 30
status: draft
created: 2026-05-07
filed-by: Overseer
delegation: Worker
target_repo: Telegram MCP
needs-curator-review: true
target_branch: dev
---

# Spike: @mention agent-to-agent messaging in Telegram

## Problem

Agents communicating through Telegram currently use DMs (session-routed messages) or
broadcast to the main chat. There's no native @mention mechanism that lets one agent
address another by name within a shared chat context.

Telegram's native @mention system triggers notifications and highlights — if TMCP can
expose this, agents could have more natural inter-agent conversations visible to the
operator without requiring separate DM sessions.

## Operator framing (msg 51226, 2026-05-07)

> "Bot-to-bot we do better. @mention its own spike."

Context: The operator reviewed the Telegram AI bot update blog post and identified
@mention as a distinct capability worth investigating separately from the streaming text
spike (10-0889).

## Core questions

1. Can an agent send a message that @mentions another bot/agent by its Telegram username?
2. Does TMCP's `send` tool support MarkdownV2 @mention syntax, or does it strip/escape it?
3. What's the Telegram API behavior when a bot @mentions another bot — does it trigger
   a notification in the second bot's update queue?
4. Is there a routing pattern where Agent A @mentions Agent B and B can respond in-thread?
5. What's the difference between @mentioning a Telegram username vs. the name-tag system
   TMCP uses internally?

## Acceptance criteria (spike)

- Document whether @mention delivery is technically feasible end-to-end (send → notify → receive).
- Identify what, if any, TMCP changes are needed to support it.
- Estimate complexity: trivial tweak, small feature, or new architecture?
- Recommend proceed / no-proceed for a v7.5/v8 implementation task.

## Bailout

2 hours. If the answer is definitively "bots can't notify other bots via @mention in
Telegram" — that's a valid result; document it and close.

## Related

- `10-0889` — streaming text output spike (separate operator P1 feature)
- Operator session 2026-05-07, msg 51226
- Telegram blog: https://telegram.org/blog/ai-bot-revolution-11-new-features
