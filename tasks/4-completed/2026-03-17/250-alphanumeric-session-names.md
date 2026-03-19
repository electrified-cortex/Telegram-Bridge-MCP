# Story: Alphanumeric-Only Session Names

## Type

Story

## Origin

Operator voice message (2026-03-18):
> "Names that are provided are only alphanumeric names. No other symbols. No other special characters. They can only be alphanumeric. And maybe a space. But that's it."

## Current Behavior

- `session_start` accepts any string as a `name` parameter
- Name collision is checked (case-insensitive) but no character validation
- No validation in the proposed `rename_session` tool (task 600) either

### Code Location

- `src/tools/session_start.ts` L103-108: `name` parameter — `z.string().default("")`
- Future: `rename_session` tool (task 600) will also need this validation

## Desired Behavior

Session names must contain only:

- Letters (a-z, A-Z)
- Digits (0-9)
- Spaces (but not leading/trailing — trim first)

No symbols, no emoji, no special characters, no unicode beyond basic Latin.

Regex: `/^[a-zA-Z0-9 ]+$/` (after trimming)

## Fix

Add validation in `session_start` after trimming the name:

```typescript
if (effectiveName && !/^[a-zA-Z0-9 ]+$/.test(effectiveName)) {
  return toError({
    code: "INVALID_NAME",
    message: "Session names must be alphanumeric (letters, digits, spaces only).",
  });
}
```

Also apply to `rename_session` (task 600) when implemented.

## Acceptance Criteria

- [ ] `session_start` rejects names with special characters (`INVALID_NAME` error)
- [ ] `session_start` accepts alphanumeric names with spaces (e.g., "Scout Alpha")
- [ ] Leading/trailing whitespace is trimmed before validation
- [ ] Empty/whitespace-only names are handled by existing `NAME_REQUIRED` logic
- [ ] Default name "Primary" passes validation
- [ ] Tests for valid names, invalid names (symbols, emoji, unicode), edge cases
- [ ] All existing tests pass
