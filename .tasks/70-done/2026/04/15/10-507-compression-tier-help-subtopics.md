---
id: "10-507"
title: "Add compression tier help sub-topics"
status: draft
priority: 30
created: 2026-04-12
assignee: Worker
tags: [help, compression, TMCP]
depends_on: ["10-502"]
---

# 10-507: Add compression tier help sub-topics

## Objective

When 10-502 extracts help topics to `docs/help/`, the compression topic should
include sub-topics for each tier: `compression/lite`, `compression/full`,
`compression/ultra`.

## Context

The shared compression skill (`../.agents/skills/compression/SKILL.md`) defines
the technique. The tier system is documented in `docs/compression-tiers.md`. The
TMCP help system should expose these as browsable sub-topics so agents can look
up tier-specific rules on demand.

## Requirements

1. `docs/help/compression.md` — overview of compression, links to sub-topics
2. `docs/help/compression/lite.md` — Lite tier rules and when to use
3. `docs/help/compression/full.md` — Full tier rules
4. `docs/help/compression/ultra.md` — Ultra tier rules
5. Help router recognizes `compression/lite` etc. as valid topic paths
6. Content derived from shared skill + `compression-tiers.md` — single source of truth

## Acceptance Criteria

- [x] All 4 help files exist
- [x] Help tool can serve `compression`, `compression/lite`, `compression/full`, `compression/ultra`
- [x] Content matches shared skill and tiers doc

## Activity Log

- **2026-04-15** — Pipeline started. Variant: Implement only (doc-only, no code change needed).
- **2026-04-15** — [Stage 4] Task Runner dispatched. 4 files changed (3 new sub-topic files + compression.md updated). help.ts required no changes — path.join routing works automatically for slash paths. tsc clean.
- **2026-04-15** — [Stage 5] Skipped — doc-only changes.
- **2026-04-15** — [Stage 6] Code Reviewer: 0 critical, 2 major, 4 minor. Majors: lite.md missing Telegram behavioral rules; ultra.md internal contradiction on markdown stripping. Both fixed in second Task Runner pass.
- **2026-04-15** — [Stage 7] Complete. Branch: 10-507, commit: fa2986a. Ready for Overseer review.

## Completion

**What was implemented:**
- `docs/help/compression/lite.md` — Lite tier rules + Telegram output behavioral rules (audio/urgency/format guidance)
- `docs/help/compression/full.md` — Full tier rules with Lite/Ultra contrast
- `docs/help/compression/ultra.md` — Ultra tier rules with markdown-strip contradiction resolved
- `docs/help/compression.md` — updated with Sub-topics navigation section

**Routing:** No code change needed. `help('compression/lite')` routes via `loadTopic("compression/lite")` → `docs/help/compression/lite.md` automatically.

**Dependency note:** Must merge after `10-502` (docs/help/ structure) and after `10-496` (help.ts additions). Merge order: 10-496 → 10-502 → 10-507.

**Subagent passes:** Task Runner ×2 (initial + fixes), Code Reviewer ×1

**Final review verdict:** 0 critical, 0 major (after fixes), 4 minor (noted, not blocking)
