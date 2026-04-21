# 10-751 Clarify hybrid message type in onboarding service messages

## Problem

The onboarding `buttons` service message references "Hybrid (text + audio) for important updates" but the `send` tool has no `type: "hybrid"` — it uses `type: "text"` with an `audio` param. Agents (including Curator) attempt `type: "hybrid"` and receive `UNKNOWN_TYPE`, causing a failed first message.

## Goal

Make it unambiguous in the onboarding message that hybrid = `type: "text"` with `audio: "..."` param, not a separate type.

## Acceptance Criteria

- Onboarding `buttons` service message updated to say `type: "text", audio: "..."` for voice+caption messages
- Or: add a dedicated `help('send')` reference in the onboarding text pointing to the full type list
- No agent should be able to misread the onboarding and attempt `type: "hybrid"`

## Notes

- Triggered: Curator session startup 2026-04-21 — sent `type: "hybrid"`, received `UNKNOWN_TYPE`
- The `help('send')` output correctly lists available types; onboarding just doesn't reflect them
- Low-risk change — onboarding service messages are generated strings, not user-facing UI
