---
id: "10-3052"
title: "Story: mermaid→SVG engine — spike & select (lib vs build)"
type: story
created: 2026-06-26
status: review
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

- [x] Flowchart + sequence rendered via `isomorphic-mermaid` and `beautiful-mermaid`;
      outputs + a fidelity verdict recorded **in this file**.
- [x] Pure-JS/in-process constraint honored (no Chromium/container introduced).
- [x] Clear decision: chosen lib (+ version + limits) OR "build" gate for 10-3054.
- [x] If a lib is chosen, a throwaway script proves `mermaid source → .svg` locally.

## Out of scope

- Wiring the engine into the send path — that's 10-3053.
- Any container/browser-based engine as the primary choice.

---

## Spike findings — 2026-06-27

Environment: Node v26.4.0, pnpm v11.9.0

### isomorphic-mermaid @ 0.1.1 findings

Package: svgdom + jsdom + dompurify, wraps real **mermaid@11.16.0**.

- **flowchart: FAIL (out-of-box) / PASS (with polyfill)**
  - Root failure: `CSSStyleSheet is not defined` — mermaid@11 calls `new CSSStyleSheet()` + `insertRule()` for CSS injection; svgdom does not implement CSSOM.
  - With a custom `CSSStyleSheet` polyfill injected before render: PASS (385ms, 17KB SVG, 10 text elements, 20 tspans).
- **sequence: FAIL (out-of-box) / PASS (with polyfill)**
  - Same root cause. With polyfill: PASS (34ms, 24KB SVG).
- **text sizing:** Labels sized at 16px (trebuchet ms), inline style on `<text>` elements. Legible.
- **layout correctness:** Real mermaid@11 layout — graphically equivalent to browser render (expected: highest fidelity of all options).
- **CSS controllability:** No — inline styles baked in; no CSS custom properties. Theming requires re-initialize with different theme config.
- **globalThis side-effects:** YES — patches `globalThis.window` and `globalThis.document` via svgdom on import. Confirmed to break `beautiful-mermaid`'s ELK.js Worker if imported first.
- **error handling:** throws `CSSStyleSheet is not defined` (even for malformed input — same root cause).
- **known limits:**
  - Requires shipping a non-trivial `CSSStyleSheet` CSSOM polyfill — workaround on an experimental package
  - Experimental: 13★, 2 commits, no semver release, last commit unknown
  - Patches globalThis — side-effects on other libraries
  - Forces `htmlLabels: false` (expected for SVG)
  - Slow: 385ms for first flowchart render
- **verdict: REJECT** — too fragile; the polyfill workaround is non-trivial and the package is experimental/abandoned.

### beautiful-mermaid @ 1.1.3 findings

Package: zero-DOM, from-scratch SVG renderer, uses ELK.js for layout.

- **flowchart: PASS**
  - 76ms (synchronous, first call includes ELK layout), 6KB SVG
  - All 5 nodes present (Start, Decision?, Do something, Do something else, End)
  - All 5 edges correct with proper connectivity
  - Edge labels "Yes" / "No" rendered
  - Diamond shape for decision node ✓
  - Nodes: `<g class="node" data-id="...">` with `<rect>` + `<text>`
- **sequence: PASS**
  - 1ms (synchronous), 4.3KB SVG
  - Both participants (Alice, Bob) with actor boxes ✓
  - All 4 messages with correct direction and content ✓
  - Solid lines for `->>`; dashed lines for `-->>` ✓
  - Message text fully legible
- **text sizing:** 13px (node labels), 11px (edge labels/message text). No overflow observed. Font: Inter via @import (falls back to system-ui, sans-serif).
- **layout correctness:** ELK-based layout — flowchart layout correct and sensible. Sequence layout correct (lifelines, message order).
- **label legibility:** All labels fully legible; content text preserved accurately (including "I'm good thanks!" as HTML entity).
- **CSS controllability:** Excellent — `--bg` and `--fg` CSS custom properties on `<svg>` element; derived values for `--_text`, `--_text-sec`, `--_text-muted`, `--_line`, `--_arrow`, `--_node-fill`, `--_node-stroke`. 15 built-in themes. Live theme switching without re-render. Also exports `fromShikiTheme()` for VS Code theme integration.
- **diagram types supported:** 6 — flowchart, state, sequence, class, ER, XY
- **error handling:** Malformed input returns partial SVG (2KB, valid SVG) — does not throw. Graceful degradation.
- **API:** Synchronous `renderMermaidSVG(source)`, async variant `renderMermaidSVGAsync(source)`. Bonus: `renderMermaidASCII(source)` for terminal output.
- **globalThis side-effects:** None — zero-DOM.
- **known limits:**
  - From-scratch parser (not official mermaid.js) — edge cases possible for exotic syntax
  - 6 supported diagram types (flowchart, state, sequence, class, ER, XY); others will fail or silently produce partial output
  - `@import url(https://fonts.googleapis.com/...)` in `<style>` — font loads from CDN; offline falls back to system-ui (no visual breakage)
  - First ELK flowchart layout call ~76ms; sequence is <2ms (no layout engine needed)
  - Malformed returns partial SVG (empty/stub nodes) rather than throwing — callers must check output size if they need error detection
- **verdict: SHIP**

---

## DECISION: Ship `beautiful-mermaid @ 1.1.3`

**Rationale:** Works out-of-box, zero-DOM, fast (1–76ms), excellent SVG quality, dead-simple CSS theming. The from-scratch renderer limitation is acceptable — we target flowchart and sequence only, both of which render with high fidelity.

**Known limits to document in 10-3053:**
1. From-scratch parser — exotic mermaid syntax may not parse
2. 6 diagram types only (flowchart ✓, sequence ✓)
3. @import Google Fonts (fallback: system-ui)
4. Malformed input returns partial SVG (not an error) — add size-check guard in wrapper

**This unblocks 10-3053** (companion render pass).

Spike artifacts: `.scratch/spike-beautiful.mjs`, `.scratch/beautiful-flowchart.svg`, `.scratch/beautiful-sequence.svg`

## Verification

- Verifier: Dispatch sub-agent (a43cc068594a3e592)
- Date: 2026-06-27
- Verdict: **APPROVED**
- All 4 acceptance criteria confirmed:
  1. Both libs evaluated; SVG outputs verified on disk (flowchart + sequence)
  2. Pure-JS/in-process constraint honored — no Chromium, no container
  3. Clear decision: `beautiful-mermaid @ 1.1.3` with known limits documented
  4. Throwaway script (`spike-beautiful.mjs`) proves `mermaid → .svg` locally
- Git diff: task files only — no product code changed
