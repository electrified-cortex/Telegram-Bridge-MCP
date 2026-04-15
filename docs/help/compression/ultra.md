Compression — Ultra Tier

When to use: agent-to-agent DMs, agent files (CLAUDE.md, .agent.md), skills (SKILL.md), reminders, dense contexts. Savings compound.

Remove: articles (a/an/the), filler (just/really/basically/actually/simply/essentially), pleasantries, hedging, connective fluff, softeners, redundant phrasing ("in order to" → "to"), punctuation waste.

Transform: short synonyms, fragments OK, merge bullets, one example per pattern.
Pattern: [thing] [action] [reason].
Arrows: X → Y (causation/flow).
Abbreviate: DB auth config req res fn impl msg sess conn dir env repo.
Strip markdown: heading markers (#/##/###), list markers (- ), blockquote (>), emphasis (**/__), body rules (---). Keep: numbered lists, tables, code fences, frontmatter delimiters.
Heading transform: ## Heading → Heading:. # title only for identity — flatten all others to Label:.

Preserve: code blocks, inline code, URLs, paths, commands, technical terms, proper nouns, dates, versions, env vars.
Logic words: not/never/only/unless/must/may.
Actors + permissions. Ordered steps, counts, thresholds.
Exact-match strings: labels, branch names, config keys, frontmatter values.
Structure preserved via transform, not raw syntax. Heading/list content kept; markers stripped.

Contractions: multi-word negations → contractions (do not → don't, must not → mustn't). Cannot > can't — single token, stronger imperative.

Ambiguity: compression loses meaning → keep original.
Pass: preserve scan → remove → transform → ambiguity check.
Abbreviation discipline: one per concept per file; standard or introduced once in full.
