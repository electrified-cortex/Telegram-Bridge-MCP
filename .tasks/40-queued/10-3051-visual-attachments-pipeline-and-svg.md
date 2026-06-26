---
id: "10-3051"
title: "Story: detection + attachment pipeline + SVG path (a)"
type: story
created: 2026-06-26
status: queued
priority: 15
epic: 10-3050
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# 10-3051 — Pipeline + SVG path

Part of epic [10-3050](../epics/10-3050-visual-content-attachments-epic.md).
**Ships independently** — the SVG path needs no render engine, so this story
delivers requirement (a) and the shared backbone on its own.

## Scope

1. **Detection** in outbound agent content:
   - raw `<svg …>…</svg>` blocks,
   - ` ```mermaid ` fenced blocks (detected + routed here; *rendering* is 10-3053).
2. **Shared pipeline:** for each detected block → replace it in the prose with a
   placeholder → write file(s) to `SAFE_FILE_DIR` → `sendDocument` with caption →
   send the prose normally. Reuse `handleSendFile` / `SAFE_FILE_DIR`.
3. **SVG path (requirement a):** extract the `<svg>`, **responsive-ize** it
   (`width="100%"`, remove fixed `width`/`height` px, ensure `viewBox`), attach as
   `.svg`, placeholder `🖼 [SVG attached]`.
4. **Mermaid → `.mmd` normalization (permanent design):** a ` ```mermaid ` block
   is placeholdered (`📊 [diagram attached]`) and its source written as a **`.mmd`
   attachment**. This is *the* design, not a stopgap — the companion `.svg` is
   added downstream by the 10-3053 render pass (which serves directly-attached
   `.mmd` files too). 10-3051 alone ships SVG fully + mermaid-as-`.mmd`; the
   rendered companion arrives with 10-3053.

## Acceptance criteria

- [ ] Raw `<svg>` → `🖼 [SVG attached]` placeholder + responsive `.svg` that opens
      and scales (no pinch-zoom) on the operator's mobile + desktop clients.
- [ ] Multiple blocks per message handled independently.
- [ ] Mermaid block → placeholder + `.mmd` attachment (rendered `.svg` deferred to 10-3053).
- [ ] Surrounding prose still delivered and readable.
- [ ] Non-visual code fences untouched (no false positives).
- [ ] All local — no third-party network calls.
- [ ] Graceful: a malformed `<svg>` → ship as a code block + note, never a failed send.
- [ ] `pnpm build` clean; `pnpm test` passes. PR staged, not merged.

## Notes

- Detection reuses the markdown layer's fenced-code awareness
  (`containsMarkdownTable` shows the pattern); SVG is a `<svg …>…</svg>` scan.
- The responsive-ize step is shared with 10-3053 (mermaid's rendered SVG uses it too).
