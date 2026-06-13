---
id: 15-802
title: Silence detector should count agent outbound MCP activity as presence
status: idea
priority: 15
origin: operator 2026-04-24 voice 41685
marker: needs refinement
---

# Silence detector should count agent outbound MCP activity as presence

## Operator observation

> Source: operator voice msg 41685, 2026-04-24 (distilled).

The "waiting for curator to come back" messages don't recognize outbound activity — e.g.
sending a voice message — as a sign of presence. Any input activity into the MCP should count
as a signal that something is happening, rather than relying solely on a pending dequeue.

## Issue

The silence detector (behavioral-shaping system) appears to fire "curator silent for N seconds" nudges based purely on time-since-last-dequeue, ignoring other MCP activity from the same session:

- `send` (text, voice, hybrid) — outbound messages
- `action(type: "react")` — reactions
- `action(type: "animation/*")` — animation triggers
- `action(type: "profile/*")` — profile updates
- Any other tool call from the agent's session

When Curator is composing a multi-paragraph response or running parallel work, she IS active — but the silence detector doesn't see it because the clock only ticks on dequeue.

## Desired behavior

ANY tool invocation from a live session token should reset the silence-detector clock for that session. Nudges fire only when the session has been genuinely idle (no tool calls of any kind) for the threshold window.

## Open refinement

- Does "activity" include *every* tool call, or just user-facing ones (send, react, animation)? Arguably every call — if the agent is doing ANYTHING in the session, it's not stuck.
- Does this interact with the nudge cadence / rung escalation? Clock reset should reset the rung, too.
- Any perf concern if activity ticks on every tool call? Likely negligible.

## Acceptance criteria (pending refinement)

- Sending a voice or text message during a "silent" window resets the clock.
- Calling `action(type: "react")` during a silent window resets the clock.
- Animation triggers count as activity.
- Confirmed: operator no longer sees "waiting for curator" while curator is actively composing.
