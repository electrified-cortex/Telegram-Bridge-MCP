---
id: "10-3052"
title: "Story: mermaid→SVG engine — spike & select (lib vs build)"
type: story
created: 2026-06-26
status: queued
priority: 15
epic: 10-3050
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
note: "Decision gate. Output is a chosen engine OR a go-decision to build our own (10-3054). No product code ships from this story."
---

# 10-3052 — Mermaid→SVG engine: spike & select

Part of epic [10-3050](../epics/10-3050-visual-content-attachments-epic.md).
**Gating decision** for the mermaid path (10-3053) and the build-our-own
fallback (10-3054).

## Constraint

The engine MUST be **pure-JS / in-process — no Chromium, no container.**
Puppeteer/playwright libs (`@mermaid-js/mermaid-cli`, `mermaid-isomorphic`) are
**out**. Third-party render services (mermaid.ink, public kroki) are **out**
(privacy).

## What to evaluate

Render representative **flowchart** and **sequence** diagrams (the types agents
actually emit) with each candidate and judge fidelity against a known-good
reference (e.g. a one-off browser render):

- **`isomorphic-mermaid`** — svgdom + jsdom + dompurify, real mermaid@11.
  ⚠️ experimental (13★, 2 commits, no release, `htmlLabels:false`). Lead candidate.
- **`beautiful-mermaid`** — zero-DOM, fully themeable, from-scratch renderer.
- *(reference only)* `merman` (Rust binary), `sebastianjs` (node-canvas native dep).

Judge: text sizing/overflow, node/edge layout correctness, label legibility,
theme/CSS controllability, and which diagram types break.

## Decision

- **Ship a lib** → record which, the version pin, and known limits → feeds 10-3053.
- **Build our own** → record *why* (which failures), and the fired gate for
  [10-3054](10-3054-build-own-mermaid-renderer.md) → it becomes the engine for 10-3053.

## Acceptance criteria

- [ ] Flowchart + sequence rendered via `isomorphic-mermaid` and `beautiful-mermaid`;
      outputs + a fidelity verdict recorded **in this file**.
- [ ] Pure-JS/in-process constraint honored (no Chromium/container introduced).
- [ ] Clear decision: chosen lib (+ version + limits) OR "build" gate for 10-3054.
- [ ] If a lib is chosen, a throwaway script proves `mermaid source → .svg` locally.

## Out of scope

- Wiring the engine into the send path — that's 10-3053.
- Any container/browser-based engine as the primary choice.
