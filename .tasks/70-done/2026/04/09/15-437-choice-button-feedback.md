---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 15-437
Source: Operator testing session
---

# Non-Blocking Choice Button Feedback

## Objective

When the operator clicks a button on a non-blocking `type: "choice"` message, all buttons disappear without any visual feedback. The clicked button should be highlighted (or the message collapsed to show the selection), matching the blocking choose behavior.

## Context

- Blocking choose (via `type: "question"`) already works correctly: collapses and shows "→ [selected option]".
- Non-blocking `type: "choice"` (via `handleSendChoice`) just removes the inline keyboard after a callback without editing the message to show what was selected.
- This is 10-432 in backlog (choose button highlight on click) — upgrading to queued with clearer spec after testing confirmed the issue.
- The callback comes through as a `cb` event with `data` matching the `value` from the option.

### Related

- Supersedes 10-432 (backlog) — same issue, better spec.

## Acceptance Criteria

- [ ] After clicking a non-blocking choice button, the message is edited to show "→ [selected label]"
- [ ] Remaining buttons are removed from the message
- [ ] The callback event is still delivered via dequeue as before
- [ ] Blocking choose behavior remains unchanged (already working)
- [ ] Existing tests pass; new tests cover non-blocking choice feedback
