# 10-3088 — Participant name hyphen causes profile key mismatch

**Priority:** 10 (high)
**Repo:** electrified-cortex/Telegram-Bridge-MCP
**Filed:** 2026-06-29
**Source:** Operator observation — surfaced night of 2026-06-28

## Problem

TMCP participant session names containing hyphens (e.g., `Zhu-Li`, `BT-7274`) produce
a profile key that strips or rejects the hyphen, resulting in a mismatch:

- Agent registers with name `Zhu-Li`
- Profile is saved/loaded under key `ZhuLi` (hyphen stripped) or key creation fails
- Agent cannot load its own profile because the stored key does not match the name

## Impact

All agents whose canonical name includes a hyphen cannot reliably use profile
persistence (`profile/save`, `profile/load`). Voice, animation presets, reminders
and audio remapping are lost or unavailable on reconnect.

Known affected: `Zhu-Li`, `BT-7274` (any hyphenated session name).

## Acceptance Criteria

- AC-1: `profile/save` with `key: "Zhu-Li"` stores without error
- AC-2: `profile/load` with `key: "Zhu-Li"` retrieves the correct profile
- AC-3: Hyphen is preserved verbatim in the key (no stripping, no normalization)
- AC-4: Existing profile keys without hyphens are unaffected
- AC-5: Round-trip test: save key with hyphen, load same key, assert identity

## Notes

- Investigate `profile/save` and `profile/load` handlers for key validation regex
- Check whether the hyphen restriction is in the MCP schema, the storage layer, or both
- Fix must be backward-compatible (no migration needed for existing hyphen-free keys)
- No proper names in test fixtures — use `Agent-Alpha`, `System-7` etc.
