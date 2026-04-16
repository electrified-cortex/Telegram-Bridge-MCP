---
Created: 2026-04-16
Status: Queued
Target: telegram-mcp-bridge
Priority: High
---

# 10-583 — Update README and Changelog for v6.1

## Goal

README and changelog must accurately reflect v6.1 features.
Less is more — tight, descriptive, accurate. No bloat.

## README

- Update feature list to reflect v6.1 capabilities
- Reaction system (presets, default temporality, base reaction)
- Guided behavior protocol (service messages replacing tutorials)
- Transport reliability (SSE keepalive, POST keepalive)
- Keep it concise — trim where possible

## Changelog

- changelog/unreleased.md already updated to v6.1.0 header
- Ensure all significant changes are listed under correct
  categories (Added, Fixed, Changed, Removed)
- Tutorial/instruction removal goes under Removed
- Service messages under Added
- Reaction presets under Added
- Transport fixes under Fixed

## Acceptance Criteria

- [ ] README accurately describes v6.1 without bloat
- [ ] Changelog lists all significant changes
- [ ] No marketing language — just facts
