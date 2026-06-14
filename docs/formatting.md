# Telegram Message Formatting Guide

Three formatting modes are available. Choose based on your content:

| Mode | Best for |
| --- | --- |
| **Markdown** (default) | Standard Markdown auto-converted — zero escaping needed. |
| **MarkdownV2** | Full Telegram V2 control; you handle all escaping manually. |
| **HTML** | Punctuation-heavy content or advanced layout features. |

---

## Default: Markdown (auto-converted)

Omit `parse_mode` or pass `"Markdown"`.
Write standard Markdown and the server converts it to MarkdownV2
automatically — no manual escaping required.

### Supported syntax

| Syntax | Result |
| --- | --- |
| `*bold*` or `**bold**` | **Bold** |
| `_italic_` | _Italic_ |
| `__underline__` | Underline |
| `` `code` `` | Inline code |
| `[text](url)` | Hyperlink |
| `# Heading` | Bold heading |

Plain text is passed through with all MarkdownV2 special characters
escaped automatically — periods, dashes, exclamation marks, parens, etc.

### Example

```json
{
  "text": "Task complete. Saved **3 files** to `output/` — done!"
}
```

No escaping needed.

---

## MarkdownV2 (manual)

Pass `parse_mode: "MarkdownV2"` for full control or V2-only features
like spoilers (`||text||`) and expandable block quotes.

The following characters **must** be escaped with `\` everywhere in
plain-text portions:

```text
_ * [ ] ( ) ~ ` > # + - = | { } . !
```

---

## HTML

Pass `parse_mode: "HTML"`.
Best for content with heavy punctuation.
Only `&`, `<`, `>` need escaping.

| Tag | Effect |
| --- | --- |
| `<b>text</b>` | **Bold** |
| `<i>text</i>` | _Italic_ |
| `<u>text</u>` | Underline |
| `<s>text</s>` | Strikethrough |
| `<code>text</code>` | Inline monospace |
| `<pre>text</pre>` | Monospace block |
| `<pre><code class="language-python">...</code></pre>` | Syntax-highlighted block |
| `<a href="URL">text</a>` | Hyperlink |
| `<tg-spoiler>text</tg-spoiler>` | Hidden spoiler text |
| `<blockquote>text</blockquote>` | Block quote |
| `<blockquote expandable>text</blockquote>` | Collapsible block quote |

---

## Plain text (no parse_mode)

Omit `parse_mode` entirely.
No escaping, no formatting rendered.
Use for simple one-liner status messages.

---

## `send(type: "notification")` tool

The `send(type: "notification", ...)` call accepts an optional `parse_mode` parameter.
Default is `"Markdown"` — write standard Markdown in the text field and it
is auto-converted.

```json
{
  "type": "notification",
  "title": "Build finished",
  "text": "Deployed **v1.2.3** to `production` — all tests passed.",
  "severity": "success"
}
```

Note: the `title` is always rendered bold by `send(type: "notification")` regardless of `parse_mode`.

---

## Rich Messages (`RICH_MESSAGES=true`)

Set the `RICH_MESSAGES=true` environment variable to enable the rich-message
compiler path.  When enabled, Markdown input is compiled by
`markdownToRichBlocks` into structured `RichBlock` objects and sent via the
Telegram Bot API 10.1 `sendRichMessage` method instead of the legacy
`sendMessage` path.

### GFM Tables → `RichBlockTable`

Standard GitHub-Flavored Markdown pipe tables are compiled to `RichBlockTable`:

```markdown
| Column A | Column B | Column C |
| :------- | :------: | -------: |
| left     | center   | right    |
```

- The second row must be a valid separator row (`---`, `:---`, `---:`, `:---:`).
- Header cells receive `is_header: true`.
- Alignment hints map to the `align` field: `:---` → `"left"`, `---:` → `"right"`, `:---:` → `"center"`.
- All parsed tables have `is_bordered: true` by default.
- A pipe row **without** a separator row is emitted as a plain paragraph.

### Display Math (`$$...$$`) → `RichBlockMathematicalExpression`

Fenced display-math blocks use `$$` delimiters:

```markdown
$$
E = mc^2
$$
```

Single-line form is also supported:

```markdown
$$ E = mc^2 $$
```

Both emit `{ type: "mathematical_expression", expression: "E = mc^2" }`.
An unclosed `$$` block falls through to a paragraph (no crash).

### Inline Math (`$...$`) → `RichTextMathematicalExpression`

Inside any paragraph, `$...$` delimiters produce an inline math node:

```markdown
The formula $x^2 + y^2 = r^2$ describes a circle.
```

Heuristics to avoid false positives:
- A `$$` sequence at the current position is **not** treated as inline math (it is display math at the block level).
- `$digit` patterns such as `$100` are treated as plain dollar signs (currency amounts).
- Whitespace-only content between `$` delimiters is not treated as math.

### Collapsible Details (`:::details`) → `RichBlockDetails`

The VitePress/Docusaurus `:::details` convention is used for collapsible sections:

```markdown
:::details Optional title
Body content — any Markdown blocks.
:::
```

- The opening line matches `:::details [title]`.  If the title is omitted, the
  `summary` field defaults to `"Details"`.
- The closing line is exactly `:::`.
- Body lines are parsed recursively as Markdown blocks (headings, lists, etc.).
- Nested `:::details` blocks are not supported in Phase 3; inner `:::details`
  lines are treated as plain text.
- An unclosed `:::details` falls through to a paragraph (no crash).
- The `is_open` field is omitted (collapsed by default).

**Rationale for `:::details`:** this syntax is unambiguous and does not
conflict with CommonMark.  HTML `<details>` blocks are not used here to avoid
parsing complexity in the rich-message compiler path.
