# Research: inline image embed in message body (Telegram-hosted, not web-published)

**Raised:** operator, 2026-06-29 (held during the mermaid work; do AFTER mermaid + listener hardening land). Enhancement to epic 10-3050 (visual-content-attachments).

## Question

Can TMCP create/upload an image (e.g. the mermaid `.svg` or a generated image) that lives in Telegram (uploaded via the bot, NEVER web-published) and EMBED it INLINE in the message BODY as a thumbnail/reference — not only as a separate attachment + placeholder?

- **HTML:** can embed images (operator: works well for HTML sends).
- **Markdown / rich-text:** maybe — investigate.
- **Plain text:** maybe — investigate.

## Goal

Better than a placeholder: an actual inline THUMBNAIL in the message body, while the recipient still gets the full downloadable image (or at minimum the SVG). "See where I'm going — a thumbnail they can tap for the full image."

## Deliverable

Feasibility research: can a Telegram-uploaded image (file_id, not a public URL) be referenced/embedded inline in the message body via the bridge's send paths (HTML / markdown-rich / text)? If yes — how (mechanism). If no — why (Telegram API constraints: e.g. only `sendPhoto`/`sendDocument` carry media; message text can't inline a file_id). Then a spec if feasible.

## Status

RESEARCH QUEUED — behind mermaid (10-3055/3053) + the listener hardening. Use Haiku / local-LLM for the research per the resource rule (local-LLM > Haiku > Sonnet). Not urgent; operator framed it as "if the mermaid stuff works perfectly, here's the next thing."
