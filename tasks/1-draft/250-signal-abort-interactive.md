# Feature: Signal Abort During Interactive Wait

## ⚠️ Needs Clarification Before Implementation

1. **Expected return shape for `confirm` and `choose` on abort is not
   specified.** `ask` documents `{ timed_out: false, aborted: true }` in its
   description. `confirm` and `choose` use `pollButtonPress` / 
   `pollButtonOrTextOrVoice` — but neither their source docstrings nor this
   task spec state what they return when the abort signal fires. Before
   writing SCs 2 and 3, read `src/tools/confirm.ts` and `src/tools/choose.ts`
   to determine:
   - Does `pollButtonPress` propagate abort at all, or silently hang?
   - What is the exact return value (e.g. `null`, `{ aborted: true }`, thrown
     error) that the tool wraps and sends to the MCP caller?
   Specify the expected return shape in the scenario before writing the test.

2. **"If abort is NOT actually wired, document as a finding" is a testing gap,
   not a test spec.** If abort is unimplemented in `confirm`/`choose`, this
   becomes a bug report task, not a testing task. Verify this first by reading
   the source; if the feature is missing, create a separate bug/implementation
   task.

## Type

Testing

## Priority

250 (medium — MCP protocol correctness)

## Problem

The MCP protocol passes an `AbortSignal` to tool handlers. When the client
disconnects or cancels the request, the signal fires. Interactive tools that
block (confirm, choose, ask) should respect this signal and return cleanly
instead of hanging forever.

The `ask` tool checks `signal.aborted` and returns
`{ timed_out: false, aborted: true }`. The `confirm` and `choose` tools use
`pollButtonPress` which accepts a signal — but no test ever sends an abort
signal during the wait to verify it works.

## Test Scenarios

### SC-1: ask — abort during text wait

1. Call `ask` tool with an `AbortController` signal
2. Before any reply arrives, fire `controller.abort()`
3. Verify `ask` resolves promptly (not hanging until timeout)
4. Verify result indicates abort (not timeout)

### SC-2: confirm — abort during button wait

1. Call `confirm` with abort signal
2. Fire abort before any callback
3. Verify `confirm` resolves promptly
4. Verify no dangling hooks or message subscriptions leaked

### SC-3: choose — abort during button wait

1. Call `choose` with abort signal
2. Fire abort before any callback
3. Verify `choose` resolves promptly
4. Verify hook cleanup

### SC-4: Abort after result already received

1. Call `confirm`, simulate button press → resolves
2. Fire abort signal **after** the tool already returned
3. Verify no crash (abort on already-resolved promise is a no-op)

## Code References

- `src/tools/ask.ts` — `signal.aborted` check
- `src/tools/button-helpers.ts` — `pollButtonPress` signal parameter
- `src/tools/confirm.ts` — passes signal through
- `src/tools/choose.ts` — passes signal through

## Constraints

- Test file: `src/tools/signal-abort.test.ts`
- Use `AbortController` from Node.js
- Each scenario independent
- Test file only — no production code changes
- If abort is NOT actually wired in confirm/choose, document as a finding and
  file a follow-up bug
