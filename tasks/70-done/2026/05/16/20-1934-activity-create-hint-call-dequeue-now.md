# 20-1934 — activity/create response: hint must strongly say "call dequeue now"

## Context

`src/tools/activity/create.ts` returns a hint after creating the activity file. The current hint is too weak — agents sometimes miss or delay the dequeue call. The hint must be the loudest possible signal.

## Acceptance criteria

1. `activity/file/create` response `hint` field reads: `"call dequeue(token) NOW — do not proceed without draining"` (or equivalently strong wording).
2. The hint is the most prominent field in the response — consider making it a top-level message, not buried in metadata.
3. Changes merged into dev.

## Source

Operator 2026-05-16: "it's really important to actually call out strongly that call DQ now as the hint."

## Verification

APPROVED 2026-05-16 — all criteria confirmed.

- AC1: `src/tools/activity/create.ts:62,85` — both return paths read `call dequeue(token: ${sid}) NOW — do not proceed without draining`.
- AC2: `hint` is first field in both `toResult` calls; JSDoc updated to match.
- AC3: merged to dev as 2dfb931.

Squash commit: 2dfb931. Sealed-By: Foreman 2026-05-16.
