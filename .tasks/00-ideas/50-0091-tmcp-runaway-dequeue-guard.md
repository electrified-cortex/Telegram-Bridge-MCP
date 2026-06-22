# TMCP runaway-dequeue guard (task 10-2001)

Source: handoff/2026-06-01T043158Z.md
Filed: 2026-06-12

Worker-verified implementation exists in a git stash on the electrified-cortex/Telegram-Bridge-MCP
repo. Stash hash: b468ac7ac9c5655cbd8d505bb6e613718813fce1.

Apply with: `git stash apply b468ac7ac9c5655cbd8d505bb6e613718813fce1`

State at handoff: tsc clean, build ok, 106 tests pass. Awaiting operator review and deploy.
The guard prevents the runaway context where recurring dequeues on a large context reprocess
everything each wake and cause token explosion.

Action needed: Worker to review the stash, stage for operator commit, then deploy to local bridge
only (NOT operator bridge without explicit operator go).
