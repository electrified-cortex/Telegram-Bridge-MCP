# Mermaid / unrenderable-content attachment — operator requirements

**Raised:** operator, 2026-06-29 (voice, during S-IM deploy wait). Detailed requirements below.
**Status:** REQUIREMENTS CAPTURED — operator said "additional things I'd like to ask for" may follow. Then → TMCP spec (Overseer implements). Currently the feature "sort of works" but is NOT ideal.

## Expected behavior

1. **Baseline attach + text + markdown.** Be able to attach a file to a message that also has text, ideally retaining at least minimal markdown (standard Telegram MarkdownV2). TEST: can a message carry a file attachment AND keep markdown formatting — or is markdown only available as a caption?

2. **The "magic" (core).** When a send contains unrenderable content (e.g. a mermaid chart) — start with the plain send-TEXT tool, later also markdown:
   a. DETECT the mermaid chart.
   b. EXTRACT it into an `.mmd` file. Default name e.g. `chart.mmd` / `flowchart.mmd` ("make it cool").
   c. Replace the chart in-text with PLACEHOLDER text whose wording DEPENDS ON DELIVERY MODE: same-message attachment → "see attachments"; follow-up message → "see following attachments" / "see following message". The sent text must look EXACTLY the same as the original EXCEPT the chart block is supplanted by the placeholder — NO other formatting changes.
   d. Send the `.mmd` as an attachment.

3. **SVG companion (general `.mmd` rule).** Whenever ANY `.mmd` file is attached, the system auto-CREATES the rendered SVG and attaches it as a COMPANION: same base name + `.svg`, placed RIGHT AFTER the `.mmd` in the SAME message. So a chart ships as `chart.mmd` + `chart.svg` paired (source + rendered). This is general `.mmd`-attachment behavior, not only the in-text-detection path — confirmed by operator as a previously-agreed requirement ("many stories").

4. **Ordering.**
   - IDEAL (gold): attachment in the SAME message, same formatting, only the placeholder substituted for the chart.
   - IF same-message isn't possible without changing formatting: attachment AFTER the message, NEVER before. Rationale: an attachment above a long message can scroll off / be hidden → recipient never sees it → looks like a bug. After the message = recipient KNOWS it arrived and is visible.
   - FALLBACK EXPLICITLY ACCEPTABLE (operator: "worst case is not that bad"): message ships with a placeholder ("See following attachments"); attachments generated on the fly, bundled in the same message if possible, ELSE sent as a FOLLOW-UP message right after. Do NOT block on same-message. The MARKDOWN/TABLES path likely REQUIRES this follow-up approach (markdown formatting + same-message attachment may be infeasible) — placeholder-replace then attach as a follow-up message. Ideal remains all-in-one-message.

## Architecture (operator clarification 2026-06-29) — ONE pre-send pipeline

The two features are NOT separate/post-hoc — they run as ONE LOOP: a CHAIN OF DETECTION GATES that process the outbound message BEFORE it is sent.
- Feature 1: detect embedded mermaid chart(s) in the outbound content → extract to `.mmd`.
- Feature 2: render the `.mmd` → `.svg` companion + attach.
Both run in the same pre-send transformation chain; the message passes through the gate chain and is only sent once fully processed/ready. Implication for implementation: a pre-send middleware/pipeline of detectors (chained gates), NOT bolt-on after-send steps. Extensible — other detectors (e.g. tables) plug into the same chain.

## Bug observed (current behavior)

Current Mermaid feature sent an attachment, THEN the whole message — and the message FORMATTING was changed. Operator: "wrong / doesn't look right."

## Open / to test

- Can a Telegram message carry a file attachment while retaining MarkdownV2 formatting (vs caption-only)?
- Does markdown-containing-a-mermaid-chart currently work at all? (operator suspects not.)
- Operator has "additional" asks beyond this minimum — pending.

## Downstream

Same detect→extract→placeholder→attach pattern applies to TABLES/markdown (`.tasks/20-backlog/tmcp-backlog-table-rendering.md`). Mermaid is the reference implementation to get right first.
