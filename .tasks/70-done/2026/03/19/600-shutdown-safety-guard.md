# 600 — Shutdown Safety Guard

**Priority:** 500 (Medium)
**Source:** Operator request (2026-03-22)

## Goal

Prevent accidental shutdown when there are pending messages in the queue.

## MCP tool (`shutdown`)

- If pending messages exist, **fail** with an error explaining why (e.g. "3 pending updates in queue — process them first or pass `force: true`")
- Add a `force: boolean` flag that bypasses the guard

## Built-in command (`/shutdown`)

- If pending messages exist, show a `confirm` dialog: "There are N pending messages. Shut down anyway?"
- If no pending messages, shut down immediately (current behavior)
