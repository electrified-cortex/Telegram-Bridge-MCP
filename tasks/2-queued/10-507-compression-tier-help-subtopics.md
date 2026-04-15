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

- [ ] All 4 help files exist
- [ ] Help tool can serve `compression`, `compression/lite`, `compression/full`, `compression/ultra`
- [ ] Content matches shared skill and tiers doc
