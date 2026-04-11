---
Created: 2026-04-10
Status: Queued
Host: local
Priority: 05-461
Source: Operator (friction incident — Curator misrouted DM to group)
---

# 05-461: Add `target` as alias for `target_sid` in send tool

## Objective

Allow `target` as a parameter alias for `target_sid` when using `send(type: "dm")`.
Agents naturally write `target: 4` instead of `target_sid: 4`, causing silent parameter
drops and misrouted messages. This is a friction reduction change.

## Context

During a live session, Curator sent `send(type: "text", target: 4, text: "...")` intending
a DM. The `target` parameter was silently ignored (not in schema), so the message went to
the group. The correct call was `send(type: "dm", target_sid: 4, text: "...")`.

The `send_direct_message` standalone tool already uses `target_sid`. The unified `send` tool
routes `type: "dm"` to the same handler. Adding `target` as an alias in the unified `send`
schema prevents this class of error.

## Acceptance Criteria

- [ ] `send(type: "dm", target: 4, text: "hello")` delivers a DM to SID 4
- [ ] `send(type: "dm", target_sid: 4, text: "hello")` continues to work (no regression)
- [ ] If both `target` and `target_sid` are provided and differ, return an error
- [ ] If both are provided and match, use the value without error
- [ ] `target` is documented in the schema `.describe()` as alias for `target_sid`
- [ ] Existing tests pass; at minimum one new test for the alias path
