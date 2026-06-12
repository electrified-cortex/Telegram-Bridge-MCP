# Task 015 — Official Release (v4.1.0+)

**Type:** Release
**Priority:** 30 (medium — when stable)

## Description

Create an official tagged release. The last release was v3.0.0 (2026-03-14). We need to:

1. Determine the correct version number (v4.1.0 based on current `package.json`, or higher if more changes land first)
2. Move `changelog/unreleased.md` content into a dated release file (e.g., `changelog/2026-MM-DD_vX.Y.Z.md`)
3. Reset `changelog/unreleased.md` to empty template
4. Update `package.json` version if needed
5. Tag the release on `master`
6. Create a GitHub Release with changelog content

## When

When the operator feels we've reached a stable point. This is backlog — not urgent.

## Notes

- Do NOT release from `v4-multi-session` — release from `master` after all desired changes are merged.
- Coordinate with overseer for timing.
