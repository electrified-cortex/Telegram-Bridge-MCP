# PR Health Check

**Frequency:** Every 30 min | **Scope:** Governor only

## Procedure

1. List all open PRs: `list_pull_requests` or `search_pull_requests`.
2. For each open PR:
   - Check for new comments since last check.
   - Check CI/status check results.
   - Note if PRs were opened by Dependabot or external contributors.
3. For **new PRs** (not seen before):
   - Notify operator with a brief summary.
   - If it's a Dependabot PR, review the dependency update and assess risk.
   - Create a task if action is needed.
4. For **new comments** on existing PRs:
   - Read the comment, determine if it needs a response.
   - Create a task if action is needed.
5. Track what you've seen to avoid duplicate notifications.
