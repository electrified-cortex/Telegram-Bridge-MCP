# 10-720 - session/close response: hint about wiping token to escape loop guard

## Context

Operator (2026-04-19, voice 38226-38228): observed bug pattern when an agent tries to shut down its session.

The flow that breaks:

1. Agent calls `session/close`.
2. Agent's stop / loop guard fires (PreCompact or Stop hook designed to keep agents in the Telegram dequeue loop).
3. The loop guard re-prompts the agent to call `dequeue` or `session/start` again.
4. Agent does so — and now reconnects (because their session token is still in memory or in their `telegram/session.token` memory file). The "close" never actually completes.

Root cause: the agent doesn't know that to genuinely exit, it must wipe its session token (the file or the in-memory value) BEFORE the loop guard fires. The `session/close` response doesn't tell them this. They learn it the hard way (or never).

Operator's fix: the `session/close` response (and possibly the `session/end` denied path) should always include a one-line hint: "If your stop / loop guard re-fires, wipe your stored session token before retrying — don't reconnect."

## Acceptance Criteria

1. **Locate** the `session/close` response builder in TMCP.
2. **Append a hint** to every `session/close` success response: "Wipe your stored session token (file or memory) before exiting. If a loop guard re-prompts you, do NOT call session/start again — wipe the token, then exit." (Or operator's preferred phrasing — keep it short, ≤200 chars.)
3. **Consider** adding the same hint to `SESSION_DENIED` responses on subsequent reconnect attempts (so agents that hit the guard know what to do).
4. **Don't** make the hint conditional on detecting whether the agent actually has a stored token — emit always; harmless if not applicable.
5. **Verify** with a real session/close cycle from an agent that has a token file. Confirm the hint appears in the response payload and the agent (Curator/Worker test) can act on it without hand-holding.

## Constraints

- Don't change session/close behavior — only the response text.
- Hint must be ASCII-clean, terse.
- Don't conflate this with the unrenderable_chars warning system; separate path.

## Open Questions

- Should the hint reference a `help('shutdown')` topic for the full procedure? (Probably yes; topic may need to exist.)
- Is the recommended pattern "wipe token THEN call session/close" or "call session/close THEN wipe token"? Operator's framing suggests the latter — close first, then wipe so the loop guard can't reconnect.

## Delegation

Worker (TMCP). Curator stages, operator merges.

## Priority

10 - bug. Active footgun affecting agent shutdown reliability. Operator has hit it more than once.

## Related

- Memory `feedback_session_close_vs_shutdown.md` (Curator's understanding of close vs shutdown).
- Memory `feedback_deputy_session_end.md` (SESSION_DENIED on reconnect = intentional, do not retry).
- Memory `feedback_session_token_file.md` (token is plain-value file; empty = closed).
- The PreCompact / Stop hooks in `cortex.lan/.claude/` that enforce the dequeue loop (don't modify those — fix the hint instead).

## Completion

Committed on branch `10-720` (commit `5cdf522`) by Worker 4 (2026-04-19).

- `close_session.ts`: hint appended to self-close success response
- `session_start.ts`: hint appended to SESSION_DENIED reconnect error

Overseer notified. Ready for Curator review and merge.
