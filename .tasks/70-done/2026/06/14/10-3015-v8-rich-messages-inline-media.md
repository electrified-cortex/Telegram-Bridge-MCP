---
created: 2026-06-13
status: draft
priority: 15
source: Curator decomposition of epic 10-3001 (operator voice, 2026-06-11)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
epic: 10-3001-v8-rich-messages-markup
depends_on: ["10-3010", "10-3011", "10-3013"]
---

# 10-3015 — Rich Messages: Inline Media Blocks (Photo, Collage, Slideshow)

## Context

Bot API 10.1 introduced `RichBlockPhoto`, `RichBlockCollage`, `RichBlockSlideshow`,
`RichBlockAnimation`, `RichBlockAudio`, `RichBlockVideo`, and `RichBlockVoiceNote`
as block-level media embed types inside rich messages. The operator's "yummy
formatting goodness" explicitly includes inline media.

This is a **lower-priority, later-phase task** (Priority 15, vs 10 for the core
compiler tasks). It sits behind 10-3013 because it extends the compiler, but it
is otherwise independent of 10-3014 (tables/math/details) and can be developed
in parallel with it.

**Non-regression constraint:** Existing file-send paths (`sendVoiceDirect`,
photo/document/animation send in `src/telegram.ts`) are not touched. Inline
media inside a rich message is a distinct concept from sending a standalone
media message.

## Objective

Extend `src/rich-message-compiler.ts` with support for detecting media-reference
constructs in Markdown input and emitting the corresponding media `RichBlock`
nodes. This enables agents to include photos, animations, and slideshows inside
a rich message body using Markdown syntax.

### Markdown convention (Option A — extended image syntax)

Option A (extended image syntax) is chosen as the default: `![caption](file_id)`
where file_id is a Telegram file_id (non-HTTPS string) maps to a `RichBlockPhoto`
block; standard `![alt](https://url)` image links are passed through as-is
(returned as `null` from `parseMediaBlock`). This default is revisitable.

```
![caption](file_id_or_url)          → RichBlockPhoto (file_id) or null (HTTPS URL)
![caption](file_id_1 file_id_2 ...)  → RichBlockCollage (multiple file IDs)
```

The executor must document this convention in `docs/formatting.md` before writing
code. The approach does not conflict with standard `![alt](url)` image link syntax
already handled (or passed through) by `markdownToV2`.

### Media blocks to implement

| Block type | When emitted |
|---|---|
| `RichBlockPhoto` | Single image reference |
| `RichBlockCollage` | Two or more image references grouped together |
| `RichBlockSlideshow` | Explicit slideshow directive |
| `RichBlockAnimation` | GIF / animation reference |

Audio, video, and voice note (`RichBlockAudio`, `RichBlockVideo`,
`RichBlockVoiceNote`) are deferred — those have dedicated send paths today and
the inline-embed use case is less common.

### Fallback behaviour

If the chosen media syntax is encountered but the block type is not supported
by the Bot API (e.g., the API returns an error for a `RichBlockCollage`), the
router (10-3016) handles fallback. The compiler itself must produce the correct
block type without throwing.

## Scope

**Modifies:**
- `src/rich-message-compiler.ts` — additive; no Phase 1 or Phase 3 logic altered.
- `src/rich-message-compiler.test.ts` — additive.
- `docs/formatting.md` — additive section documenting the chosen media syntax.

**Does not modify:**
- `src/markdown.ts`, `src/telegram.ts`, any existing send path, or outbound proxy.
- Existing file-send tools (`send/file.ts`, `sendVoiceDirect`, etc.).

## Acceptance Criteria

- [ ] `src/rich-message-compiler.ts` exports a `parseMediaBlock(line: string): RichBlock | null`
      function that correctly returns a `RichBlockPhoto` node for a single
      `![caption](file_id)` reference using the extended image syntax (Option A),
      and returns `null` for a standard `![alt](https://…)` URL — confirmed by
      at least two dedicated unit tests in `src/rich-message-compiler.test.ts`.
- [ ] `RichBlockPhoto`, `RichBlockCollage`, `RichBlockSlideshow`, and
      `RichBlockAnimation` are emitted for the correct input patterns.
- [ ] Standard `![alt](url)` image syntax that does NOT match the media
      convention is passed through as a plain text or link node — it does
      not accidentally trigger a media block.
- [ ] All new tests pass; `pnpm test` green.
- [ ] **Non-regression gate:** the 10-3010 snapshot suite passes unchanged.
      No existing rendering path is affected.
- [ ] `tsc --noEmit` passes.
- [ ] `grep -r markdownToRichBlocks src/tools/` returns no results (routing
      is deferred to 10-3016).

## Delegation

Executor: Worker / Reviewer: Curator

## Notes

- This task may slip to a post-V8 minor if the media-block schema fields in
  10-3011 are not fully confirmed (e.g., whether file_id vs URL is accepted,
  whether captions are required). If the schema is ambiguous, stub the parser
  with a `TODO(10-3015)` comment and skip the implementation tests for that
  block type. Shipping a partial implementation with clear stubs is preferred
  over delaying 10-3016 (routing).
- The epic §8 explicitly marks "Per-block inline keyboard / button attachments"
  as out of scope. Media blocks in this task carry no inline keyboards.
- Priority 15 (vs 10 for other tasks) reflects that this capability has a
  fallback (images just don't render inline) and the media-convention design
  decision adds uncertainty.

## Overseer review

**Reviewer**: Overseer
**Date**: 2026-06-13
**Verdict**: PASS
**Review type**: Adversarial (3-round; round 1 failed on design-gate AC1; round 2 failed because Objective section still TBD; round 3 PASS after Option A explicitly chosen)
**Checked**: Convention choice concrete (Option A — extended image syntax), AC1 binary, scope additive, non-regression, delegation
**Not checked**: Audio/video block types (deferred per spec notes)

## Verification

**Verifier**: Dispatch sub-agent (standard tier)
**Date**: 2026-06-14
**Verdict**: APPROVED (2nd pass — evidence files present)
**Commit**: d806af57 — feat(rich-messages): Phase 4 compiler — inline media blocks (10-3015)
**Tests**: 3552/3552 passing · tsc --noEmit clean · markdown.test.ts non-regression confirmed
**Checked**: AC1 parseMediaBlock exported + ≥2 unit tests; AC2 Photo/Collage/Slideshow/Animation emitted; AC3 HTTPS/HTTP passthrough; AC4 pnpm test green; AC5 snapshot baseline; AC6 tsc; AC7 grep guard.
**Note**: First pass NEEDS_REVISION on missing .temp/ evidence files; resolved by foreman evidence capture (pnpm test run in worktree, 3552/3552 confirmed).

Sealed-By: Foreman
