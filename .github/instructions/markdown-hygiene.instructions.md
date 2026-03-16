---
applyTo: "**/*.md"
---
# Markdown Hygiene

All `.md` files in this workspace must pass markdownlint with zero errors. The workspace config is `.markdownlint.json` at the repo root (`MD013: false`, `MD029: { style: "ordered" }`).

## Fix Procedure

0. **Stage** — make sure all changes are staged in git so you can easily see the diff of your fixes before committing.
1. **Check** — run `get_errors` on the target file(s) or the full workspace.
2. **Fix** — apply the patterns below for each error code.
3. **Verify** — re-run `get_errors` and confirm zero errors before finishing.

## Fix Patterns by Rule

| Rule | Problem | Fix |
| --- | --- | --- |
| MD022 | Heading not surrounded by blank lines | Add a blank line before and after every `#` heading |
| MD031 | Fenced code block not surrounded by blank lines | Add blank line before ` ``` ` open and after ` ``` ` close — even inside list items |
| MD032 | List not surrounded by blank lines | Add blank line before the first `-`/`1.` and after the last item |
| MD036 | Emphasis used as heading (`**Title**` on its own line) | Convert to a proper `###` heading or fold into prose |
| MD040 | Fenced code block missing language | Add a language tag: ` ```bash `, ` ```toml `, ` ```text ` for plain/unknown content |
| MD060 | Table column separator style | Use ` \| --- \| ` (spaces around dashes), not `\|---\|` or `\|:---:\|` unless alignment is intentional |

## Nested Code Fences

When a code block must contain inner fenced blocks (e.g., a `markdown` example with embedded `bash` blocks), use a **4-backtick outer fence** to avoid premature termination:

````text
````markdown
```bash
echo "inner"
```
````
````