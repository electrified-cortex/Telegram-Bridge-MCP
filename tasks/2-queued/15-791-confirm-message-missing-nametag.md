# 15-791 - Confirm-mode message missing nametag

## Context

On 2026-04-20 ~21:35 operator observed that a `send(type:"question", confirm:"...")` message (message_id 39951) rendered in Telegram **without the sender nametag** that normally prefixes agent-authored content. The call was also flagged `skipped:true` in the response payload (the caption + audio + buttons were still delivered, but the nametag prefix was absent).

Regular text and voice messages from the same agent session *do* get nametagged. The bug appears specific to the confirm/question rendering path.

## Acceptance Criteria

1. Reproduce: `send(type:"question", confirm:"...", audio:"...", text:"...")` from an authenticated non-governor session — the rendered Telegram message should show the agent nametag prefix identical to a plain `send(text:"...")` from the same session.
2. Fix so that confirm / choose / ask renderings receive the same nametag prefix as other send modes.
3. Verify `skipped:true` behavior is still correct (or fix if it was a symptom of the same bug).
4. Regression test covers the nametag path for all interactive types (question/confirm/choose/ask).

## Evidence

- Telegram message_id `39951` sent from Curator session (SID 1). Operator reply (39954): "This message had no nametag."
- Send payload: `type:"question"`, `confirm:"Open PR v7-0-2 into master and run task finalization on 00-773?"`, caption + audio present.
- Response: `{ skipped: true, text_response: "NO.\nPush and create a PR", text_message_id: 39952, message_id: 39951 }` — note `skipped:true` even though the message rendered.

## Don'ts

- Do not remove the nametag from any other mode "for consistency" — the other modes are correct; interactive modes are the outlier.
- Do not change the question/confirm UX behavior (buttons, skipping on pending content, etc.) while fixing the nametag.

## Priority

15 — operator-facing visual bug, affects trust in message attribution, but not a data-integrity issue.

## Delegation

Worker (TMCP).
