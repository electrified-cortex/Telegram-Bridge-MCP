# 00-773 - Voice Transcription Logging (P0)

## Required behavior

A voice message arriving in the bridge MUST produce two separate entries in the NDJSON dump log, in this order:

**1. Arrival event — appended immediately when the voice message enters the queue.**

- `event: "message"`
- `content.type: "voice"`
- Includes `file_id` and the Telegram message `id`
- MUST NOT wait for transcription. The arrival event is written before the transcription call even starts.

**2. Transcription event — appended after `patchVoiceText` completes.**

On success:
- `event: "transcription"`
- `content.type: "voice_transcription"`
- `content.text: "<full transcribed text>"`
- Joined to the arrival event by the **message `id`** (the same field used on the arrival event). MUST NOT use `ref_message_id`.

On failure:
- `event: "transcription_error"`
- `content.type: "voice_transcription_error"`
- `error_code`, `error`
- Same join key (message `id`).

Either the success or the failure event fires — never both — and it fires exactly once per voice message.

## Rationale

A log reader scanning the NDJSON needs to reconstruct the arrival and transcription pair with a single field lookup. Keying on the message `id` makes that trivial. Logging the arrival immediately (not waiting for transcription) means we never lose the record of a voice message even if transcription is slow or fails.

## Acceptance

- Send a voice message through the bridge.
- Inspect the dump log.
- First entry: arrival event with `file_id` + message `id`, no text.
- Second entry (appearing any time later): transcription event with `content.text` and the same `id` as the arrival event.
- Force a transcription failure (e.g. unreachable `STT_HOST`): second entry is a `transcription_error` event, same `id`.
- Tests in `src/message-store.test.ts` cover both success and error paths.

## Don'ts

- Do not block arrival logging on transcription completion.
- Do not use `ref_message_id` as the join key.
- Do not write both a success and a failure event for the same message.
- Do not re-architect the logging pipeline. The existing `setOnTranscriptionLog` callback in `src/message-store.ts` is the extension point.

## Scope of this worker's job

1. Read the current state of `src/index.ts`, `src/message-store.ts`, and `src/message-store.test.ts` on `dev`.
2. Verify the behavior above is implemented and tested. If any gap exists, fix it.
3. Confirm `master` is missing the fix; open a PR from `dev` to `master` referencing 10-773. Do NOT merge — operator merges.
4. Report: AC verified (yes / no per bullet), test results, PR URL, any gaps you had to fix.

## Priority

00 (P0) — voice logging is core observability; master must catch up to dev.

## Delegation

Worker (TMCP).

## Completion

All 5 acceptance criteria verified on `dev` (2026-04-21):
- AC1: Arrival event logged immediately via `recordInbound()` / `pushEvent()` — includes `file_id` + `id`
- AC2: Transcription success event logged after `patchVoiceText` — `event:"transcription"`, joined by `id`
- AC3: Transcription error event on failure — `event:"transcription_error"`, `error_code`, `error`, same `id`
- AC4: Either/or, exactly once — `patchVoiceText()` callback fires once via if/else
- AC5: Tests cover both paths — `message-store.test.ts:333-347`

Build: `pnpm build` PASS, `pnpm test` PASS (2478/2478). Lint has 2 pre-existing errors in `local-log.ts` (unrelated to this task).

Fix commits on `dev`: `788fcfd`, `8fc5be9`, `3f77013`. Included in PR #152 (Release v7.0.2, dev -> master).
PR URL: https://github.com/electrified-cortex/Telegram-Bridge-MCP/pull/152
