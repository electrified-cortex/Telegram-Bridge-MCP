# 10-751 Clarify hybrid message type in onboarding service messages

## Verification Log

**Verifier:** Curator (dispatched Sonnet, 2026-04-24)
**Verdict:** APPROVED
**Commit reviewed:** `922aa64`

- AC1 (onboarding text updated): PASS — `ONBOARDING_BUTTONS_TEXT.text` in `src/service-messages.ts` line 58 now reads `For voice+caption, use type: "text" with audio: "..." — not a separate type.`
- AC2 (help('send') reference): PASS (bonus) — `help('send') for full reference.` remains.
- AC3 (no agent can infer type: "hybrid"): PASS — word "Hybrid" removed from the string.
- Tests: 54/54 pass. tsc clean. Code review: 0 critical / 0 major.
- Pre-existing minor at line 28 (duplicate bullet) predates this branch; tracked separately, not a gate.

Ready for Overseer seal -> `70-done/2026/04/24/`.



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

## Activity Log

- **2026-04-24** — Pipeline started. Variant: Implement only.
- **2026-04-24** — [Stage 4] General-purpose Agent dispatched. 1 file changed (`src/service-messages.ts` line 58). Staged.
- **2026-04-24** — [Stage 5] Verification: diff non-empty (1 insertion, 1 deletion), tests 54/54 passed, tsc clean.
- **2026-04-24** — [Stage 6] Code Reviewer: 0 critical, 0 major, 1 minor (pre-existing duplication at line 28 — not introduced by this change).
- **2026-04-24** — [Stage 7] Complete. Branch: `10-751`, commit: `922aa64`. Ready for Overseer review.

## Completion

Replaced the misleading "Hybrid (text + audio) for important updates" phrase in `ONBOARDING_BUTTONS_TEXT.text` (`src/service-messages.ts` line 58) with: "For voice+caption, use type: \"text\" with audio: \"...\" — not a separate type."

Subagent passes: General-purpose Agent ×1, Build Verifier ×1, Code Reviewer ×1.
Final review verdict: 0 critical, 0 major, 1 minor.
Minor finding: pre-existing duplicate bullet at line 28 (not introduced by this change — tracked as follow-up).
