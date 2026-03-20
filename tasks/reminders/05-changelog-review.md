# Changelog Review

**Frequency:** Every 60 min | **Scope:** Governor only

## Procedure

1. Read `changelog/unreleased.md`.
2. Check recent commits since last review: `git log --oneline -10`.
3. For each commit that changes behavior, verify it has a corresponding changelog entry.
4. Flag missing entries — add them or create a task.
5. Verify entries use correct format:
   - [Keep a Changelog](https://keepachangelog.com) format.
   - Categories: Added, Changed, Fixed, Removed, Security, Deprecated.
   - Past tense, one line per change.
