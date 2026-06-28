---
title: "Add link_preview_options control to outbound text sends (Bot API 7.0)"
created: 2026-06-26
status: draft
priority: 15
type: Feature
source: Operator directive — Telegram feature audit (2026-06-26)
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
epic: Bot API feature coverage
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
related:
  - .tasks/20-backlog/20-194-enhanced-polls-support.md
---

# 15-0011 — Link preview control on text sends (`link_preview_options`)

## Problem

The bridge exercises no control over Telegram link previews. There is **no**
`disable_web_page_preview` and **no** `link_preview_options` anywhere in `src/`
(verified by grep). Every URL the agent emits gets Telegram's default behaviour:
a large auto-generated preview card attached below the message, built from the
**first** link found in the text.

For an agent→operator status bridge this is a recurring quality problem:

- A status line like `deploy finished — https://ci.example/run/123` renders a
  fat preview card that dominates the message and buries the actual text.
- Messages that mention several links get a preview for only the first one,
  which is often not the relevant one.
- Notifications, progress updates, and service-style messages read as noise when
  every embedded link expands.

`disable_web_page_preview` is the legacy field; **Bot API 7.0 replaced it with
the structured `LinkPreviewOptions` object** (`is_disabled`, `url`,
`prefer_small_media`, `prefer_large_media`, `show_above_text`). grammY 1.43
(installed) supports passing `link_preview_options` directly on `sendMessage` —
no raw `fetch` is required for the standard send path.

## Goal

Give the agent per-message control over link previews on text sends, defaulting
to **current behaviour** (previews on) so nothing changes unless opted in.

Minimum viable surface: a `link_preview` parameter on `send` (type `"text"`)
that maps to a `link_preview_options` object on the underlying `sendMessage`
call.

## Proposed parameter

Add to the `send` tool schema (`src/tools/send.ts`), text path:

```
link_preview: z.enum(["default", "off", "small", "large", "above"]).optional()
```

Mapping to `link_preview_options`:

| value     | link_preview_options                                   |
| --------- | ------------------------------------------------------ |
| `default` | omit (current behaviour — large preview, below text)   |
| `off`     | `{ is_disabled: true }`                                 |
| `small`   | `{ prefer_small_media: true }`                          |
| `large`   | `{ prefer_large_media: true }`                          |
| `above`   | `{ show_above_text: true }`                             |

(`url` override — preview a different link than the first one in the text — is a
possible later extension; not in MVP scope.)

## Integration points

The text path assembles `sendMessage` options inline at several call sites — all
must thread the new option through (or, preferably, build options once and reuse):

- `src/tools/send.ts` — text-only sends:
  - `getApi().sendMessage(...)` direct send loop (~line 573)
  - queued-after-audio send (~line 513)
  - the caption-overflow text follow-up after a voice note (~line 433)
- `src/telegram.ts` — `routeOutboundMessage()` (the rich-message-vs-plain router;
  ~line 901). The plain branch (`getApi().sendMessage`, ~line 970) should accept
  and forward `link_preview_options`.
- Shared text emitters that should honour the same option for consistency:
  `src/tools/send/notify.ts`, `src/tools/send/append.ts`,
  `src/tools/send/stream.ts`, `src/tools/send/dm.ts`.

Out of MVP scope (note but don't wire yet):

- **Rich-message path** (`sendRichMessageDirect` in `src/telegram.ts`): Bot API
  10.1 rich messages are a separate sending surface; link-preview semantics there
  are not confirmed. If `link_preview` is set AND rich routing would apply, either
  fall back to the plain path or document that the option is ignored for rich.
- **File captions** (`src/tools/send/file.ts`): Telegram does preview the first
  link in a caption, but captions rarely carry links. Defer unless trivial.

## Design questions

1. **Default behaviour.** MVP keeps previews on (no behaviour change). Should
   *notification*/*progress*/*service* style messages instead default to
   `off`, since previews there are almost always noise? (Recommend: ship MVP
   opt-in first; revisit per-type defaults as a follow-up.)
2. **Profile-level default.** Should there be a `profile/link-preview` default
   (mirroring how topic/voice profile defaults work) so an operator can suppress
   previews globally without passing the param every time? (Defer to follow-up.)
3. **Multi-chunk messages.** When `splitMessage` produces multiple chunks, apply
   the option to every chunk, or only the chunk that actually contains a link?
   (Recommend: apply to all chunks — simplest, and a disabled preview on a
   link-less chunk is a no-op.)

## Acceptance criteria

- [ ] `send` (type `"text"`) accepts a `link_preview` param with the five values
      above; omitting it preserves today's behaviour exactly.
- [ ] `link_preview: "off"` produces a message with no preview card for a text
      containing a URL.
- [ ] `small` / `large` / `above` set the corresponding `link_preview_options`
      field on the outgoing `sendMessage` call.
- [ ] The option is threaded through the direct, queued-after-audio, and
      caption-overflow text send sites in `send.ts`, and through
      `routeOutboundMessage`'s plain branch.
- [ ] Behaviour for the rich-message path is explicitly decided and documented
      (ignored or plain-path fallback) — no silent half-support.
- [ ] Unit test covers the value→`link_preview_options` mapping.
- [ ] `pnpm build` clean; `pnpm test` passes.
- [ ] PR staged against `dev`. Do NOT merge.

## Scope boundary

- Text send paths only. No file-caption, poll, or rich-message wiring in this task.
- No new profile default and no per-type default changes (both are follow-ups).

## Notes

- grammY 1.43 types include `link_preview_options` on `sendMessage` options —
  no raw `fetch` needed for the plain path.
- Sibling Bot-API-coverage task: enhanced polls
  ([20-194](../20-backlog/20-194-enhanced-polls-support.md)).
