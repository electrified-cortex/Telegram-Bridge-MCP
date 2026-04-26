# 20-715 - Checklist summary formatting refinements

## Context

Operator (2026-04-19) on the current `send(type: "checklist")` summary line:

> "I think we can have better formatting for the checklist summary that occurs. Love the yellow incomplete. That's so good. But as much as I'm happy that we can use em dashes and things like that, humans don't care about em dashes... I think incomplete should be on its own line, right? And then why do you need the em dash at all? And then is it 'six of seven completed' or 'six of seven complete'? Just stick with what's right."

Current rendered checklist summary uses an em-dash separator and inline placement that mashes counts and incomplete status together. Operator wants:

- "Incomplete" indicator (existing yellow status icon) on its own line.
- No em-dash in the summary.
- Decide between "6 of 7 completed" vs "6 of 7 complete" — pick one and stick with it.

## Acceptance Criteria

1. **Locate** the checklist summary render code in TMCP (likely `src/services/checklist*` or wherever `send(type: "checklist")` formats the rendered message).
2. **Remove em-dash** from the summary line. Use plain newlines as separators.
3. **Place "incomplete" indicator on its own line.** The yellow visual stays; only the placement changes.
4. **Standardize phrasing — final form per operator 2026-04-19 (after four refinement passes):**
   - **Header** is the existing colored status word — three real states per current code:
     - green check + "Complete"
     - yellow circle + "Incomplete"
     - red X + "Failed" (or whatever the existing failed-state header word is — verify against the renderer)
   - **Header alone is the baseline.** When all steps are done, the header carries the entire signal — no summary line.
   - **Summary line (only when there's something exceptional to draw attention to):** counts of the EXCEPTIONAL states — skipped and/or failed. NOT the success count. The point is to surface what didn't go to plan, not to restate progress the header already conveys.
     - Format: terse adjective form (no trailing -d). `1 skipped`, `2 failed`, `1 skipped, 2 failed` if both apply.
     - Omit entirely if nothing exceptional happened.
   - **Do NOT** include framing copy like "tap to see breakdown" — the reply-thread affordance is implicit; explaining it is noise.
   - **Do NOT** include the success count (`6 complete`) — that's the boring case. The header already says "Incomplete" or "Complete"; the summary's job is to highlight the exception, not to count progress.
5. **Verify against a real checklist** before merging — render a 7-item checklist with 6 done, 1 incomplete, and confirm the new layout.

## Constraints

- Don't touch the per-step rendering (status icons + label) — only the summary footer.
- **Preserve `reply_to` threading on the completion summary.** That's what makes the summary tap-to-jump to the original checklist message; Telegram's reply mechanic provides the indexability. Removing it would break the affordance the whole minimal-summary design depends on.
- Preserve the existing status enum values (`pending`, `running`, `done`, `failed`, `skipped`).
- Em-dashes elsewhere in TMCP output are not in scope for this task; just the checklist summary.

## Open Questions

- Confirm exact existing failed-state header word/icon when reading the renderer (operator referenced "red failed or something like that" — verify the actual string).
- The "exceptional counts" rule treats `skipped` and `failed` as exceptions worth highlighting. Is `pending`/`running` ever surfaced post-completion? (Probably not — those are mid-flight states.)

## Delegation

Worker (TMCP). Curator stages, operator merges.

## Priority

20 - UX polish. No functional bug.

## Related

- Memory `feedback_avoid_arrow_chars.md` (related anti-decoration philosophy).
- `15-713`/`15-714` (broader behavior shaping series).

## Activity Log

- 2026-04-24: Worker 3 claimed task, dispatched impl subagent.
- 2026-04-24: Impl subagent rewrote `completionBadge()` in `send_new_checklist.ts` — exceptional-counts-only format, no em-dash, newline separator. Added 5 format tests. Removed duplicate import in `server.ts`.
- 2026-04-24: Code Reviewer — 0 majors, 1 minor (non-blocking), 1 nit (pre-existing silent catch). Skipped-before-failed order is per spec.
- 2026-04-24: Committed as `67751ad` on branch `20-715`.

## Completion

- Branch: `20-715`
- Commit: `67751ad`
- Subagents: Impl ×1, Code Reviewer ×1
- Review verdict: 0 majors, 1 minor (non-blocking), 1 nit
- Ready for Overseer merge.
