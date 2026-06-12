---
Created: 2026-04-12
Status: Draft
Host: local
Priority: 10-496
Source: Operator directive (dogfooding critique)
---

# 10-496: Guide content audit and help/guidance separation

## Objective

Audit the agent communication guide (`docs/behavior.md`) and extract
content into appropriate homes. Two axes of separation:

1. **Content extraction** — move topic-specific material to individual
   help hints (e.g., animation → `help('animation')`, compression →
   `help('compression')`)
2. **Help vs guidance** — distinguish tool documentation ("how to call X")
   from Telegram etiquette/conventions ("when to use voice vs text")

## Context

The guide is ~32KB and mixes:
- Tool usage patterns (belongs in per-tool help topics)
- Dequeue loop mechanics (belongs in `help('start')`)
- Compression tiers (already duplicated in `help('compression')`)
- Animation guidance (already duplicated in `help('animation')`)
- Telegram etiquette (belongs in guide or a separate 'etiquette' topic)
- Multi-session routing (belongs in guide or 'routing' topic)

Some content is duplicated between the guide and help topics. The audit
should identify every duplication and decide where the canonical copy lives.

## Prerequisites

- 10-495 (guide spec) — defines scope boundaries

## Deliverable

1. An audit document mapping each guide section to its target home
2. Implementation: extract identified content, update guide, update help topics
3. Guide shrunk to spec-defined size constraint

## Acceptance Criteria

- [x] Every guide section mapped to: keep in guide / move to help topic / move to skill / remove (duplicate)
- [x] No content duplication between guide and help topics
- [x] Guide size within spec-defined constraint (10-495) — 4,013 bytes (target ≤8,192)
- [x] All extracted content accessible via appropriate help topics
- [x] "Help" (tool docs) clearly separated from "guidance" (etiquette/conventions)
- [x] Existing help topics updated with extracted content where needed

## Activity Log

- **2026-04-15** — Pipeline started. Variant: Design + Implement.
- **2026-04-15** — [Stage 2] Feature Designer dispatched. Full audit map produced (17 extraction actions, size projection, AC-1 through AC-8).
- **2026-04-15** — [Stage 3] Design reviewed. Clean — all 7 sections present, ACs verifiable, no implementation code, OQs had clear designer recommendations, no Overseer escalation needed.
- **2026-04-15** — [Stage 4] Task Runner dispatched. 2 files changed: docs/behavior.md (31KB→3.8KB), src/tools/help.ts (+209 lines). Status: READY FOR REVIEW.
- **2026-04-15** — [Stage 5] Verification: diff non-empty. tsc clean. 2220 tests passed (109 test files).
- **2026-04-15** — [Stage 6] Code Reviewer: 0 critical, 4 major, 5+ minor. Majors investigated — 2 false positives (download_file tool name confirmed correct; dequeue timeout change is correct per memory). 2 real majors fixed (set_topic applies-to list, download_file button sets). Minor fixes: return fields, sticker behavior, dump_session_record count, show_typing idempotency, 3 lost cross-cutting rules restored. Second tsc pass: clean.
- **2026-04-15** — [Stage 7] Complete. Branch: 10-496, commit: abf98de. Ready for Overseer review.

## Completion

**What was implemented:**
- `docs/behavior.md` rewritten from ~31KB to 4,013 bytes (87% reduction, within ≤8KB spec)
- Guide restructured per guide.spec.md §5: 7 sections (Rules, Shortcuts, Receive-Respond Patterns, Voice/Text Conventions, Multi-Session Coordination, Session Lifecycle, Reactions Etiquette)
- 8 new help topics added to `src/tools/help.ts`: `set_commands`, `set_topic`, `show_typing`, `choose`, `send`, `set_voice`, `download_file`, `dump_session_record`
- 4 existing topics extended: `dequeue`, `start`, `animation`, `shutdown`
- Help index updated with all new topics
- Cross-cutting rules retained in guide; single-tool content extracted to topics

**Subagent passes:** Feature Designer ×1, Task Runner ×2 (initial + fixes), Code Reviewer ×1

**Final review verdict:** 0 critical, 0 major (after fixes), minor findings noted and addressed

**Minor findings noted (resolved):**
- `set_topic` incorrectly excluded `file` from applies-to list (fixed)
- `download_file` return fields used `path` instead of `local_path` (fixed)
- Sticker button behavior lost during extraction (restored)
- `dump_session_record` stated 1000-event limit vs actual 100 default (fixed)
- `show_typing` missing idempotency note (restored)
- 3 cross-cutting rules (status, reply context, pending answers) had no home (restored to guide)
