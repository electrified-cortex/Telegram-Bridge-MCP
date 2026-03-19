# Story: Make Name Tag Formatting Consistent

## Type

Story

## Origin

Operator voice message (2026-03-18):
> "The pattern is: bot icon, then monospace name, then if there's a topic, it's on the next line in brackets, bold."

## Current Behavior

- Session header: `🤖 Name\n` — plain text name, no monospace
- Topic: `**[Topic]**\n` — injected separately by `applyTopicToText()` in individual tools
- The proxy (`buildHeader()`) prepends the name header AFTER tools have already injected the topic, so the visual order is correct (name → topic → content)
- But the name is plain text, not monospace

### Code Locations

- `src/outbound-proxy.ts` L31-40: `buildHeader()` — generates `🤖 ${name}\n`
- `src/topic-state.ts` L53-57: `applyTopicToText()` — prepends `**[Topic]**\n`
- Tools that call `applyTopicToText`: `send_text`, `send_message`, `ask`, `confirm`, `choose` (via `button-helpers.ts`)

## Desired Format

When 2+ sessions are confirmed active:

```text
🤖 `Name`
**[Topic]**
Message content here
```

- **Line 1:** Bot emoji + name in monospace (backticks)
- **Line 2 (optional):** Topic in bold brackets — only if a topic is set
- **Line 3+:** Message content

When no topic is set:

```text
🤖 `Name`
Message content here
```

### MarkdownV2 Rendering

In MarkdownV2, the formatted output should be:

```text
🤖 `Name`\n**\[Topic\]**\nContent
```

Which `markdownToV2()` will convert to proper V2 escaping.

## Fix

Update `buildHeader()` in `outbound-proxy.ts` to wrap the name in backticks:

```typescript
const formatted = escape
  ? `🤖 \`${escapeV2(name)}\`\n`
  : `🤖 \`${name}\`\n`;
return { plain: `🤖 \`${name}\`\n`, formatted };
```

No changes needed to `applyTopicToText()` — the topic injection already works correctly and appears after the header in the final output.

## Acceptance Criteria

- [ ] Name appears in monospace after bot emoji: `🤖 \`Name\``
- [ ] Topic appears bold in brackets on the next line: `**[Topic]**`
- [ ] When no topic, name is followed directly by content
- [ ] Single-session mode: no header at all (existing behavior preserved)
- [ ] Works in Markdown, MarkdownV2, and HTML parse modes
- [ ] All existing outbound-proxy tests updated
- [ ] All tests pass
