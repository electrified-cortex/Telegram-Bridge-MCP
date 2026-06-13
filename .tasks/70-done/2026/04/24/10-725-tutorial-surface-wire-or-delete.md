# 10-725 - Tutorial control surface: wire it or delete it

## Context

GPT-5.4 audit (2026-04-19) found an orphaned tutorial control surface that appears to be a **no-op** after the guided-behavior migration:

- Production write path: `action.ts:192-202` toggles tutorial mode and returns success messages.
- Backing state + helpers: `session-manager.ts:376` and `session-manager.ts:393`.
- **No production read path** that actually changes behavior based on that state could be found.

This is an exposed API surface with no visible effect: dangerous because agents may toggle it and get false confidence.

## Acceptance Criteria

Pick **one** of the two paths:

**Path A — Wire it:** identify what behavior tutorial mode SHOULD gate, add the read path(s), test that toggling actually changes behavior end-to-end.

**Path B — Delete it:** remove the action handler at `action.ts:192-202`, remove the `session-manager.ts` state + helpers, remove any schema or help reference, add a one-line CHANGELOG entry noting the dead surface was excised.

Path B is preferred unless there's a clear pending design intent that motivates Path A.

## Constraints

- Don't leave it as-is "just in case." A no-op API is worse than no API.
- If Path A, write at least one integration test demonstrating behavior changes when the toggle is flipped.

## Open Questions

- What was the original intent of tutorial mode? Check git log on `session-manager.ts:376` for the introducing commit.
- Is there any in-flight task (e.g. `15-713` first-DM compression) that was supposed to consume tutorial state?

## Priority

10 - dead-feature decision; small but adds up to API surface bloat.

## Related

- 20-721 (parent V7 merge readiness audit).
- 15-713 (first-DM behavior shaping — possibly intended consumer).
