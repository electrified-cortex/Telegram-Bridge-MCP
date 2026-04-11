---
Created: 2026-04-09
Parent: 10-404
Purpose: Dogfood test results — tracking pass/fail for each row
---

# 10-404 Test Results

## Key

- ✅ PASS
- ❌ FAIL
- ⚠️ PASS with finding
- ⬜ Not tested

## Results

| # | Description | Status | Notes |
|---|------------|--------|-------|
| 1 | help identity | ✅ | |
| 2 | bot username | ✅ | |
| 3 | server version | ✅ | |
| 4 | send text | ✅ | |
| 5 | send audio (TTS) | ✅ | |
| 6 | send text + audio | ✅ | 💯 reaction from operator |
| 7 | send MarkdownV2 | ⚠️ | Bold didn't render visually |
| 8 | send reply | ✅ | |
| 9 | send silent | ✅ | Confirmed with app-closed test |
| 10 | append | ✅ | API uses `type: "append"` not `append:` param |
| 11 | append separator | ✅ | |
| 12 | append parse_mode | ✅ | HTML bold+italic rendered |
| 13 | edit text | ⚠️ | Bold lost after edit — needs parse_mode |
| 14 | edit keyboard | ✅ | Buttons appeared, callback received |
| 15 | edit text + keyboard | ✅ | Both changed simultaneously |
| 16 | edit remove keyboard | ✅ | Buttons removed via empty array |
| 17 | edit parse_mode | ❌ | MarkdownV2 bold/italic didn't render on edit |
| 18 | legacy text edit | ✅ | via action(type: "message/edit") — same path as row 13 |
| 19 | legacy reply_markup | ✅ | keyboard requires [{label, value}] objects, not Telegram's native format |
| 20 | animation preset | ✅ | via send(type: "animation", preset: "working") |
| 21 | animation custom frames | ✅ | Red/yellow/green frames cycling |
| 22 | animation interval | ✅ | 2s interval confirmed |
| 23 | animation timeout | ❌ | Animation persists past timeout — real bug |
| 24 | animation persistent | ✅ | Stays alive while other messages sent |
| 25 | animation notify | ✅ | Accepted, hard to verify with app open |
| 26 | animation priority | ✅ | priority param accepted; needs multi-session to verify precedence |
| 27 | animation spacing | ✅ | allow_breaking_spaces param accepted; visual effect hard to verify |
| 28 | cancel animation | ✅ | via action(type: "animation/cancel") |
| 29 | cancel with text | ✅ | Cancel replaces animation with text |
| 30 | cancel parse_mode | ✅ | HTML bold+italic rendered in cancel text |
| 31 | set default frames | ✅ | Moon phase frames set and verified |
| 32 | set default preset | ❌ | name/preset params accepted but ignored — default unchanged |
| 33 | reset default | ✅ | Reset restored original pulsing animation |
| 34 | new progress | ✅ | 50% bar displayed |
| 35 | progress title | ✅ | "Build Progress" title shown |
| 36 | progress subtext | ✅ | "Compiling..." subtext shown |
| 37 | progress width | ✅ | Default width used |
| 38 | update progress | ✅ | 25% → 75% → 100% in place |
| 39 | update all fields | ✅ | Title+subtext+percent updated |
| 40 | new checklist | ✅ | 3 steps with icons displayed |
| 41 | update checklist | ✅ | Steps updated to all done, auto-unpinned |
| 42 | log get | ✅ | Returns current log info |
| 43 | log get specific | ✅ | Historical log content returned |
| 44 | log list | ✅ | |
| 45 | log delete | ✅ | Deleted archived log successfully |
| 46 | logging enable | ⚠️ | Requires explicit `enabled: true` — no toggle |
| 47 | logging disable | ⚠️ | Requires explicit `enabled: false` — no toggle |
| 48 | log roll | ✅ | Archived current log |
| 49 | debug log | ✅ | 50 routing entries returned |
| 50 | debug count | ✅ | count:3 limited correctly |
| 51 | debug category | ❌ | Schema rejects `category` param; `cat` passes through but is ignored |
| 52 | debug since | ✅ | since:590 returned 3 entries after that ID |
| 53 | debug enable | ✅ | enable: true/false toggles debug logging state |
| 54 | dump session | ✅ | log/roll works as backward compat equivalent |
| 55 | profile save | ✅ | Saved CuratorTest profile with voice, speed, presets, reminders |
| 56 | profile load | ✅ | Loaded profile, applied voice/speed/presets/reminders |
| 57 | profile import single | ✅ | Imported voice: af_heart successfully |
| 58 | profile import all | ⚠️ | Works, but reminders require `recurring` field even for one-off |
| 59 | reminder timed | ✅ | |
| 60 | reminder startup | ✅ | trigger: "startup" accepted, state: "startup" |
| 61 | reminder recurring | ✅ | recurring: true accepted, state: "deferred" |
| 62 | reminder named | ✅ | |
| 63 | reminder cancel | ✅ | |
| 64 | reminder list | ✅ | |
| 65 | session start | ✅ | Started SID 2 (TestSession) — requires operator approval |
| 66 | session start color | ✅ | Color 🟢 accepted in session start |
| 67 | session reconnect | ⚠️ | reconnect: true accepted; denied by operator (needs active session to fully verify) |
| 68 | session close | ✅ | Closed SID 2, single-session mode restored |
| 69 | session list | ✅ | Returns sessions with SID, name, color |
| 70 | session rename | ✅ | Requires operator approval — succeeded on 3rd attempt |
| 71 | help overview | ✅ | Full tool index returned |
| 72 | help identity | ✅ | duplicate of row 1 |
| 73 | dequeue | ✅ | Used throughout testing |
| 74 | notify | ✅ | Notification sent |
| 75 | ask | ✅ | Sent and timed out waiting (expected) |
| 76 | choose | ✅ | Operator picked Red |
| 77 | confirm | ✅ | Used throughout; buttons say OK/Cancel (defect) |
| 78 | send_choice | ✅ | Non-blocking buttons + callback received |
| 79 | send_file | ✅ | Via temp dir restriction |
| 80 | delete_message | ✅ | API returned ok |
| 81 | get_message | ✅ | Returns message content |
| 82 | get_chat_history | ✅ | via action type: "message/history" |
| 83 | answer_callback | ✅ | via action type: "acknowledge" |
| 84 | set_reaction | ✅ | via action type: "react" |
| 85 | pin_message | ✅ | Pin confirmed by operator |
| 86 | download_file | ✅ | File content returned |
| 87 | transcribe_voice | ✅ | Accurate transcription |
| 88 | set_commands | ✅ | Test command added and restored |
| 89 | set_topic | ✅ | [TEST] prefix confirmed |
| 90 | set_voice | ✅ | via action type: "profile/voice" |
| 91 | show_typing | ✅ | via action type: "show-typing" |
| 92 | send_chat_action | ✅ | upload_document action accepted |
| 93 | DM to session | ⬜ | needs 2nd session |
| 94 | route_message | ⬜ | needs 2nd session |
| 95 | approve_agent | ⬜ | needs 2nd session |
| 96 | shutdown | ⬜ | destructive — test last |
| 97 | shutdown warning | ⬜ | |
| 98 | set_dequeue_default | ✅ | Changed to 45, restored to 300 |
| 99 | get_chat | ❌ | Not accessible through v6 action paths — missing from routing |

