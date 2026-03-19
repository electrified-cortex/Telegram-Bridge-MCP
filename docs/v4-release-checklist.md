# v4.0.0 Release Checklist

## Blocking — Must Pass

- [x] All automated tests pass (1474+, lint clean, build clean)
- [ ] Manual acceptance test — all 6 phases of `docs/multi-session-test-script.md`
  - [x] Phase 1: Session lifecycle (join, approve, list, auto-DM grant)
  - [x] Phase 2: Targeted routing (reply-to, callbacks, reactions)
  - [ ] Phase 3: Governor routing (3.2-3.3 done; 3.4 death recovery, 3.5 continuity untested)
  - [ ] Phase 4: DM permissions (4.1 done; 4.2 bidirectional, 4.3 revoke on close, 4.4 manual request)
  - [ ] Phase 5: Three sessions (3-way routing, cross-session DMs)
  - [ ] Phase 6: Edge cases (rapid messages, voice, session close mid-conversation)
- [x] Outbound broadcast simplified to governor-only (task 100)
- [x] Session color tags implemented (on by default)
- [ ] PIN uniqueness enforced (no collision across live sessions)
- [ ] No open high-priority bugs
- [ ] Changelog finalized for v4.0.0
- [ ] README updated with multi-session documentation
- [ ] PR #40 reviewed and approved
- [ ] Copilot code review passed — no critical findings

## Nice-to-Have — Won't Block

- [ ] Color tags manually tested (on by default)
- [ ] Rate limit tracking (429 handling) — nice-to-have, not blocking release
- [ ] `close_session` tested from owning session (client-side issue, not server)
- [ ] Performance testing with 3+ sessions
- [ ] Stress test: rapid session join/leave cycles
