---
id: "50-0866"
title: "TTS render timeout for hybrid sends (prevent silent indefinite block)"
type: task
priority: 50
status: queued
created: 2026-05-04
repo: Telegram MCP
delegation: Worker
depends_on: []
target_branch: release/7.5
---

# TTS render timeout for hybrid sends

## Background

From 2026-05-03 Overseer wedge postmortem.

Last tool call before Overseer wedged: a hybrid `text+audio` send card
at 18:37:05. Theory (un-proven, pattern-matched): the TTS render
hung server-side, the client-side request never returned, and the
agent's tool-call site was waiting indefinitely.

If TTS rendering hangs, the entire send blocks the agent. This is
indistinguishable from a healthy long-running send and provides no
escalation path.

## Goal

TTS-bearing sends (audio-only or hybrid text+audio) MUST complete
within a hard timeout. On timeout:

- Server returns a structured error to the client.
- Client receives it as a normal tool error (not a hang).
- Agent can recover, retry text-only, or surface the failure.

## Procedure

1. Find the TTS render path in the bridge (likely in `tts/` or
   wherever audio-rendering lives).
2. Wrap the render call in a timeout (proposal: 30s default,
   configurable).
3. On timeout: return a `tts_timeout` structured error response.
4. Update `send` tool docs (and `help('send')`) to document the new
   error case + recovery pattern.

## Acceptance criteria

- Hybrid sends with deliberately-broken TTS render path return
  structured error within timeout (not a hang).
- Timeout is configurable.
- Error is documented + caller-actionable.
- Existing healthy TTS flows unchanged (no regression).

## Out of scope

- Async TTS rendering (separate concern; this task is purely
  timeout + error path).
- Bridge auto-terminate (separate task: 50-0865).

## Dispatch

Worker. Sonnet for the timeout wrapping; Haiku for the test add.

## Bailout

Hard cap 2 hours. 15-min progress heartbeats. If TTS uses an
external provider with its own timeout semantics that conflict,
surface — don't double-timeout.

## Related

- `agents/curator/memory/projects/2026-05-03-overseer-wedge-postmortem.md`
- 50-0865 (auto-terminate) — sibling task.
