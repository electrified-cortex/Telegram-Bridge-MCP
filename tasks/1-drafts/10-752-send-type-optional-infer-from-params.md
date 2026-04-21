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

- Operator: "what is type? When is it used? It should be optional"
- Related: 10-751 (clarify hybrid in onboarding service message)
- Low-risk if type inference is additive (fallback to explicit when ambiguous)
