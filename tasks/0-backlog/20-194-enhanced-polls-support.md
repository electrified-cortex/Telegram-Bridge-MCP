---
Created: 2026-04-03
Status: Draft
Priority: 20
Source: Operator directive (voice)
Epic: Bot API 9.6
Repo: electricessence/Telegram-Bridge-MCP
Branch target: dev
Depends: 10-192
---

# 20-194: Enhanced Polls — Bot API 9.6 Poll Features

## Epic Context

Part of the **Bot API 9.6 epic**. Lower priority than Managed Bots but enables
structured agent-to-human feedback collection. See full analysis at
`cortex.lan/docs/research/2026-04-03-bot-api-96-analysis.md`.

Related tasks: 10-192 (prerequisite)

## Goal

Add MCP tools for creating and managing polls using the new Bot API 9.6 poll
features. Currently the bridge has no poll support at all.

## Bot API 9.6 — Poll Enhancements

- **Multiple correct answers** — quizzes can now have more than one correct answer
- **`allows_revoting`** — let users change their vote
- **`shuffle_options`** — randomize option order per user
- **`allow_adding_options`** — users can add new options to live polls
- **`hide_results_until_closes`** — blind voting until poll closes
- **`description` / `description_entities`** — rich text descriptions on polls
- **`persistent_id` on PollOption** — stable option identifiers across edits
- **`PollOptionAdded` / `PollOptionDeleted`** — update types for dynamic options
- **Reply to specific poll options** — granular feedback
- **Max close time extended** to 2,628,000 seconds (~30.4 days)

## Proposed MCP Tools

| Tool | Description |
| --- | --- |
| `send_poll` | Create and send a poll with 9.6 features |
| `close_poll` | Close an active poll |

## Use Cases for Agents

- **Structured feedback:** "Rate these three options" with results hidden until close
- **Team voting:** Revotable polls for decision-making across sessions
- **Dynamic surveys:** Users can add their own options

## Design Questions

1. **Poll tracking:** Do we need to track active polls? Or is send-and-forget OK?
2. **Result retrieval:** Should there be a `get_poll_results` tool?
3. **Event routing:** How to handle `PollOptionAdded`/`PollOptionDeleted` updates?

## Acceptance Criteria

- [ ] `send_poll` tool implemented with 9.6 parameters
- [ ] `close_poll` tool implemented
- [ ] Poll updates (`poll` type) routed through `dequeue_update`
- [ ] Dynamic option events handled
- [ ] Basic tests for poll creation and closure

## Reversal Plan

Remove new tool files. No existing functionality affected — polls are net-new.
