---
id: "10-3053"
title: "Story: companion-render pass — any .mmd attachment → companion .svg (serves b + c)"
type: story
created: 2026-06-26
status: draft
priority: 15
epic: 10-3050
depends_on:
  - 10-3051   # normalizes embedded mermaid → .mmd attachment
  - 10-3052   # chosen/built engine
blocked_by: 10-3052
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# 10-3053 — Companion-render pass (the single mermaid→SVG point)

Part of epic [10-3050](../epics/10-3050-visual-content-attachments-epic.md).

**The unification:** the `.mmd` file is the universal intermediate for mermaid.
This pass is the *only* place mermaid→SVG happens, and it serves **both**:

- **(b) embedded mermaid** — normalized to a `.mmd` attachment by 10-3051, then
  flows here; and
- **(c) agent-attached `.mmd`** — already a `.mmd` attachment.

Both are just "a `.mmd` is going out." One rule covers them.

## The rule

For any outgoing `.mmd` attachment **without a companion `.svg`**:
1. Render `.mmd` → SVG via the engine from 10-3052 (or 10-3054).
2. **Responsive-ize** the SVG (`width="100%"`, drop fixed px, ensure `viewBox`).
3. Attach the `.svg` alongside the `.mmd` (captioned, e.g. `📊 rendered from <name>.mmd`).

**Companion check:** if a matching `.svg` is already part of the same send (agent
supplied both), do nothing — no duplicate render.

## Progress indicator

Show **`upload_document`** across the render + attach window (reuse `showTyping`),
so the operator sees activity during the (multi-second) render latency.

## Graceful fallback (required)

Render fails / unsupported diagram type → ship the `.mmd` alone (+ optional note).
**Never a failed send.**

## Acceptance criteria

- [ ] An outgoing `.mmd` with no companion `.svg` → rendered, responsive `.svg`
      attached alongside it — works identically whether the `.mmd` came from an
      embedded ` ```mermaid ` block (via 10-3051) or a direct agent attachment.
- [ ] A `.mmd` already accompanied by an `.svg` → no duplicate render.
- [ ] Rendered SVG opens and scales on the operator's mobile + desktop clients.
- [ ] Render failure / unsupported type → `.mmd` still delivered; no failed send.
- [ ] `upload_document` shown across render + attach.
- [ ] Engine is pure-JS / in-process (no Chromium/container); no third-party
      network calls with diagram content.
- [ ] `pnpm build` clean; `pnpm test` passes. PR staged, not merged.

## Notes

- This story absorbs the former separate "embedded mermaid path" and the former
  "`.mmd` attachment → companion `.svg`" story — both are now the same pass.
- 10-3051 owns turning embedded ` ```mermaid ` into the `.mmd` attachment +
  placeholder; this story owns the render-the-companion half.

## Gate review

- date: 2026-06-29
- verdict: GATED PASS — Overseer
- notes: 7 binary ACs, all testable. 10-3052 (engine) confirmed done (70-done/2026/06/27). 10-3051 shipped. Both hard dependencies satisfied — unblocked. Graceful fallback (AC4) defined. Pure-JS/in-process engine constraint (AC6) enforceable at review. Responsive SVG spec explicit.
