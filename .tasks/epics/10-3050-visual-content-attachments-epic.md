---
id: "10-3050"
title: "Epic: Visual content attachments — embedded SVG & mermaid → viewable files"
type: epic
created: 2026-06-26
status: draft
priority: 15
source: Operator directive — Telegram feature audit (2026-06-26)
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
supersedes: .tasks/10-drafts/icebox/15-0013-mermaid-diagram-attachments-SUPERSEDED.md
stories:
  - 10-3051   # normalize embedded content → attachments; SVG path (a)
  - 10-3052   # mermaid→SVG engine: spike & select
  - 10-3053   # companion-render pass: any .mmd → .svg (serves b + c)
  - 10-3054   # (conditional) build our own renderer
  - 10-3056   # local chart rendering: send(type:"chart") → SVG/PNG (companion)
---

# Epic 10-3050 — Visual content attachments (SVG & mermaid)

## Objective

When an agent embeds visual content in a message, deliver it as an attachment the
operator can tap to open and view — because **Telegram renders neither SVG nor
mermaid inline** (not in text, not in rich messages, not via `sendPhoto`, which
rejects SVG). The agent keeps writing what it writes; the bridge detects the
visual, replaces it with a short `[…attached]` placeholder, and attaches a
viewable file.

Operator confirmed (2026-06-26): SVG/HTML attachments open in appropriate
viewers and look great; a **responsive SVG** (`width="100%"` + `viewBox`, no
fixed px) scales to fill the viewer with no pinch-zoom.

## Rules (canonical)

1. **`.mmd` attached** → auto-generate a companion `.svg` and attach it
   *(skip if a companion `.svg` is already present — no dup)*.  ← single render point (10-3053)
2. **`.svg` embedded** (in message text) → placeholder it + attach it as `.svg`.  ← no engine (10-3051)
3. **`.mmd` embedded** (` ```mermaid ` in text) → placeholder it + attach it as a
   `.mmd` file, **auto-triggering Rule 1** (which adds the `.svg`).  ← normalize (10-3051) → Rule 1

Every mermaid case funnels into Rule 1; Rule 3 just normalizes embedded mermaid
into a `.mmd` first. (Edge: a directly-attached standalone `.svg` simply sends
as-is, optionally responsive-ized — no engine, no rule needed.)

## Scope

**The `.mmd` file is the universal intermediate for mermaid** — so the two mermaid
entry points converge. Three entry points, normalized to a common form, then one
render pass:

- **(a) Embedded SVG** (in message text) → `🖼 [SVG attached]` placeholder + a
  responsive `.svg`. No engine — SVG is already rendered vector.
- **(b) Embedded mermaid** (` ```mermaid ` block in text) → **normalized to a
  `.mmd` attachment** + `📊 [diagram attached]` placeholder (by 10-3051).
- **(c) `.mmd` file attachment** (agent sends a mermaid source *file*) → already a
  `.mmd` attachment.

Then the **companion-render pass** (10-3053) handles (b) and (c) *identically*:
**any outgoing `.mmd` without a companion `.svg` → render + attach the `.svg`.**
There is no separate "embedded mermaid" code path — embedding just normalizes to a
`.mmd`, and everything downstream is one rule.

Pipeline: detect / normalize → placeholder → write to `SAFE_FILE_DIR` →
companion-render pass → `sendDocument`. Delivery reuses `handleSendFile` /
`SAFE_FILE_DIR`; no new transport.

**Two delivery modes.** (a)/(b)/(c) above are **embedded** content — detected in
the agent's message and attached. The epic also covers **explicitly-requested**
visuals:

- **(d) Charts** (Story 10-3056) — the agent calls `send(type:"chart")` with data;
  TMCP renders a chart **locally** (Chart.js on a native canvas — *no browser*,
  unlike mermaid) and attaches it. Replaces a third-party quickchart.io dependency
  (data-egress red flag). Shares the same render → responsive → attach back half
  and the local-only constraint; the trigger and engine differ.

## Engine strategy (the crux of the epic)

**Target: pure-JS, browserless, in-process — no Chromium, no container.** Puppeteer-
and playwright-based libs (`@mermaid-js/mermaid-cli`, `mermaid-isomorphic`) are
**out** — they reintroduce the Chromium dependency this whole effort avoids.

Decision ladder (Story 10-3052 runs it):

1. **Evaluate pure-JS browserless libs** — `isomorphic-mermaid` (svgdom + jsdom +
   dompurify, real mermaid@11; ⚠️ experimental: 13★, 2 commits, no release,
   `htmlLabels:false`), `beautiful-mermaid` (zero-DOM, themeable) — on the diagram
   types agents actually emit (flowchart, sequence).
2. **Good enough → ship it** (zero infra — best outcome).
3. **Not good enough → WE WRITE ONE** (operator directive, Story 10-3054).
   Scoped realistically — NOT full mermaid parity: fork/harden the svgdom approach,
   or a focused flowchart+sequence renderer (parser + dagre layout + font-metrics
   text measurement + SVG emit).
