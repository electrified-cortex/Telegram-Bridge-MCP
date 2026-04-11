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
