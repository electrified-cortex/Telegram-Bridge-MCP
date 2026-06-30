---
title: "TMCP name validation rejects hyphens"
id: tmcp-name-hyphen
priority: medium
status: draft
filed: 2026-06-28
repo: electrified-cortex/Telegram-Bridge-MCP
delegation: foreman
---

# TMCP name validation rejects hyphens

## Bug

TMCP's name validation (used in `session/start` and related calls) rejects hyphens (`-`). Agent names like `Scout-7` or compound identifiers with hyphens fail validation. Hyphens should be allowed.

## Expected

Names containing `-` are accepted. Validation permits alphanumeric + hyphen (and likely underscore, space) in name fields.

## Actual

Name with `-` is rejected by TMCP validation.

## Where to look

Name validation logic — likely in `session/start` handler or a shared name-validation utility. Search for regex or character-allowlist checks on name inputs.

## Acceptance Criteria

- [ ] A name containing one or more hyphens (e.g. `Scout-7`) is accepted by `session/start` without error.
- [ ] Existing valid-name tests still pass.
- [ ] New test: name with hyphen → accepted; name with hyphen → round-trips correctly in session listing.
