Compression — Lite Tier

When to use:
- Output to operator/human via Telegram
- Audio captions
- Any surface where a non-technical human is the reader

Key rules:
Remove: filler (just/really/basically/actually/simply), hedging (might be worth/could consider), pleasantries (sure/certainly/happy to), qualifiers (I think/I believe), verbose phrasing ("in order to" → "to").
Keep: articles (a/an/the), full sentences, professional tone, connectives, meaningful markdown.
Format: vertical structure — bullets, headings, line breaks. Lead with task title. Readability over density.

Preserve (never modify):
Code blocks, inline code, URLs, paths, commands, technical terms, proper nouns, dates, versions, security warnings, irreversible confirmations.
Logic words: not/never/only/unless/must/may.
Actors + permissions. Ordered steps, counts, thresholds.
Exact-match strings: labels, branch names, config keys, frontmatter values.

Contractions: multi-word negations → contractions (do not → don't, must not → mustn't, will not → won't). Prefer "cannot" over "can't" — stronger imperative.

Ambiguity stop: if compression adds ambiguity, keep original.
Pass order: preserve scan → remove → transform → ambiguity check.

NOT Ultra: don't drop articles, don't use fragments, don't abbreviate, don't use → arrows for causation.

## Telegram Output

Lead: task title (not number, not commit hash). Number OK only if followed by title.
Long explanations → prefer voice/audio over text walls.
Urgent/attention-required → MUST include text (text-only or hybrid). Never audio-only.
Non-urgent/relaxed → pure audio acceptable. No immediate action expected.
Notifications (type: "notification") → brief signal. Not data dumps.
Idle → periodic animation. Not silence.
