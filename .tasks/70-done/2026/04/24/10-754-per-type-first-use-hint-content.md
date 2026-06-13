# 10-754 — Define per-type first-use hint content for bridge features

## Context

Task 10-753 introduces a first-time-use hint system that fires once per `send` type
per session. This task defines the actual hint text for each type — what to say, what
alternative to mention, and what help pointer to include.

## Hint Specs Per Type

### `send(type: "choice")`

> **First use — non-blocking buttons**: `send(type: "choice")` sends an inline keyboard but does NOT wait for a reply. If you need to
> block and get the response in the same call, use `send(type: "question", choose: [...])` instead.
> See `help("send")` → choice/question comparison.

### `send(type: "question", choose: [...])`

> **First use — blocking button prompt**: `send(type: "question", choose: [...])` blocks until the operator selects a button (or timeout). If you
> want non-blocking buttons (fire-and-forget), use `send(type: "choice")` instead.
> See `help("send")` → choice/question comparison.

### `send(type: "progress")`

> **First use — progress bar**: Creates a pinned bar. Update with `action(type: "progress/update", percent: N)`.
> Close explicitly when done — orphaned bars stay pinned until dismissed.
> See `help("progress")`.

### `send(type: "checklist")`

> **First use — pinned checklist**: Creates a pinned step-status list. Update individual steps with
> `action(type: "checklist/update", step: N, status: "done")`.
> See `help("checklist")`.

### `send(type: "animation")`

> **First use — ephemeral animation placeholder**: Replaces itself when you send the real message. Do NOT leave an animation
> running indefinitely — always resolve it with `action(type: "animation/cancel")`.
> See `help("animation")`.

### `send(type: "append")`

> **First use — in-place message growth**: Appends text to an existing message without creating a new one. Only works on
> messages from the current session. Keep accumulated length under 3800 chars.
> See `help("send")` → Append Mode section.

## Acceptance Criteria

- [ ] Hint text for all 6 types above is implemented in 10-753's hint system
- [ ] Each hint is ≤ 3 sentences + one help reference
- [ ] Hints are reviewed by operator before shipping (or approved via this doc)
- [ ] Hint content is version-controlled alongside the send handler code

## References

- Operator voice directive 2026-04-21 triage session
- Depends on: 10-753 (first-time-use hint system)
