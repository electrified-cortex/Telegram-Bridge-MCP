# 10-719 - "<Agent> looks offline" prompt mislabels the asker

## Context

Operator (2026-04-19, voice 38215-38216): when the operator (or an agent) tries to reach a target session that is offline, TMCP surfaces a prompt with buttons asking "what do you want to do?" — but the prompt's name tag identifies a DIFFERENT session as the source. Specifically observed: "Curator looks offline" prompt arrived bearing the name tag "Worker 3", which has no causal relationship to the operator's discovery query.

> "It has a name tag of 'Worker 3'. That doesn't make sense. That's a bug. ... We've had that issue before. It's just never gotten fixed."

The bug is recurring — operator confirms it has surfaced before and the fix never landed. Likely the prompt's "from" field is being populated from the wrong session in the lookup chain (perhaps the most recent session in some queue, rather than the actual asker).

## Acceptance Criteria

1. Identify the code path that emits the "<target> looks offline" / presence-discovery service prompt.
2. Identify why the name tag/from field is set to a session unrelated to the asker.
3. Fix: the prompt's "from" field must be the session that initiated the discovery (the asker), or "system" if no specific asker exists. Never an unrelated session.
4. **Verify against a real send** before merging — operator triggers a discovery against an offline session and confirms the prompt's "from" matches them, not a random Worker.
5. Regression test if feasible.

## Constraints

- Don't change the prompt's behavior (still buttons, still asks what to do) — only fix the from/name-tag attribution.
- The presence/discovery system is shared infrastructure; don't refactor it as part of this fix.

## Open Questions

- Is the bug in MCP-side prompt construction, in the bot's render path, or in how Telegram's reply mechanic surfaces "from" for service messages? Investigation required.
- Are there other service-message paths with the same mislabel? If yes, scope-extend or file separately.

## Delegation

Worker (TMCP). Curator stages, operator merges. Bug fix; no design needed.

## Priority

10 - bug, recurring, observable, confusing. Bumps above pure UX polish.

## Related

- `15-713`/`15-714` (other behavior-shaping work in TMCP).
- Operator note: "we've had that issue before" — search git history for prior attempts.

## Completion

- Branch: `10-719` in `Telegram MCP` repo
- Commit: `75bd03c` — switched `sendGovernorPrompt` to use `getRawApi()` for all message ops; removed `hookOwnerSid` capture; pass `undefined` to `registerCallbackHook`
- Root cause: `getCallerSid()` falls back to `getActiveSession()` (global `_activeSessionId`) in timer context — outbound proxy injected that session's name tag into the system prompt
- Pre-existing lint error in `src/tools/session/registration/index.ts:21` (unrelated to this change) — flagged separately
