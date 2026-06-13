# 034 · Voice Exchange Verification

**Priority:** 05 (high — operator wants this next)
**Type:** Manual verification

## Objective

Conduct a live voice message exchange with the operator to verify that:
1. Voice replies from the operator correctly route to and are received by the worker session
2. The worker can read chat history and see the voice messages
3. Round-trip voice communication works end-to-end

## Steps

1. Send a voice message to the operator announcing the test
2. Wait for the operator to reply (voice or text)
3. Confirm receipt — report what was received (message type, content, routing)
4. Read chat history (`get_chat_history`) and verify the exchange is visible
5. Report results: what worked, what didn't, any routing anomalies

## Success Criteria

- Worker receives operator's reply messages (especially voice replies)
- Chat history shows the full exchange
- No routing gaps or missing messages

## Notes

- This is a live manual test, not a code change
- Report findings in `## Completion` — include message IDs, routing info, and any issues observed
- If voice replies are NOT received, document: message IDs, timestamps, routing field values

## Completion

**Result: All voice routing verified — 3 rounds, all targeted correctly.**

| Round | Msg ID | Type | reply_to | routing |
|-------|--------|------|----------|---------|
| Worker sent voice | 11522 | voice | — | sid:2 |
| Op reply voice | 11523 | voice | 11522 | targeted ✓ |
| Worker text reply | 11524 | text | — | sid:2 |
| Op reply voice | 11525 | voice | 11524 | targeted ✓ |

Chat history (`get_chat_history`) confirmed all 4 messages visible and accurate.

**Additional finding:** Operator reported earlier incident where a sleeping session didn't respond promptly to voice. Diagnosed as dequeue-timeout gap (not a routing bug): when a session is in a long dequeue timeout (300s), transcribed voice messages wait until the next cycle. Workaround: use shorter dequeue timeouts (30s) during active work. Flagged to overseer.
