# 10-752 Make `type` optional in `send` — infer from params

## Problem

The `send` tool requires `type` explicitly. When an agent passes `audio` and `text` together but guesses `type: "hybrid"` (which doesn't exist), it gets `UNKNOWN_TYPE`. The type should either be optional (inferred from which params are present) or default to `text` when not supplied.

## Goal

Reduce agent errors on `send` calls by making `type` inferrable from the payload.

## Proposed Behavior

- `audio` present + `text` present → infer `type: "text"` (voice+caption)
- `text` only → infer `type: "text"`  
- `type` explicit → use as-is (current behavior preserved)
- Missing `type` with ambiguous params → return helpful error naming the inferred candidates

## Acceptance Criteria

- `send` with `audio` + `text` and no `type` succeeds without error
- Existing explicit `type` usage unaffected
- Onboarding message updated to reflect that `type` is optional when params make intent clear

## Notes

- Operator (distilled): questioned what `type` is and when it's used, and asked that it be made optional.
- Related: 10-751 (clarify hybrid in onboarding service message)
- Low-risk if type inference is additive (fallback to explicit when ambiguous)

## Completion

**Branch:** `10-752` in `Telegram MCP` repo
**Commit:** `4b7e087`
**Worker:** Worker 5

### What was done

- `type` was already optional (defaulting to `"text"`) — no routing change needed.
- Improved UNKNOWN_TYPE error hints: audio+text combo directs agents to omit `type` or use `"text"`; audio-only gets similar targeted hint; text-only falls back to Levenshtein suggestion.
- Removed conflicting "Omit all args to list types" from the `type` field schema description.
- `docs/help/send.md`: added top-of-doc note clarifying `type` is optional and there is no `"hybrid"` type; renamed `Hybrid:` section to `Audio + Text ("text" type):` to prevent agent confabulation.

### Pre-existing issue noted (not in scope)

`send.ts:226` — TypeScript cast `as SendType | undefined` is structurally unsound; flagged for follow-up.
