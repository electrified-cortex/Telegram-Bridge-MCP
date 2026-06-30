# 10-3080 — Checklist message_id lost after agent compaction

**Date:** 2026-06-29
**Source:** Operator voice (msg 82077), Overseer capture
**Repo:** electrified-cortex/Telegram-Bridge-MCP

## Problem

When an agent creates a checklist and then compacts, the checklist message_id is not persisted to the new session's in-memory store. If the operator replies to the checklist message after compaction, the agent responds with "I didn't make that" because the message_id is unknown to the new session.

The operator notes this is a pseudo-memory leak: checklists are retained in the bridge's in-memory store until marked complete, but the agent session that created them has no record after compaction.

## Impact

- Agents cannot update their own checklists after compaction
- Operator gets confusing "I didn't make that" errors when referencing checklist replies
- Active checklists accumulate in bridge memory until manually cleared or completed

## Root cause (suspected)

Bridge stores active checklist message_ids in per-session in-memory store only. No persistence or reconnect API to recover a session's active checklists after compaction.

## Acceptance criteria

- [ ] AC-1: After agent compaction, agent can reconnect to and update a checklist it created in the prior session (e.g. via `action(type: 'checklist/list')` or similar reconnect mechanism)
- [ ] AC-2: Bridge exposes a way to query active checklists for the current session, returning message_ids
- [ ] AC-3: OR: checklist message_ids are included in the `post_compact_monitor_recovery` event payload so the agent can self-recover
- [ ] AC-4: Bridge cleans up completed/abandoned checklists to prevent unbounded memory growth

## Notes

- One solution: include active checklist message_ids in compaction recovery event
- Another: `action(type: 'checklist/list')` returns all active checklists for this session
- Mitigation now: agents should write checklist message_ids to handoff.md so next session can reference them
