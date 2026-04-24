# 10-753 — Add first-time-use hint system for bridge features

## Context

When an agent uses a bridge feature for the first time (e.g., `send(type: "choice")`,
`send(type: "progress")`), there is currently no guidance about alternatives or related
features. First-time callers lack context on what they chose vs. what they could have
chosen. This creates friction and incorrect feature selection.

## Problem

An agent may use `send(type: "choice")` (non-blocking) when it needed
`send(type: "question", choose: ...)` (blocking), or vice versa — with no in-product
hint available at the decision point. The first time a feature is used is the highest-
value moment to surface this guidance.

## Proposed Behaviour

1. The bridge tracks first-time usage of each `send` type per session (or across
   sessions via a lightweight flag).
2. On first use of a type, the bridge appends a **one-time hint** to the response:
   - What the feature is for
   - When to prefer the alternative
   - A pointer to the help topic (`help("send")`)
3. Hint is **never shown again** after the first use of that type.
4. Hint format: lightweight footer in the tool response (not a Telegram message).

## Scope

- `send` types minimum: `choice`, `question`, `progress`, `checklist`, `animation`
- Hint content per type defined in a companion task (10-754)
- Session-scoped tracking acceptable for v1 (reset on restart)

## Acceptance Criteria

- [ ] First call to `send(type: "choice")` includes a hint about `question/choose`
- [ ] Hint is NOT shown on the second call to the same type
- [ ] Hint content follows the per-type spec in 10-754
- [ ] No Telegram message is sent — hint lives in the tool response only
- [ ] Covered by at least one integration test per type

## References

- Operator voice directive 2026-04-21 triage session
- Related: 10-754 (per-type hint content), `help("send")`
