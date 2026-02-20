# Telegram Message Formatting Guide

Telegram supports three formatting modes. Choose based on your content:

| Mode | Best for |
|------|----------|
| **MarkdownV2** | Most formatted messages — agents write Markdown naturally |
| **HTML** | Rich/complex formatting, or content with lots of punctuation |
| **Plain text** (no `parse_mode`) | Simple status messages with no formatting needed |

---

## Default choice: MarkdownV2

Pass `parse_mode: "MarkdownV2"`. Agents naturally write in Markdown syntax, so bold, italic, inline code, and code blocks all work as expected.

### MarkdownV2 syntax

```
*bold*
_italic_
__underline__
~strikethrough~
`inline code`
```
pre-formatted block
```
```python
code block with syntax highlighting
```
||spoiler||
[link text](https://example.com)
>block quote
```

### MarkdownV2 escaping rules — the one gotcha

**MarkdownV2 is not standard Markdown.** The following characters must be escaped with `\` when they appear in plain text (outside of formatting syntax):

```
_ * [ ] ( ) ~ ` > # + - = | { } . !
```

This matters for: sentences ending in `.`, exclamation marks `!`, list dashes `-`, parentheses `()`, and URLs in plain text. If your message content has many of these, use HTML instead.

**Examples:**
```
Task complete\. Results saved to `output\.json`\!
```

---

## Alternative: HTML

Pass `parse_mode: "HTML"`. Best when your content has lots of punctuation or you need features like expandable blockquotes.

Only three characters must be escaped: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`.

### Supported HTML tags

| Tag | Effect |
|-----|--------|
| `<b>text</b>` | **Bold** |
| `<i>text</i>` | _Italic_ |
| `<u>text</u>` | Underline |
| `<s>text</s>` | Strikethrough |
| `<code>text</code>` | Inline monospace |
| `<pre>text</pre>` | Monospace block |
| `<pre><code class="language-python">...</code></pre>` | Syntax-highlighted code block |
| `<a href="URL">text</a>` | Hyperlink |
| `<tg-spoiler>text</tg-spoiler>` | Hidden spoiler text |
| `<blockquote>text</blockquote>` | Block quote |
| `<blockquote expandable>text</blockquote>` | Collapsible block quote |

---

## Plain text (no parse_mode)

Omit `parse_mode` entirely. No escaping, no formatting rendered. Use for simple status messages.

---

## notify tool

The `notify` tool accepts an optional `parse_mode` parameter. Default is `MarkdownV2`.
To render Markdown in the body:

```json
{
  "title": "Build finished",
  "body": "Deployed *v1\.2\.3* to `production`\.",
  "severity": "success",
  "parse_mode": "MarkdownV2"
}
```

Note: the `title` is always rendered bold by `notify` regardless of `parse_mode`.
