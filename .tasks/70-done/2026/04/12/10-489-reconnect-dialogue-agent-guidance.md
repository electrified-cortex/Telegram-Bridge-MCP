---
id: 10-489
title: Session reconnect flow — API split + agent-facing guidance
priority: 15
type: improvement
status: draft
created: 2026-04-11
---

# 10-489 — Session Reconnect Flow Overhaul

## Problem

The reconnect flow has three issues:

1. **Operator dialog is user-facing, not agent-facing.** Shows "The agent may have a saved token in memory" — explains what happened instead of guiding the agent.
2. **`reconnect` is a flag on `session/start`** — should be a separate action (`session/reconnect`) for clarity.
3. **NAME_CONFLICT response doesn't push hard enough** to recover the token before reconnecting.

## Design (Operator Directive)

### Startup Chain (Happy Path)

```text
session/start → response: "Save this token NOW. Read help(topic: 'quick_start')"
  → quick_start guide: load profile, check identity, set up reminders, etc.
```

- Profile names ≠ agent names (Worker 1 ≠ "Worker" profile) — no auto-load
- Agent's pre-prompt tells it where session memory lives
- `session/start` hint strongly says: save token + read quick_start
- Quick start walks through all first-session setup steps

### Token Recovery Chain (Post-Compaction)

```text
Agent forgets token → tries session/start with same name →
  NAME_CONFLICT: "You're already online. You PROBABLY forgot your token.
    LOOK IT UP in session memory. If you truly can't find it,
    use action(type: 'session/reconnect')."
  → session/reconnect: "Reconnect request issued. But if you forgot
    your token and just need to find it, find it NOW to increase
    your odds of getting back in."
  → Operator approves → clean approve/deny, no explanation
  → Agent gets: token + diagnostic hint
```

### Breadcrumb Principle

Every action's response includes a hint pointing to the **next likely action**. The chain never dead-ends.

## Changes Required

### 1. API Split — `session/reconnect` as Last-Resort Fallback

- `session/start` — new sessions ONLY. Zero reconnect logic.
- `session/reconnect` — **last resort** when token is truly lost. Not advertised prominently.
- Documentation: "If you've already searched your session memory and cannot find your token, use `session/reconnect` to request re-entry." It's a fallback, not a primary flow.
- Keeps the approval dialog but text is clean:
  - Operator sees: "🤖 Session reconnecting: {name}" + approve/deny buttons (no explanation)
  - Agent gets: token + "Save this token to session memory immediately."

### 2. NAME_CONFLICT — Hard Rejection Every Time

When an agent calls `session/start` with a name that already exists, **reject immediately**. No reconnect hint in this response. The only question is: "What is your token?"

Current:
> "A session named X already exists. If you still have your token, resume with dequeue(token)."

New:
> "Session '{name}' already exists (SID {sid}). You are already online. Find your token in session memory and call dequeue(token: <token>). That's it."

No mention of `session/reconnect` here. The agent's job is to find its token. Period.

### 3. Reconnect Response Hint (Diagnostic)

Current hint: `"Save this token. Read: help(topic: 'startup')"`

New hint: diagnostic + next action. E.g.:
> "Reconnect successful. You lost your token — likely from context compaction. SAVE THIS TOKEN TO SESSION MEMORY NOW: {token}. Then read help(topic: 'startup') to resume normal operation."

### 4. Operator Dialog Cleanup

Current: "The agent may have a saved token in memory. Authorize re-entry only if token recovery failed."

New: Just the session name + approve/deny buttons. No explanation text needed — the operator knows what a reconnect is.

## Files

- `src/tools/session_start.ts` — split reconnect into separate handler, update NAME_CONFLICT, update hints
- `src/action-registry.ts` — register `session/reconnect` action
- `src/tools/session_start.spec.md` — update spec for the split + new response formats
- `src/tools/help.ts` — ensure `quick_start` topic exists (see also task 10-488)

## Acceptance Criteria

- [x] `session/reconnect` is a separate action from `session/start`
- [x] `session/start` no longer accepts `reconnect` flag
- [x] NAME_CONFLICT response strongly pushes token recovery before reconnect
- [x] Reconnect response includes diagnostic guidance (why it happened, save token NOW)
- [x] Operator dialog is clean — approve/deny only, no explanation text
- [x] Breadcrumb chain: every response hints to the next likely action
- [x] All existing tests updated for the API split

## Completion

**Branch:** `10-489` | **Worktree:** `.worktrees/10-489`

### What changed

- **`src/tools/session_start.ts`**: Extracted reconnect logic into new exported `handleSessionReconnect`. Removed `reconnect` parameter from `handleSessionStart`. Updated `NAME_CONFLICT` message to direct agents toward `dequeue(token)` first, with `session/reconnect` as explicit last-resort escape hatch. Simplified `requestReconnectApproval` dialog text to name + buttons only. Updated reconnect response hint to emphasize "SAVE THIS TOKEN TO SESSION MEMORY NOW" with diagnostic context.
- **`src/tools/action.ts`**: Registered `session/reconnect` action; removed `reconnect` schema field from action tool; updated token description to exempt both `session/start` and `session/reconnect`.
- **`src/tools/session_start.test.ts`**: Converted all reconnect tests to call `handleSessionReconnect` directly; added dedicated `describe("handleSessionReconnect")` block with 8+ targeted tests; added assertion on SAVE THIS TOKEN hint wording; added whitespace-only name edge case.
- **`src/tools/action.test.ts`**, **`src/tools/error-guidance.test.ts`**, **`src/tools/help.test.ts`**: Mock/assertion updates for new export.
- **`src/session-gate.ts`**, **`src/tools/help.ts`**, **`docs/behavior.md`**, **`docs/message-response-standard.md`**, **`LOOP-PROMPT.md`**: Updated all references from old `session/start + reconnect: true` pattern to `session/reconnect`.

### Findings deferred

- Minor: `requestApproval` still has a dead `reconnect` parameter used only for label text — unused since reconnect now goes through `requestReconnectApproval`. Low risk, cosmetic.
- Minor: whitespace-only second `session/start` edge case untested (pre-existing gap, not introduced by this task).

### Test result
2210 tests passed across 109 test files.