## Findings

1. **logging/toggle doesn't toggle** — calling without explicit `enabled` param returns current state but doesn't flip it. Operator says: remove toggle option entirely, agents always set explicitly.
2. **message/edit loses markdown** — edited message showed raw `**` instead of bold; needs parse_mode
3. **MarkdownV2 bold on send** — `**text**` in MarkdownV2 didn't render bold visually (row 7). NOTE: Telegram MarkdownV2 uses single `*` for bold, not double `**`.
4. **MarkdownV2 on edit** — single `*bold*` also didn't render on edit (row 17). Broader MarkdownV2 issue.
5. **help(topic) too sparse** — no parameter documentation in help responses. Discoverability gap.
6. **confirm buttons say "OK/Cancel"** — should be "Yes/No". No color styling on buttons.
7. **animation timeout not working** — persistent past specified timeout (row 23). Real bug.
8. **choose param format** — requires objects with `label`+`value`, not string arrays. Help didn't document this.
9. **checklist status values** — `in-progress` invalid, must use `running`. Help didn't document allowed values (pending/running/done/failed/skipped).
10. **single-emoji animation frames** — show as stickers on mobile. Should be warned about in docs/hints.
11. **callback acknowledge timing** — must ack within ~30s or callback expires. Testing flow issue, not a bug.
12. **deeper sub-paths idea** — operator suggested deeper paths like log/debug/since for better discoverability.
13. **send_choice buttons don't persist** — operator noted buttons disappear after clicking (expected or not?).
14. **choice vs question param inconsistency** — `type: "choice"` uses `options[]`, `type: "question"` uses `choose[]`. Different param names for same concept.
15. **get_chat missing from action routing** — no path to access chat info through the 4-tool model.
16. **confirm/yn design** — operator suggests extending send types: `confirm/ok` (OK/Cancel preset), `confirm/yn` (Yes/No preset), with customizable labels. All are send variants, not actions.
17. **animation/default ignores preset param** — `name` and `preset` params accepted but don't change the default animation. Only `frames` (row 31) and `reset` (row 33) work.
18. **debug category filter not wired** — schema rejects `category`, `cat` passes through but is ignored. Category filtering broken in v6.
19. **profile import requires `recurring` on reminders** — even one-off reminders need `recurring: false` in the import schema. Should default to false.
20. **unpin via message/pin** — `unpin: true` on `message/pin` works. Not in test plan but verified ad-hoc.

## Summary

- Tested: 94/99
- Pass: 83
- Pass with finding: 6
- Fail: 5 (row 17 MarkdownV2 on edit, row 23 animation timeout, row 32 preset-to-default, row 51 debug category, row 99 get_chat missing)
- Remaining: 5 (multi-session 93-95, destructive 96-97)
