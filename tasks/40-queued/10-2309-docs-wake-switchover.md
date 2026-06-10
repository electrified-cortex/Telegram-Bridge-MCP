---
title: 7.10 — Docs/breadcrumb switchover to SSE-primary (activity/listen)
target: dev-7.10.0 (BEFORE PR #209 merges — 7.10 stays comprehensive, docs NOT → 7.11)
status: APPROVED by operator 2026-06-10 (incl. shared telegram-participation SKILL.md edit) — ready to implement
---

## Goal
Switch the agent-facing breadcrumbs/docs so an agent is steered to **SSE (`activity/listen`) as PRIMARY** when in HTTP mode, and **activity-file as FALLBACK** (stdio / no-HTTP / no curl). All feature docs must EXIST + carry the info (esp. activity/listen help can't be thin).

**VERIFIED (Curator, 2026-06-10):** SSE works for our pods — `action(type:'activity/listen')` → `ok:true`, HTTP mode `127.0.0.1:3099`, curl present, stream connects (`: connected`). **Capability gate = the probe call** (`activity/listen` → `ok` = use SSE; `HTTP_MODE_REQUIRED` = use activity-file). Use it as the gate.

## Surfaces (10 — all approved)
| # | File | Change |
|---|---|---|
| 1 | `docs/help/activity/listen.md` (56-63) | Flip comparison table: SSE=primary, file=fallback; add gate CTA |
| 2 | `docs/help/activity/file.md` (1-5) | Title "(Fallback)"; note prefer activity/listen in HTTP mode |
| 3 | `src/service-messages.ts` `ONBOARDING_LOOP_PATTERN` (53-63) | **KEY breadcrumb** → SSE-first 3-path decision; ref help('activity/listen') |
| 4 | `src/service-messages.ts` `ACTIVITY_FILE_MONITOR_INSTRUCTIONS` (193-207) | Note: switch to SSE if HTTP mode |
| 5 | `docs/help/start.md` (13) | SSE-first 3-path chooser |
| 6 | `docs/help/startup.md` | Add wake-arm line (both topics) |
| 7 | `skills/telegram-participation/SKILL.md` R5 (43-58) | New HTTP-mode check branch before A/B (SSE → skip to R6). **Shared skill — operator APPROVED.** |
| 8 | `docs/help/compacted.md` (8-12) | Add SSE recovery branch; update See-also |
| 9 | `docs/help/compaction-recovery.md` | Retitle "Wake Monitor…"; add SSE recovery section before file steps |
| 10 | `docs/help/index.md` | Elevate activity/listen + activity/file to first-class CORE OPERATIONS |

## Code-adjacent (Overseer decisions — 2026-06-10)
- **(2) `activity/listen/get`** → **IMPLEMENT** — symmetric recovery read endpoint; pure addition, no breakage risk.
- **(4) `POST_COMPACT_SSE_RECOVERY` service message** → **IMPLEMENT** — service-message pattern already exists; add alongside existing service messages in service-messages.ts.
- **(5) `stopped` event + notifySseSubscriber** → **SKIP** — feature-level code change; belongs in separate task outside 7.10 scope.

## Acceptance (the bar)
1. **Agent journey:** a fresh agent coming online gets steered correctly — HTTP → SSE; stdio/no-HTTP → activity-file. Trace the onboarding breadcrumbs end-to-end.
2. **dev-7.10.0 valid / fully building / CI GREEN.**
Then operator shuts down the fleet + restarts to dogfood for real. Full plan ref (Curator pod): `memory/projects/7.10-docs-switchover-plan.md`.

## Gate Review — PASS (Overseer stamp R1, 2026-06-10)

| Criterion | Result |
|---|---|
| ACs binary+testable | ✓ AC-1 agent-journey trace (auditable for docs); AC-2 CI GREEN (binary) |
| Scope bounded | ✓ 10 named surfaces with file:line; no discovery; code-adjacent resolved |
| Delegation correct | ✓ docs + service-message edits → worker |
| No critical open question | ✓ code-adjacent items resolved above |
| Well-specced | ✓ file paths, line ranges, capability gate defined |

**Authorized to proceed. Forward to foreman → worker on dev-7.10.0.**
