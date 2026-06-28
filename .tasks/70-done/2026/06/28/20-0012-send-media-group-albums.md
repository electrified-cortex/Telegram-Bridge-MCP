---
title: "Add media-group (album) sends — sendMediaGroup"
created: 2026-06-26
status: draft
priority: 20
type: Feature
source: Operator directive — Telegram feature audit triage (2026-06-26)
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
epic: Bot API feature coverage
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
related:
  - .tasks/10-drafts/15-0012-copy-text-buttons-send-option.md
---

# 20-0012 — Media-group (album) sends

## Problem

`send_file` (`src/tools/send/file.ts`) sends exactly one file per call. When the
agent has several related images — e.g. three failing-test screenshots, a
before/after pair, a set of diagrams — it must send them as separate messages,
which fragments the conversation and fires multiple notifications.

Telegram's `sendMediaGroup` sends 2–10 media items as a **single album message**
with one shared notification. This is the natural primitive for "here are the N
screenshots."

## Goal

Add an album send path that takes 2–10 media items and delivers them as one
Telegram album.

## Proposed surface

A new `send` type (preferred, consistent with existing routing) — `type: "album"`
— or a sibling tool `send_album`. Recommend the `send` type for discoverability.

```
files: z.array(z.object({
  file: z.string(),                       // local path / HTTPS URL / file_id
  type: z.enum(["photo","video","document","audio"]).default("photo").optional(),
  caption: z.string().optional(),         // per-item caption (optional)
})).min(2).max(10)
caption: z.string().optional()            // album-level caption (applied to first item if per-item absent)
```

Maps to `getApi().sendMediaGroup(chatId, InputMedia[])` where each item is an
`InputMediaPhoto | InputMediaVideo | InputMediaDocument | InputMediaAudio`,
resolved through the existing `resolveMediaSource()` (keeps the SAFE_FILE_DIR /
http:// guards).

## Constraints (enforce before calling the API)

- **2–10 items.** 1 item → instruct to use `send_file`; 0 or >10 → structured error.
- **Type homogeneity.** Telegram only allows mixing **photo + video** in one
  group. `document` and `audio` each must be a group of that single type. Reject
  mixed groups with a clear error (`MEDIA_GROUP_TYPE_MIX`).
- **No inline keyboard.** Albums cannot carry `reply_markup` — document this; do
  not accept copy/choice buttons on this path.
- **Captions.** Only the first item's caption shows as the album caption in most
  clients; per-item captions are allowed but render only when a single item is
  expanded. Keep the album-level `caption` as the common case.
- Reuse `validateCaption` for caption length; reuse `resolveMediaSource` per item.

## Integration points

- New handler `src/tools/send/media-group.ts` (`handleSendMediaGroup`), modeled on
  `handleSendFile` (typing indicator via `showTyping`, `callApi` wrapper, CDN
  warning, absolute-path guard on each caption).
- `src/tools/send.ts` — register `"album"` in `SEND_TYPES` and route to the new
  handler; add the `files` array to the schema.
- Returns `message_ids` for all album items (sendMediaGroup returns a Message[]).

## Acceptance criteria

- [ ] `send(type: "album", files: [...2–10 photos])` delivers one album with one
      notification; returns all `message_ids`.
- [ ] 1-item or >10-item input returns a structured error with a hint.
- [ ] Mixed photo+document (or other illegal mix) returns `MEDIA_GROUP_TYPE_MIX`.
- [ ] Each item passes the SAFE_FILE_DIR / http:// guard via `resolveMediaSource`.
- [ ] Absolute-path guard runs on every per-item caption.
- [ ] `pnpm build` clean; `pnpm test` passes.
- [ ] PR staged against `dev`. Do NOT merge.

## Scope boundary

- No inline keyboards on albums (Telegram limitation).
- No editing of an already-sent album in this task.

## Notes

- grammY 1.43 exposes `sendMediaGroup` and the `InputMedia*` types.
- CDN-persistence warning (from `send_file`) applies and should be surfaced.

## Overseer review

- reviewer: Overseer
- date: 2026-06-28
- verdict: PASS
- review type: inline gate (clear feature, well-specced)
- checked: ACs binary (album delivery, count guards, type-homogeneity error, per-item SAFE_FILE_DIR guard, caption guard, build+test clean, PR staged not merged), scope bounded to one new handler + send.ts routing, delegation correct, no open questions

## Verification

- verifier: task-verification agent (abf146f99e0df614f)
- date: 2026-06-28
- verdict: NEEDS_REVISION (round 1) — test-plan.md absent from .worker-pod/.temp/; test-results.md present with 4128/4128 pass
- squash_commit: 4c18b01a
- pending: test-plan.md created by foreman; re-verification dispatched
