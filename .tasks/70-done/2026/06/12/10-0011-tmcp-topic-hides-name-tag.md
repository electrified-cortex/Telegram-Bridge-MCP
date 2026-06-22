---
created: 2026-06-12
status: draft
priority: 10
type: Bug
agent_type: Worker
repo: electrified-cortex/Telegram-Bridge-MCP
---

# 10-0011 — Bug: profile/topic set causes name tag to disappear from messages

## Summary

When a session sets `profile/topic` via `action(type: "profile/topic", topic: "...")`, the
auto-injected name tag (`🤖 AgentName`) is absent from outbound messages. Without a topic,
the name tag appears correctly.

## Reproduction

1. Start a session with a known name (e.g. "Overseer")
2. Call `action(type: "profile/topic", topic: "TMCP")`
3. Send any message — name tag is missing
4. Clear topic: `action(type: "profile/topic", topic: "")`
5. Send another message — name tag reappears

## Expected

Name tag should appear on ALL outbound messages regardless of whether a topic is set.
Topic and name tag are independent display elements; setting one should not suppress the other.

## Acceptance Criteria

1. `send(type: "text", text: "hello")` with an active topic includes the `🤖 AgentName` line.
2. `send(type: "notification")` with an active topic includes the name tag.
3. Regression test: existing topic behavior (topic prefix in message) is preserved.
4. No behavior change when topic is unset.

## Scope boundary

- Fix the name tag injection logic when topic is active.
- Do not change topic formatting or position.

## Notes

- Operator reported as "still" — was known before, not yet fixed.
- Surfaced 2026-06-12 during Overseer triage session.


## Verification

APPROVED 2026-06-12 — Verifier confirmed all 4 ACs: early-return guard in buildHeader() removed, name tag now coexists with topic prefix, 5 tests added/updated (outbound-proxy.test.ts), 3437/3437 pass. Commit 40c8a1da.

Sealed-By: foreman
