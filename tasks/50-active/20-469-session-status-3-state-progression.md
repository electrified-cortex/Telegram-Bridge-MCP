---
Created: 2026-04-11
Status: Backlog
Host: local
Priority: 20-469
Source: Operator
Target: v6.0.1
---

# 20-469: Session status 3-state progression with idle timer

## Problem

Current session status uses `🔴 Active` which is misleading — red implies
bad state. The "Worker 1 appears unresponsive" message uses ⚠️ which is
too alarming for a soft status.

## Proposed Behavior

### Session status 3-state progression

| State | Emoji | Condition | Display |
| --- | --- | --- | --- |
| Active | 🟢 | Recent activity | `🟢 Active` |
| Unresponsive | 🟡 | 5+ minutes idle | `🟡 Unresponsive (Xs idle)` |
| Inactive | 🔴 | 10+ minutes idle | `🔴 Inactive (Xs idle)` |

All non-active states show seconds since last activity.

### Warning message emoji

"Worker 1 appears unresponsive" should use 🟡 instead of ⚠️ — matches
the unresponsive state color.

## Acceptance Criteria

- [ ] Active sessions show `🟢 Active`
- [ ] Sessions with no recent activity transition to `🟡 Unresponsive (Xs idle)` after 5 minutes
- [ ] After 10 minutes idle, transitions to `🔴 Inactive (Xs idle)`
- [ ] Idle seconds displayed in unresponsive and inactive states
- [ ] "appears unresponsive" messages use 🟡 not ⚠️
