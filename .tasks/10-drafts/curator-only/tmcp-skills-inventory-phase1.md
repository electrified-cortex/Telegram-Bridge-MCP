# TMCP Skills — Phase 1 Inventory
Generated: 2026-06-21

## sub-session-dispatch
Verdict: REWRITE
Structure: spec.md ✗, uncompressed.md ✗, SKILL.md ✓

Notes:

**Methodology violations:**
- Missing spec.md (acceptance criteria, "what" definition) and uncompressed.md (readable form). Fails the electrified-cortex skill structure requirement on both counts.

**Help overlap:**
- `help('sub-session')` already covers: spawn-child call + return shape, sub-agent bootstrap via onboarding service messages (automatic on first dequeue — not hand-wired), child/forward, child self-revoke vs parent-revoke, silence/crash detection threshold, prohibition list, and the origin discriminator table.
- The SKILL.md largely restates this content, adding the dispatch-wrapping step and the structured report schema on top.

**Specific concerns:**

1. The worked example in SKILL.md omits the onboarding service messages (`onboarding_child_role`, `onboarding_child_loop`, `onboarding_child_exit_protocol`) that the bridge auto-injects on first child dequeue. This is a factual gap relative to `help('sub-session')` — the skill could mislead an agent into hand-coding bootstrap behavior the bridge already handles.

2. The exit protocol in the SKILL.md describes parent-initiated revoke as the primary path (`session/revoke-child` after report arrival). `help('sub-session')` establishes self-revoke (sub-agent sends `EXIT_STATUS:` then calls `session/revoke-child` on its own token) as the *preferred* path, with parent-revoke reserved for hung agents. SKILL.md inverts this priority.

3. The report delivery mechanism (JSON file to parent inbox path) is workspace-specific. The skill encodes `tasks/00-ideas/` and `tasks/10-drafts/` as the only permitted write paths and uses an inbox file-drop pattern — these are curator-pod conventions, not TMCP primitives. A skill should describe mechanism; workspace paths belong in a pod profile or operator-facing note.

4. References `dispatch` skill for sub-agent spawning but does not clarify whether `dispatch` is a TMCP skill or a separate task-engine skill. Unresolved dependency.

5. The `child_capability` parameter name in the SKILL.md input schema (`child_capability`) matches the bridge action, but the help doc uses `child_capability` consistently — no conflict, but the SKILL.md default value (`'gather'`) differs from `help('sub-session')` which says `gather` is the default without stating a different action-level default. Minor — confirm parity with bridge source.

**Phase 2 work required:**
- Add spec.md with acceptance criteria (what does "done" look like, failure mode coverage, scope boundary vs help overlap).
- Add uncompressed.md with narrative walkthrough.
- Reconcile self-revoke vs parent-revoke priority with `help('sub-session')`.
- Strip or annotate workspace-specific paths (move to a workspace profile section or operator note).
- Correct the worked example to acknowledge bridge-injected onboarding messages.
- Clarify the `dispatch` dependency.

---

## telegram-participation
Verdict: REWRITE
Structure: spec.md ✓, uncompressed.md ✓, SKILL.md ✓

Notes:

**Methodology violations:**
- Structure is complete (all three files present). No structural violation.
- However, the SKILL.md contains substantial content that either duplicates or diverges from the help system, raising correctness risk.

**Help overlap:**
- R1 (connection check), R2 (session anchor), R3 (startup drain), R4 (post-connect setup) partially overlap `help('startup')` and `help('session/start')` / `help('session/reconnect')`.
- R5 (activity monitor arm) and R7 (dequeue loop) overlap `help('startup')` and `help('guide')` (dequeue loop pattern, SSE vs file-watch, Monitor arm instructions).
- R8 (closeout) overlaps `help('guide')` shutdown service event and session/close semantics.
- The breadcrumbs section at the bottom (`help('startup')`, `help('compacted')`, `help('guide')`, `help('index')`) acknowledges this but does not resolve the duplication risk.

**Specific concerns:**

1. **SSE host-rewrite rule is workspace-specific.** R5 encodes a container vs host pod dichotomy ("if your pod root is under `/opt/stacks/`, use `bridge`; if under a user home dir, use `127.0.0.1`"). This is a cortex.lan infrastructure detail, not a general TMCP behavior. Violates the "no workspace-specific workflow assumptions" criterion.

2. **R4 animation send is a best-practice recommendation, not a protocol requirement.** The `send(type: 'animation', preset: 'working', timeout: 60)` step is a UX pattern (signal presence during boot) that belongs in a pod persona profile or guide, not a compressed protocol skill. It will not apply to all TMCP-enabled agents.

3. **R5 SSE verification step (POST /activity/selftest)** and the "SSE health ongoing" note (detecting keepalive-only streams vs real data) are detailed enough that they duplicate and in some cases extend `help('activity/listen')`. If the help doc is updated, the skill becomes stale.

4. **R7 "after any outbound send" rule** ("call dequeue() again immediately — do not idle or wait for SSE") partially overlaps `help('guide')` dequeue loop pattern. The phrasing differs slightly (skill says `timed_out: true` is the "only stop signal"; guide says the same but also explains `pending = 0` behavior). Low risk but drift-prone.

5. **R2 token probe** uses `action(type: 'reminder/list', token: <token>)` to test session liveness. `help('session/start')` and `help('session/reconnect')` do not explicitly endorse this pattern. It works, but it encodes an implementation assumption (reminder/list as a liveness probe) that could break if the action's error surface changes.

6. **R8 closeout step 3** ("capture stored token, then clear it from state") encodes in-memory state management that is agent-implementation-specific, not a TMCP protocol step. This is fine in a pod-specific skill but violates the general-agent portability claim the skill's description implies ("Bootstrap any TMCP-enabled agent").

**Phase 2 work required:**
- Audit spec.md and uncompressed.md for consistency with current SKILL.md (check if R5 SSE-only change from 2026-06-14 is reflected in all three files).
- Extract workspace-specific elements (host-rewrite rule, animation boot step) into a pod persona profile section or operator note, or gate them behind a "cortex.lan pod" variant.
- Narrow the skill description: if it encodes cortex.lan conventions, it is not a general TMCP bootstrap — rename or scope accordingly.
- Reduce duplication with help system: skills should reference help topics for protocol details rather than re-specifying them (drift risk).
- Confirm whether the `reminder/list` liveness probe is an endorsed pattern or incidental; document or replace with an explicit probe action if one exists.

---

## Summary

Both skills are structurally incomplete (sub-session-dispatch) or contain portability violations and help-system drift risk (telegram-participation). Neither is ready to ship as a general-purpose TMCP bundled skill without revision.

**Phase 2 priorities:**

1. **sub-session-dispatch** — higher urgency. Missing two of three required files. The SKILL.md itself has a factual error (exit protocol priority inversion vs help doc) and workspace-specific path encoding. Needs spec.md authored from scratch, uncompressed.md drafted, and SKILL.md corrected.

2. **telegram-participation** — medium urgency. All three files exist, but the skill encodes cortex.lan infrastructure assumptions and has duplicated-but-diverging protocol details relative to the help system. The 2026-06-14 SSE-only change (stop double-arming) should be audited across all three files for consistency before Phase 2 edits begin. The core question for Phase 2: is this skill meant to be general-purpose (any TMCP agent) or curator-pod-specific? That decision drives how much of R4 and R5 stays vs. moves.

**No changes were made to any skill files in this phase.**
