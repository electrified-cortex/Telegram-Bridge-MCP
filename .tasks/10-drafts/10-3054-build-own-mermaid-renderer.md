---
id: "10-3054"
title: "Story (conditional): build our own pure-JS mermaid→SVG renderer"
type: story
created: 2026-06-26
status: draft
priority: 15
epic: 10-3050
depends_on:
  - 10-3052   # only if its verdict is "build"
blocked_by: 10-3052
condition: "Only worked if 10-3052 decides no existing lib meets the quality bar."
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
---

# 10-3054 — Build our own mermaid→SVG renderer (conditional)

Part of epic [10-3050](../epics/10-3050-visual-content-attachments-epic.md).
**Conditional** — only built if [10-3052](10-3052-mermaid-svg-engine-spike.md)
finds no pure-JS library good enough. Per operator directive: if no existing library meets the quality bar, build one.

## Hard scope guard

**This is NOT a full mermaid reimplementation.** Full parity is a trap and out of
scope. Pick the smallest viable build:

- **Option 1 — fork/harden `isomorphic-mermaid`.** It's pure JS and tiny (svgdom +
  jsdom + mermaid). Fix the specific failures 10-3052 found (text metrics, label
  sizing, `htmlLabels`). Lowest effort; reuses mermaid's own parser+layout.
- **Option 2 — focused renderer for flowchart + sequence only.** mermaid's parser
  → layout (dagre for flowcharts) → font-metrics text measurement (no browser) →
  SVG emit. Cover the ~2 diagram types agents use; **reject others with a clear
  note**, don't half-render them.

10-3052's findings decide which option. Prefer Option 1 if the lib is close.

## Constraints

- Pure-JS / in-process — no Chromium, no container, no native (node-canvas) deps
  unless 10-3052 explicitly justifies them.
- Output is a clean SVG the 10-3053 responsive-ize step can consume.
- Themeable output (CSS classes) so styling/scaling works downstream.

## Acceptance criteria

- [ ] Flowchart + sequence diagrams render to correct SVG with acceptable text
      sizing (no overflow/overlap) — judged against the 10-3052 reference.
- [ ] Unsupported diagram types → explicit reject + note (no broken output).
- [ ] Pure-JS / in-process; no browser/container dependency added.
- [ ] Unit tests over a corpus of representative diagrams.
- [ ] Feeds 10-3053 as the engine. `pnpm build` clean; `pnpm test` passes.

## Out of scope

- Diagram types beyond flowchart + sequence (expand later if needed).
- Full mermaid syntax/feature parity.
