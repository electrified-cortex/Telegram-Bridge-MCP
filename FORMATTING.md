# Telegram Message Formatting Guide

## Recommended: HTML mode

Pass `parse_mode: "HTML"` to `send_message`, `notify`, `ask`, `choose`, or `update_status`.
HTML is safe and predictable — only a small set of tags are supported and no special escaping is needed for regular text.

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

### HTML escaping rules

Only three characters must be escaped inside message text:

| Character | Escape as |
|-----------|-----------|
| `&` | `&amp;` |
| `<` | `&lt;` |
| `>` | `&gt;` |

Everything else (punctuation, emoji, unicode) can be used as-is.

### HTML example

```
<b>Task complete</b>

Result saved to <code>output.json</code>.

<pre><code class="language-json">{
  "status": "ok",
  "count": 42
}</code></pre>

<a href="https://example.com">View report</a>
```

---

## Alternative: MarkdownV2

Pass `parse_mode: "MarkdownV2"` — but be aware of aggressive escaping requirements.

### MarkdownV2 escaping rules

The following characters **must** be escaped with a backslash `\` anywhere they appear in the text (even outside formatting):

```
_ * [ ] ( ) ~ ` > # + - = | { } . !
```

Failure to escape any of these causes the entire message to be rejected by Telegram.

### MarkdownV2 example

```
*Bold text*
_Italic text_
`inline code`
\-\- dashes must be escaped \-\-
```

**Recommendation:** Avoid MarkdownV2 unless the input is fully controlled. Prefer HTML.

---

## Plain text (no parse_mode)

Omit `parse_mode` entirely to send plain text. No escaping needed, no formatting rendered.
Use this for simple status messages or when the content may contain characters that conflict with markup.

---

## Notify tool formatting

The `notify` tool accepts an optional `parse_mode` parameter. By default it sends plain text.
To use HTML formatting in the body:

```json
{
  "title": "Build finished",
  "body": "Deployed <code>v1.2.3</code> to <b>production</b>.",
  "severity": "success",
  "parse_mode": "HTML"
}
```

Note: the `title` is always rendered as bold plain text by `notify` regardless of `parse_mode`.
