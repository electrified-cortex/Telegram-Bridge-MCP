---
id: "10-3056"
title: "Story: local chart rendering — send(type:\"chart\") → SVG/PNG, no third-party"
type: story
created: 2026-06-26
status: draft
priority: 15
epic: 10-3050
depends_on:
  - 10-3051   # shared detect→render→responsive→attach pipeline + upload_document indicator
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
source: "Unit-12 / Operator — 2026-06-26: quickchart.io flagged as third-party data-egress red flag; operator requested fully local equivalent."
related:
  - .tasks/10-drafts/10-3053-mermaid-companion-render-pass.md
---

# 10-3056 — Local chart rendering ("local QuickChart")

Companion story to the mermaid rendering work in epic
[10-3050](../epics/10-3050-visual-content-attachments-epic.md). Mermaid and SVG
arrive **embedded** in agent content (detected → attached). Charts arrive
**explicitly requested** — the agent calls `send(type:"chart")` with data. Both
share the same back half: **render locally → SVG → responsive-ize → attach**
(the 10-3051 pipeline + `upload_document` indicator).

## Problem

- Charts were being produced via **quickchart.io** — a public SaaS where the
  chart **data rides in the request URL to a third party**. Pilot: "this is a
  redflag for sure." Unacceptable as a default for any fleet/private data.
- The other image path (mermaid-cli) is browser-bound and broken in-container.
- Need: reliable chart images generated **on-box, zero data egress**.

## Why this is the *easy* companion (vs mermaid)

QuickChart is just **Chart.js rendered server-side on a native canvas**. Crucially,
**charts need NO browser** — unlike mermaid (which is browser-bound and forced us
to kroki/build-our-own). A chart renderer is a thin wrapper:

- `chart.js` (the chart library) + a **native canvas backend** →
  **`chartjs-node-canvas`** (ready-made: Chart.js config JSON → PNG/SVG buffer).
- No Chrome, no kroki, no network. So this story carries far less engine risk than
  the mermaid path — its *only* real risk is the SVG-output question below.

> 🚫 **Hard engine constraint — NO BROWSER.** The renderer MUST be
> **`chartjs-node-canvas`** (Chart.js on **node-canvas**, a native Cairo binding) or
> an equivalent **native-canvas** backend. **No headless browser, no puppeteer, no
> playwright, no Chromium, no kroki, no network.** This is non-negotiable — it's the
> whole reason charts are the *easy* companion. Note the SVG path stays browser-free
> too: node-canvas emits SVG via a **Cairo SVG surface**, not a browser. Any proposal
> that pulls in a browser engine is rejected on sight; fall back to PNG before a browser.

## Agent DX — two-tier input (the core design call)

`send(type:"chart")` accepts EITHER:

- **Easy mode (default, 80% case):** a simplified shape, nothing else —
  ```json
  { "title": "Unit-12 Session Activity", "type": "line",
    "xLabels": ["12 AM","1 AM","2 AM"],
    "series": [ { "label": "Log entries / 30min", "data": [0,5,28] } ] }
  ```
  TMCP expands it to a full Chart.js config with **dark-theme defaults** (fonts,
  sizing, legend) and **SVG output**. Agents never hand-write Chart.js boilerplate.
- **Power mode:** a full Chart.js `config` object (`{type, data, options}`) for
  total control. The simplified shape is sugar over this; explicit options win
  over TMCP defaults.

Underlying format is plain Chart.js JSON, so existing QuickChart configs port over
unchanged (drop-in replacement).

## ⚠️ Gating spike — SVG output in-container

The draft assumes "SVG default," but **SVG output is the one real unknown** and
the SVG-vs-easy-install tension must be resolved first:

- **`node-canvas` (Cairo)** supports SVG surfaces → real SVG markup, but has
  finicky native build deps (Cairo/Pango) that may not build cleanly in-container.
- **`@napi-rs/canvas` (skia, prebuilt — already in the npx cache per Unit-12)** installs
  easily but is **raster/PNG-only** (no SVG export).
- **`skia-canvas`** is canvas + SVG export with prebuilt binaries — a middle option.

