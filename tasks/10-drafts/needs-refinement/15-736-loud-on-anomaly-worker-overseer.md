# 15-736 - Loud-on-anomaly for Worker/Overseer loops

## Context

Observed 2026-04-19: hours of friction on the complete.ps1 hash incident were hidden behind quiet retries. Workers and Overseer kept looping through failures - "Script integrity check failed" - without any of them escalating to the operator that the fleet was stuck on the same error class repeatedly.

Silent retry is the wrong default for *anomalous* failures (repeated hook denials, repeated claim collisions, repeated git push rejections). The fleet should be *loud* the first time something unexpected happens, not log-and-continue.

## Acceptance Criteria

1. Define an "anomaly" classification in the worker/overseer loop: errors that are NOT part of normal flow (hook denial, unexpected non-zero exit from pipeline scripts, git push rejection not caused by fast-forward, unexpected dequeue shape, etc.).
2. On the first occurrence of an anomaly within a session, surface a service message or DM to Curator (NOT the operator directly - Curator decides whether to escalate).
3. On the second occurrence of the *same* anomaly category within a short window, surface directly to the operator.
4. Normal-flow errors (empty queue, already-claimed task, merge conflict during claim retry) stay quiet - this is not about silencing *those*.
5. Regression test: simulate a repeated hook denial, assert escalation fires on the 2nd occurrence within the window.

## Constraints

- Do not spam. Rate-limit. One escalation per anomaly category per session window (default 10 minutes).
- Do not wake the operator for recoverable conditions. Recoverable goes to Curator; persistent/unrecoverable goes to operator.
- The anomaly classifier must be extensible - list of categories in a data file, not inline if/else.

## Priority

15 - observability bug. Root cause of the 2026-04-19 friction spiral being so long.

## Delegation

Worker (TMCP). Curator should spec the anomaly taxonomy before claim.

## Related

- Memory `feedback_dont_add_scripts_where_plain_ops_work.md` (the incident this would have caught earlier).
- 20-735 (adaptive scan; shares the worker loop surface).
- 15-734 (hook error disambiguation; the classifier can key off the new error codes).
