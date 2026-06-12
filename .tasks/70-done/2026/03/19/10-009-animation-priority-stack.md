# 009 — Animation Priority Stack

**Type:** Feature
**Priority:** 10 (high — affects multi-session UX)
**Status:** Queued

## Problem

Currently, only one animation can run at a time across all sessions. `show_animation` silently replaces whatever is active. In multi-session:

- Session 1 starts a persistent "working" animation
- Session 2 starts a temporary "thinking" animation → Session 1's is gone
- Session 2's animation expires → nothing. Session 1's persistent animation is lost forever.

Within a single session the same issue exists: a temporary animation wipes a persistent one.

## Design

### The Stack

A priority-ordered stack of animation entries. Each session gets **one slot** (calling `show_animation` replaces that session's own entry). The **top entry** (highest priority, ties broken by recency) is what the operator sees in Telegram.

```text
Stack (top = displayed):
  [priority 5, temporary,  "thinking", session 2, timeout 30s]  ← displayed
  [priority 0, persistent, "working",  session 1]                ← buried

Session 2 times out →
  [priority 0, persistent, "working",  session 1]               ← resumes
```

### Rules

1. **Priority**: integer, default `0`. Higher number = higher precedence. Negative values allowed.
2. **Ties**: same priority → most recent entry wins (displayed on top).
3. **One slot per session**: a new `show_animation` from the same session replaces that session's previous entry regardless of priority.
4. **Persistent vs temporary**: persistent entries have no timeout and stay until explicitly cancelled. Temporary entries have a wall-clock timeout.
5. **Timeouts tick always**: a temporary animation's countdown runs in wall-clock time, whether it's displayed or buried. If it expires while buried, it's silently removed from the stack.
6. **Cascade on removal**: when the displayed entry expires or is cancelled, the next-highest-priority active entry becomes displayed. If the stack is empty, no animation is shown.
7. **Cancel scope**: `cancel_animation` cancels the calling session's own entry. No cross-session cancellation (governors don't get special cancel powers on other sessions' animations).
8. **Pruning**: if a buried entry will never be shown (a same-or-higher-priority entry above it has a longer remaining TTL), the buried entry may be pruned immediately. This is an optimization, not a requirement for correctness.
9. **No governor special treatment**: all sessions follow the same rules.

### Scenarios

**Single session, persistent then temporary:**
- Session 1: `show_animation("working", persistent, priority 0)` → displayed
- Session 1: `show_animation("thinking", timeout 30s, priority 0)` → **replaces own entry** (same session, one slot). Working is gone.
- This is existing behavior and remains correct — if a session wants to preserve its persistent animation, it shouldn't replace it.

**Two sessions, same priority:**
- Session 1: `show_animation("working", persistent, priority 0)` → displayed
- Session 2: `show_animation("thinking", timeout 30s, priority 0)` → displayed (recency wins at same priority). Session 1 buried.
- Session 2 times out → Session 1 resumes.

**Two sessions, different priority:**
- Session 1: `show_animation("working", persistent, priority 0)` → displayed
- Session 2: `show_animation("thinking", timeout 30s, priority 5)` → displayed (higher priority). Session 1 buried.
- Session 2 times out → Session 1 resumes.

**Two temporaries, same priority, different timeouts:**
- Session 1: `show_animation("working", timeout 60s, priority 0)` → displayed
- Session 2: `show_animation("thinking", timeout 30s, priority 0)` → displayed (recency at same priority). Session 1 buried, still ticking.
- Session 2 times out at T+30 → Session 1 resumes (30s remaining).
- Session 1 times out at T+60 → empty stack.

**Cancel while buried:**
- Session 1: persistent, priority 0 (buried)
- Session 2: temporary, priority 5 (displayed)
- Session 1 cancels → removed from stack silently. Session 2 unaffected.
- Session 2 times out → empty stack.

## Implementation

### Code Changes

1. **`src/animation-state.ts`** — refactor from single-slot to priority stack
   - Stack data structure: array of `{ sid, priority, persistent, timeout, startedAt, ...animationConfig }`
   - Sort: by priority desc, then by startedAt desc (recency)
   - `push(entry)`: replace existing entry for same SID, then re-sort, then update display
   - `remove(sid)`: remove entry for SID, cascade display if it was on top
   - `tick()` or timer-based: check for expired temporaries, remove them, cascade
   - `getDisplayed()`: return top of stack or null
   - `isEmpty()`: true if no entries

2. **`src/tools/show_animation.ts`** — add optional `priority` parameter (integer, default 0)

3. **`src/tools/cancel_animation.ts`** — call `remove(callerSid)` instead of clearing global state

4. **Tests** — test-driven development strongly encouraged:
   - Single session: push, replace own, cancel, timeout
   - Two sessions: same priority (recency), different priority (higher wins)
   - Cascade: top expires → next resumes
   - Cancel while buried
   - Timeout ticks while buried
   - Pruning optimization (buried entry that can never surface)
   - Empty stack after all entries removed

## Worktree

Create worktree `10-009-animation-priority-stack` from the current branch (`v4-multi-session`).
Branch: `task/009-animation-priority-stack`

```bash
git branch task/009-animation-priority-stack
git worktree add .git/.wt/10-009-animation-priority-stack task/009-animation-priority-stack
```

## Acceptance Criteria

- [ ] Priority stack replaces single animation slot in `animation-state.ts`
- [ ] `show_animation` accepts optional `priority` parameter
- [ ] Highest-priority active animation is displayed; ties broken by recency
- [ ] One slot per session — `show_animation` replaces own entry
- [ ] Temporary timeouts tick in wall-clock time (even while buried)
- [ ] Expiry/cancellation cascades to next entry in stack
- [ ] Empty stack → no animation displayed
- [ ] `cancel_animation` only affects calling session's own entry
- [ ] All existing animation tests still pass
- [ ] New tests cover multi-session interleaving, cascade, timeout-while-buried
- [ ] TDD approach: write tests first, then implement

## Notes

- Pre-approved to commit and push within worktree branch.
- Do **not** move this task file.
- Read `tasks/worktree-workflow.md` for the full workflow reference.
- [ ] Timeout behavior for buried animations defined and implemented
- [ ] Tests cover all stack operations
- [ ] Build clean, lint clean, all tests pass
- [ ] `changelog/unreleased.md` updated
