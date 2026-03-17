# Feature: Session Approval Gate

## Type

Feature / UX

## Description

First session is auto-approved with the default name "Primary". Second and subsequent sessions must be approved by the operator via a Telegram `confirm` button. Name collisions are rejected immediately. The operator can deny a session entirely.

## User Quote

> (from voice — paraphrased) Second session joining should ask the operator for approval. First one is auto-approved as Primary.

## Dependencies

- **100-sid-required-all-tools** — SID enforcement must exist so the new session can't act before approval

## Current State

`src/tools/session_start.ts` currently creates sessions unconditionally:

1. Calls `createSession(name)` in `src/session-manager.ts` (L43)
2. `createSession` increments `_nextId`, stores in `_sessions` Map, returns `{ sid, pin, name, sessionsActive }`
3. No approval gate, no name collision check
4. The intro message is sent to Telegram after creation (not before)

## Code Path

1. `src/tools/session_start.ts` — tool handler, calls `createSession()`, sends intro message
2. `src/session-manager.ts` — `createSession(name?)`, `listSessions()`, `activeSessionCount()`
3. `src/tools/confirm.ts` — operator-facing yes/no button (will be used for approval UX)
4. `src/telegram.ts` — `resolveChat()` for sending the approval prompt to operator

## Design Decisions

### First session flow

1. Agent calls `session_start(name: "Overseer")`
2. `activeSessionCount() === 0` → auto-approve
3. Create session, return SID/PIN immediately
4. Send intro message to Telegram

### Second+ session flow

1. Agent calls `session_start(name: "Scout")`
2. `activeSessionCount() >= 1` → approval required
3. **Before creating the session**, send a `confirm` prompt to the operator:
   - Message: `🤖 New session requesting access: **Scout**`
   - Buttons: `✅ Approve` / `❌ Deny`
4. Block the tool call until operator responds
5. If approved → create session, return SID/PIN
6. If denied → return error: `"Session denied by operator"`

### Name collision handling

- Before creating (or prompting), check `listSessions()` for existing session with same name (case-insensitive)
- If collision → return error immediately: `"Session name 'Scout' is already in use. Choose a different name."`
- No operator prompt needed for collisions — fast fail

### Timeout behavior

- If operator doesn't respond within a reasonable window (e.g., 60 seconds), deny by default
- The requesting agent's tool call returns a timeout error

### What about the "Primary" default name?

- If first session doesn't provide a name, default to "Primary"
- Second+ sessions MUST provide a name (no default)

## Acceptance Criteria

- [ ] First session auto-approved without operator interaction
- [ ] Second+ session blocked until operator `confirm` approves
- [ ] Operator deny → session not created, error returned to agent
- [ ] Name collision → immediate error without operator prompt
- [ ] Name comparison is case-insensitive
- [ ] Timeout (60s) → deny by default
- [ ] First session defaults to name "Primary" if none provided
- [ ] Second+ session requires a name (error if omitted)
- [ ] Tests: first session auto-approval flow
- [ ] Tests: second session approval prompt sent
- [ ] Tests: operator denies → error returned
- [ ] Tests: name collision → immediate error
- [ ] Tests: timeout → deny
- [ ] All tests pass: `pnpm test`
- [ ] No new lint errors: `pnpm lint`
- [ ] Build clean: `pnpm build`
