# 620 — Consistent Topic Formatting in Voice Captions

**Priority:** 600 (Medium)  
**Source:** Operator request (voice, 2026-03-19) — formatting audit

## Problem

Voice captions built by `send_text_as_voice` (in `src/tools/send_text_as_voice.ts`) render the topic differently from text messages:

| Surface | Current output | Should be |
|---|---|---|
| Text message | `**[topic]**\n` (bold, Markdown) | ✅ correct |
| Voice caption | `[topic] caption` (plain, no parse_mode) | ❌ needs fix |

**Root cause — `src/tools/send_text_as_voice.ts` line 84:**
```typescript
? caption ? `[${topic}] ${caption}` : `[${topic}]`
```
- Not bolded (`**[${topic}]**`)
- No newline before the caption body
- No `parse_mode: "Markdown"` injected → bold wouldn't render even if added

The same caption string is then passed to `sendVoiceDirect`, which prepends the name-tag header (via `buildHeader()`) using `parse_mode: "Markdown"` — but only if a header exists. The topic's bold needs to be part of the same parse_mode-aware block.

## Expected Format

The desired layout for voice captions (and consistently for ALL messages) is:

```
🟦 🤖 `Overseer`
**[format audit]**
A brief spoken summary of what this voice note contains.
```

Each element on its own line:
1. **Name tag line** — `🟦 🤖 \`Overseer\`` (already working via `buildHeader()`)
2. **Topic line** — `**[topic]**` — bold, brackets, its own line
3. **Caption body** — free text, after the topic

Single session (no name tag) with topic and caption:
```
**[format audit]**
Caption text.
```

Topic only (no caption body):
```
🟦 🤖 `Overseer`
**[format audit]**
```

## Fix

In `src/tools/send_text_as_voice.ts`:

1. Change topic injection to use `**[${topic}]**` (bold brackets).
2. Add a newline between topic label and caption body when both are present: `` `**[${topic}]**\n${caption}` ``.
3. Ensure `parse_mode: "Markdown"` is passed to `sendVoiceDirect` when a topic is injected (so bold renders). Currently the tool doesn't pass `parse_mode` at all — `sendVoiceDirect` auto-injects it only when a name-tag header is present. When single-session (no header), `parse_mode` won't be set and bold won't render.

**Proposed change in `send_text_as_voice.ts`:**
```typescript
const topic = getTopic();
let resolvedCaption: string | undefined;
let captionNeedsMarkdown = false;

if (topic) {
  captionNeedsMarkdown = true;
  const topicLabel = `**[${topic}]**`;
  // Topic on its own line; caption body after (if present)
  resolvedCaption = caption ? `${topicLabel}\n${caption}` : topicLabel;
} else {
  resolvedCaption = caption ?? undefined;
}
```

And when calling `sendVoiceDirect`, pass `parse_mode: "Markdown"` when `captionNeedsMarkdown` is true:
```typescript
caption: isFirst ? resolvedCaption : undefined,
parse_mode: captionNeedsMarkdown ? "Markdown" : undefined,
```

## Acceptance Criteria

- [ ] Voice caption with topic set shows `**[topic]**` in bold when `parse_mode: "Markdown"` is active.
- [ ] Caption body appears on a new line after the topic label.
- [ ] Works in both single-session (no name tag) and multi-session (with name tag).
- [ ] Existing caption-only (no topic) behavior unchanged.
- [ ] Tests updated / added for the new format.

## Related

- `src/tools/send_text_as_voice.ts` — where fix goes
- `src/telegram.ts` — `sendVoiceDirect` (handles `parse_mode` for name tag injection)
- `src/topic-state.ts` — `applyTopicToText()` (reference for correct bold format in text messages)
- Task 610 (shutdown guidance) — unrelated, but same priority batch
