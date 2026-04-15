Compression — Full Tier

When to use:
- General docs, mixed audiences (knowledgeable readers, not pure agent-to-agent)
- Content between operator-facing (Lite) and agent-dense (Ultra)
- Balanced: scannable but not telegraphic

Key rules:
Remove: articles (a/an/the), filler (just/really/basically), hedging, pleasantries, verbose phrasing ("in order to" → "to"), connective fluff, non-structural markdown (bold/italics/emphasis blockquotes).
Transform: short synonyms, merge redundant bullets, fragments only when unambiguous.
Keep: full punctuation where it aids clarity. Structural markdown: headings, lists, tables, code fences, frontmatter.

Preserve (never modify):
Code blocks, inline code, URLs, paths, commands, technical terms, proper nouns, dates, versions, env vars.
Logic words: not/never/only/unless/must/may.
Actors + permissions. Ordered steps, counts, thresholds.
Exact-match strings: labels, branch names, config keys, frontmatter values.

Contractions: multi-word negations → contractions (do not → don't, must not → mustn't, will not → won't). Prefer "cannot" over "can't" — stronger imperative.

Ambiguity stop: compression adds ambiguity → keep original.
Pass order: preserve scan → remove → transform → ambiguity check.

Difference from Lite: drops articles, allows fragments when unambiguous.
Difference from Ultra: no abbreviations, no → arrows, no telegraphic shorthand, keeps punctuation and sentence structure.
