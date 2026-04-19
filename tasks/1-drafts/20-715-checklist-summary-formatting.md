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
4. **Standardize phrasing — final form per operator 2026-04-19:**
   - **Header** is the existing yellow "Incomplete" / green "Complete" status line. No change.
   - **Summary line** (one line, below header): just the done count, in the terse adjective form: `6 complete` (not "6 completed", not "6 of 7"). Drop the trailing -d, drop the fraction.
   - **Do NOT** add `1 incomplete` / `1 skipped` lines -- the header already carries the incomplete-state signal in color, and tapping the summary jumps to the full breakdown. Counts beyond the done count are noise.
   - When everything is done, the header shifts to "Complete" and the summary line is redundant -- omit it.
5. **Verify against a real checklist** before merging — render a 7-item checklist with 6 done, 1 incomplete, and confirm the new layout.

## Constraints

- Don't touch the per-step rendering (status icons + label) — only the summary footer.
- **Preserve `reply_to` threading on the completion summary.** That's what makes the summary tap-to-jump to the original checklist message; Telegram's reply mechanic provides the indexability. Removing it would break the affordance the whole minimal-summary design depends on.
- Preserve the existing status enum values (`pending`, `running`, `done`, `failed`, `skipped`).
- Em-dashes elsewhere in TMCP output are not in scope for this task; just the checklist summary.

## Open Questions

- Is the summary count `done / total` or `done / (total - skipped)`? Verify which the user expects before changing the math.
- Should "incomplete" line list the count of incomplete items, or just the status indicator? (Operator implied just the indicator on its own line.)

## Delegation

Worker (TMCP). Curator stages, operator merges.

## Priority

20 - UX polish. No functional bug.

## Related

- Memory `feedback_avoid_arrow_chars.md` (related anti-decoration philosophy).
- `15-713`/`15-714` (broader behavior shaping series).
