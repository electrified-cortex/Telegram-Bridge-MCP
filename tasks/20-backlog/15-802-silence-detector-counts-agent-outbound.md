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

"The waiting for curator to come back messages don't seem to respond to you or identify that when you're sending a voice message or something like that, that that actually is a point of activity. Like input activity into the MCP should be enough to say, oh, there's something going on, not just waiting for a DQ or something like that."

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