**Spike:** confirm which backend produces **SVG in the target container** without a
painful native build. Exit:
- If a backend gives clean in-container SVG → ship **SVG default** (responsive-ized
  like mermaid's, `width="100%"`+`viewBox`).
- If not → ship **PNG default** via `@napi-rs/canvas` (easy install, already
  cached). PNG is perfectly acceptable for charts (raster-friendly; no infinite-
  scale need like diagrams). SVG can follow later.

Either way the hard constraint holds: **local, no browser, no network.**

## Functional requirements

- **FR1** — `send(type:"chart")` accepts the simplified schema OR a full Chart.js
  `config`, plus optional `format` (`svg`|`png`), `width`, `height`, `theme`.
  AC: both input forms return a rendered image.
- **FR2** — Fully local, **zero outbound network**. AC: works with egress blocked.
- **FR3** — Default output is the spike's verdict (SVG if in-container SVG works,
  else PNG); the other is available via `format`. AC: no `format` → the default;
  explicit `format` honored.
- **FR4** — Simplified-schema expansion applies **dark-theme defaults** (matching
  the existing "Session Activity" look). AC: minimal `{title,type,xLabels,series}`
  → a styled dark chart with zero styling input.
- **FR5** — **Render-and-attach in one flow** via the 10-3051 pipeline: the agent
  gets the chart attached to the message with no temp-file management. SVG →
  responsive-ize + `sendDocument`; PNG → `sendDocument` (or inline `sendPhoto` —
  decide in impl; inline photo is nicer UX for a raster chart).
  AC: one call → chart attached.
- **FR6** — Power-mode passthrough: a full config renders faithfully; explicit
  options are not overridden by defaults. AC: explicit options win.
- **FR7** — Discoverability: schema is **inline on the `send` action params**
  (self-documenting at tool-load, like `type:"file"`), with a **`help('chart')`**
  topic carrying depth (simplified-vs-power, defaults, default-format, worked
  examples + gotchas). AC: an agent can render a chart from the tool schema alone;
  `help('chart')` gives examples.

## Non-functional / constraints

- **NFR1** — No third-party service, no headless browser. (Hard constraint — the
  whole point.) Matches the epic's local-only privacy stance.
- **NFR2** — Input = Chart.js config, so QuickChart configs port unchanged.
- New runtime deps: `chart.js` + a canvas backend (per the spike). Note the bundle/
  install impact in the PR.
- Show the `upload_document` chat action across render + attach (shared with epic).

## Decisions (Unit-12 open questions, resolved/recommended)

- **OQ1 (engine):** prefer the `chartjs-node-canvas` wrapper for speed-to-ship,
  **gated on the SVG spike** — its SVG path depends on the canvas backend. If SVG
  in-container is painful, fall back to PNG via `@napi-rs/canvas`. (decider: dev)
- **OQ2 (placement):** **TMCP core**, as a `send` type — consistent with the epic
  and with `type:"file"`/`type:"notification"`. Not a shelled-out sibling tool.
  (decider: dev/Curator)

## Out of scope

- A charting DSL / higher-level builder (caller supplies data or Chart.js config).
- Interactive/animated charts (static image only).
- Embedded-chart *detection* in message text — charts are explicitly requested via
  the send type, unlike mermaid/SVG (which are detected). If auto-detection of a
  chart-config code block is ever wanted, that's a separate follow-up.

## Acceptance criteria

- [ ] SVG-in-container spike resolved; default format decided and recorded.
- [ ] Engine is `chartjs-node-canvas` (or an equivalent native-canvas backend) —
      **verifiable: no `puppeteer`, `playwright`, `chromium`, or `headless` anywhere
      in the dependency tree** (`pnpm why puppeteer` etc. return nothing).
- [ ] `send(type:"chart")` renders both the simplified schema and a full Chart.js
      config, fully locally (egress-blocked test passes).
- [ ] Minimal `{title,type,xLabels,series}` → styled dark chart with no extra input.
- [ ] Explicit Chart.js options override TMCP defaults (power mode faithful).
- [ ] Chart is rendered-and-attached in one call via the 10-3051 pipeline;
      `upload_document` shown across render+attach.
- [ ] `help('chart')` topic + inline send-schema exist and are discoverable.
- [ ] No third-party/network calls; new deps noted in the PR.
- [ ] `pnpm build` clean; `pnpm test` passes. PR staged, not merged.

## Notes

- Pairs with the same fleet-drive cluster Unit-12 referenced: S-IM native file/attachment
  send, and the TMCP diagram detect/render/attach (this epic). This story is the
  "make the chart image" half; 10-3051/10-3053 are the "send the image" half.
