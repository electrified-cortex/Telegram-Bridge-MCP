---
title: "Render embedded visual content (SVG + mermaid) as viewable attachments"
created: 2026-06-26
updated: 2026-06-26
status: superseded
superseded_by: .tasks/epics/10-3050-visual-content-attachments-epic.md
priority: 15
type: Feature
source: Operator directive — Telegram feature audit (2026-06-26)
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
note: "SUPERSEDED — promoted to epic 10-3050 (stories 10-3051..10-3054). Kept for history; do not work from this file."
related:
  - .tasks/10-drafts/10-3018-v8-rich-messages-native-implementation.md
---

> ⚠️ **SUPERSEDED (2026-06-26).** This single-task draft was promoted to
> **epic [10-3050](../epics/10-3050-visual-content-attachments-epic.md)** and its
> stories **10-3051** (pipeline + SVG), **10-3052** (engine spike), **10-3053**
> (mermaid path), **10-3054** (build-our-own). Work from those, not this file.
> Content below retained for history.

# 15-0013 — Embedded visual content → viewable attachments

## Goal

Telegram renders **neither SVG nor mermaid inline**. When an agent embeds either
in a message, replace it with a short `[…attached]` placeholder (so the prose
still reads) and deliver the visual as **attachment(s)** the operator taps to open
and view. (Operator confirmed SVG/HTML attachments open in viewers and look
great; a responsive SVG — `width="100%"` + `viewBox`, no fixed px — scales to fill
the viewer with no pinch-zoom.)

## Spec

### (a) Embedded SVG
- Detect a raw `<svg …>…</svg>` block in the agent's content.
- Replace it in the prose with a placeholder: `🖼 [SVG attached]`.
- Attach the SVG as `.svg`, **responsive-ized** (set `width="100%"`, remove fixed
  `width`/`height` px, ensure `viewBox`).
- No engine needed — SVG is already rendered vector.

### (b) Embedded mermaid
- Detect a ` ```mermaid ` fenced block.
- Replace it in the prose with a placeholder: `📊 [diagram attached]`.
- Attach **two files**:
  1. the **`.mmd`** source (raw mermaid — re-editable / re-renderable), and
  2. the rendered **`.svg`** (responsive-ized, same as above).
- Requires a mermaid→SVG **conversion engine** (see below).

## Conversion engine (mermaid → SVG)

**Target: pure-JS, browserless, in-process — no Chromium, no container.**
Evaluate, in order; **operator directive: if none is good enough, we build one.**

1. **Spike `isomorphic-mermaid`** (pure JS: svgdom + jsdom + dompurify, runs real
   mermaid@11; ⚠️ experimental — 13 stars, 2 commits, no release, `htmlLabels:false`).
   Also try **`beautiful-mermaid`** (zero-DOM, themeable). Evaluate on the diagram
   types agents actually emit (flowchart, sequence). Exit: quality verdict per type.
2. **If good enough → ship it.** Zero-infra SVG — the best outcome.
3. **If not → WRITE ONE (committed fallback).** Scope realistically — NOT full
   mermaid parity:
   - either **fork/harden `isomorphic-mermaid`** (it's pure JS and tiny — fix the
     svgdom text-metrics / label issues), or
   - a **focused renderer for flowchart + sequence only** (mermaid's own parser +
     a layout lib (dagre) + font-metrics text measurement + SVG emit).
   - Cover the ~2 diagram types agents use; reject others with a clear note.
4. **Optional stopgap (not preferred):** kroki sidecar (browser in a container,
   full fidelity) — only if fidelity-now is needed while (3) is built. Operator
   prefers an in-process JS solution over a container.

`mermaid-cli`/puppeteer and playwright-based libs are **out** — they reintroduce
the Chromium-in-Node dependency this whole thread is avoiding.

## Styling / CSS (optional polish)

Output SVGs carry mermaid theme classes; `beautiful-mermaid` is fully themeable.
After rendering, CSS/theme can restyle colors/fonts and `viewBox` handles
responsive scaling. CSS styles the **output** — it does not do layout, so it sits
after whichever engine produces the geometry.

## Shared pipeline

1. **Detect** raw `<svg>` and ` ```mermaid ` blocks in outbound content.
2. **Transform** into file(s) in `SAFE_FILE_DIR` (existing `send_file` safe-dir):
   SVG → responsive `.svg`; mermaid → `.mmd` source + engine-rendered responsive `.svg`.
3. **`sendDocument`** each file with a caption.
4. **Replace** the detected block in the prose with the `[…attached]` placeholder;
   send the prose normally.

## Privacy
All rendering is **local / in-process** — nothing (source or diagram) leaves the
machine. Do NOT use third-party renderers (mermaid.ink / public kroki).

## Detection nuance (decide)
- Raw `<svg>` in prose, and ` ```mermaid ` fences → attach-as-visual (default).
- ` ```svg ` fence → ambiguous (show source vs render); default attach.

## Spikes
- **Engine quality** — render representative flowchart + sequence diagrams with
  `isomorphic-mermaid` / `beautiful-mermaid`; judge fidelity vs a known-good
  reference. Exit: per-type verdict → ship lib OR commit to build-our-own.
- **Responsive SVG on clients** — confirm the `width="100%"`+`viewBox` rewrite
  scales without pinch-zoom from a tapped attachment on mobile + desktop
  (operator largely proved). Exit: screenshot.

## Acceptance criteria
- [ ] Agent message with a raw `<svg>` → `🖼 [SVG attached]` placeholder + a
      responsive `.svg` attachment that opens and scales on the operator's clients.
- [ ] Agent message with a ` ```mermaid ` block → `📊 [diagram attached]`
      placeholder + **two** attachments: `.mmd` source and rendered responsive `.svg`.
- [ ] Multiple blocks in one message → handled independently, each placeholdered.
- [ ] Surrounding prose still delivered and readable.
- [ ] Non-visual code fences untouched (no false positives).
- [ ] mermaid→SVG engine is pure-JS / in-process (no Chromium, no container) —
      or, if libs fall short, our own renderer per the directive.
- [ ] No third-party network calls with diagram content.
- [ ] Graceful fallback: if SVG rendering fails, still ship the `.mmd` source +
      a placeholder note. **Never a failed send.**
- [ ] `pnpm build` clean; `pnpm test` passes.
- [ ] PR staged against `dev`. Do NOT merge.

## Out of scope
- Inline-in-rich-message-body embedding (rich + public PNG URL — that's the
  [10-3018](10-3018-v8-rich-messages-native-implementation.md) / Spike G path).
- Diagram types beyond flowchart + sequence in the build-our-own fallback (reject
  with a note; expand later).
- Other diagram languages (PlantUML, graphviz).

## Candidate libs (from 2026-06-26 research)
- pure-JS browserless: `isomorphic-mermaid` (svgdom), `beautiful-mermaid` (zero-DOM, themeable)
- Rust binary (no JS/browser): `merman` (parity-focused, mermaid@11.15.0)
- node-canvas (native dep): `sebastianjs`
- browser-based (avoid): `@mermaid-js/mermaid-cli`, `mermaid-isomorphic` (playwright), kroki

## Notes
- Detection reuses the markdown layer's fenced-code awareness; SVG detection is a
  `<svg …>…</svg>` scan.
- Attachment delivery reuses `handleSendFile` / `SAFE_FILE_DIR` — no new transport.
- Filename slug says "mermaid" but scope covers SVG too (kept to preserve inbound
  links from 10-3017/10-3018).