4. **kroki sidecar** (browser in a container, full fidelity) — non-preferred
   stopgap only; operator prefers in-process JS over a container.

## Stories

| # | Story | Depends | Ships independently? |
|---|---|---|---|
| **10-3051** | Normalize embedded content → attachments; **SVG path (a)** | — | yes — SVG needs no engine |
| **10-3052** | **Mermaid→SVG engine**: spike & select (lib vs build) | — | decision artifact |
| **10-3053** | **Companion-render pass**: any `.mmd` → `.svg` (serves **b + c**) | 10-3051, 10-3052 | completes b + c |
| **10-3054** | *(conditional)* **Build our own** renderer | 10-3052 | only if 10-3052 says libs fall short |
| **10-3056** | **Local chart rendering (d)** — `send(type:"chart")` → SVG/PNG | 10-3051 (pipeline) | yes — native canvas, no browser; parallel to mermaid |

Sequencing: 10-3051 and 10-3052 run in parallel. 10-3053 needs both. 10-3054 exists
only if 10-3052's verdict is "build." 10-3056 (charts) only needs the 10-3051
pipeline — its native-canvas engine is independent of the mermaid engine work, so
it can proceed in parallel.

## Styling / CSS

Output SVGs carry mermaid theme classes; `beautiful-mermaid` is fully themeable.
Post-render CSS/theme can restyle colors/fonts, and `viewBox` gives responsive
scaling. CSS styles the **output** — it does not do layout, so it sits after
whichever engine produced the geometry.

## Progress indicator (cross-cutting)

Show the **`upload_document`** chat action across the **entire render + attach
window**, not just the upload — reusing the existing `showTyping(seconds, action)`
mechanism the file-send path already uses (`src/tools/send/file.ts`). This is the
"sending file…" analog of typing/recording. It matters most for mermaid (b)/(c),
where engine render adds multi-second latency the operator can't otherwise see;
the indicator reassures them a diagram is coming. Essentially free — the plumbing
exists.

## Privacy

All rendering is **local / in-process** — neither diagram source nor output leaves
the machine. Do NOT use third-party renderers (mermaid.ink / public kroki).

## Risks / open questions

- **Engine quality** — svgdom text metrics are an approximation; `htmlLabels:false`
  changes label rendering. Quality on real diagrams is unproven → that's why
  10-3052 is a gated spike before any mermaid integration.
- **Lib maturity** — `isomorphic-mermaid` is bleeding-edge (2 commits). Depending
  on it is a risk; the build-our-own fallback (10-3054) de-risks the commitment.
- **Build effort** — "write one" must stay scoped to flowchart+sequence; full
  mermaid parity is out of scope (and a trap).
- **Client rendering** — responsive SVG scaling on the operator's mobile in-app
  viewer (largely proven by operator already; reconfirm on rendered output).
- **Detection false-positives** — a ` ```svg ` fence is ambiguous (source vs
  render); default to attach, revisit if surprising.

## Out of scope

- Inline-in-rich-message-body embedding (rich + public PNG URL — the
  [10-3018](../10-drafts/10-3018-v8-rich-messages-native-implementation.md) /
  Spike G path).
- Diagram types beyond flowchart + sequence in the build-our-own fallback.
- Other diagram languages (PlantUML, graphviz) — pipeline generalizes; later.
- Browser/Chromium/container-based rendering as the *primary* path.

## Epic acceptance criteria

- [ ] (a) SVG: placeholder + responsive `.svg` attachment, opens/scales on clients.
- [ ] (b) mermaid: placeholder + `.mmd` source + rendered responsive `.svg`.
- [ ] (c) `.mmd` file attachment with no companion `.svg` → companion `.svg`
      auto-rendered and attached; if the agent already supplied an `.svg`, no dup.
- [ ] (d) `send(type:"chart")` renders a chart locally (no third-party, no browser)
      from a simplified shape or a full Chart.js config, and attaches it.
- [ ] mermaid→SVG engine is pure-JS / in-process (no Chromium, no container) — a
      chosen lib or our own renderer.
- [ ] Graceful fallback throughout — a render failure still ships the source +
      placeholder note; **never a failed send.**
- [ ] `upload_document` chat action shown across the render + attach window
      (reusing `showTyping`), especially for mermaid render latency.
- [ ] No third-party network calls with diagram content.
- [ ] Stories 10-3051 + 10-3053 merged; 10-3052 decision recorded; 10-3054 only if
      its gate fired.

## Delivery

Begin 10-3051 (SVG ships value immediately, no engine) and 10-3052 (engine spike)
in parallel. 10-3053 integrates the chosen engine once 10-3052 decides. 10-3054 is
filed/worked only on a "build" verdict.
