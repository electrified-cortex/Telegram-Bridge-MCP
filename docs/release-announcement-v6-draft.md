---
Created: 2026-04-11
Status: Draft
Purpose: Release announcement for Telegram Bridge MCP v6.0.0
---

# v6.0.0 Release Announcement (Draft)

> Target: Telegram message to accompany repo link at release time.

---

Hey everyone! 🎉

Telegram Bridge MCP just hit v6 — and this one's a big deal.

What used to be 40+ separate tools is now just 4: send, dequeue, action, and help. Everything routes through a clean dispatcher pattern, so agents spend fewer tokens on tool definitions and more on actual work.

New features:
• 4-tool API — consolidated from 40+ tools into send, dequeue, action, help
• Action dispatcher — all operations route through action(type: "...") with "did you mean?" suggestions for unrecognized types
• Governor approval delegation — toggle agent-managed session approvals on/off
• Pre-tool hooks — deny patterns for fine-grained tool access control
• Preset confirmations — ok, ok/cancel, yes/no dialogs without boilerplate
• Help discovery — self-documenting API with per-tool docs and guides
• Error guidance — every error response includes actionable hints and suggestions

Improvements:
• Token-efficient design — minimal tool descriptions + caveman compression in every response. Agents spend less context learning the API and more on actual work
• Unified send — text, voice, notifications, checklists, progress bars — all through one tool
• Logging & debug tools — session logs, debug categories, roll & archive
• 2,201 tests covering the full surface

This was a week of intense work — 320 commits, 17.7K lines added, 259 files touched. Nearly 40% of the project's entire lifetime effort in 7 days.

Check it out: [repo link]

---

## Notes

- Tone: friendly, human, casual but proud
- Length: short enough for a Telegram message, long enough to convey scope
- Stats sourced from git analysis on 2026-04-11 (v5.0.1..master, verified post-merge)
- Operator requested "small friendly human sounding message about all the effort and features"
