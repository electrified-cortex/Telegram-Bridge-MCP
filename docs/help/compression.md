Compression Cheat Sheet

Tiers:
| Tier | Use when |
| --- | --- |
| None | Full English — audio msgs, spec files |
| Lite | Drop filler/hedging, keep articles — operator text |
| Full | Drop articles, fragments OK — general docs |
| Ultra | Telegraphic, abbreviate, arrows — agent DMs, agent files |

Surface Map:
| Surface | Tier |
| --- | --- |
| Agent-to-agent DMs | Ultra |
| Agent files (CLAUDE.md, .agent.md) | Ultra |
| Skills (SKILL.md), instructions | Ultra |
| Reminder text | Ultra |
| Text to operator (Telegram) | Lite |
| Audio captions | Lite |
| Audio messages | None |
| Spec files, code blocks | None |

Ultra Rules:
Drop: articles (a/an/the), filler (just/really/basically/actually), pleasantries, hedging.
Keep: technical terms exact, code/paths/URLs verbatim.
Pattern: [thing] [action] [reason]. [next step].
Abbreviate: DB auth config req res fn impl msg sess conn dir env repo.
Fragments OK. Arrows: X → Y.

Examples:
Bad: 'Sure! I'd be happy to help with that.'
Good: 'Issue: token expiry, auth middleware.'

Bad: 'The implementation could potentially involve adding a check...'
Good: 'Impl: null-check before fn call.'
