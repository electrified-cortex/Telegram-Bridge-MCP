# PR Review Exhaustion Loop

**Frequency:** Every 10 min | **Scope:** Governor only

## Procedure

1. List all open PRs for the repo.
2. For each PR with pending review comments (from Copilot or human reviewers):
   - Read each unresolved comment.
   - Understand the concern and assess validity.
   - If the fix is trivial, apply it directly and reply with what was changed.
   - If the fix needs discussion, flag it to the operator.
   - Resolve the comment thread after addressing it.
3. Continue until all review comments are exhausted.
4. If no comments found, no action needed — stay silent.

## Reference

See `/memories/repo/pr-review-process.md` for detailed process notes.
