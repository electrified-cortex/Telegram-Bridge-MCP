# 630 — Upgrade audio-decode to v3

## Objective

Close dependabot PR #24 and manually upgrade `audio-decode` from 2.2.3 to 3.0.0, adapting our code to the new API.

## Breaking change

v3 returns `{ channelData: Float32Array[], sampleRate: number }` instead of an `AudioBuffer` with `.getChannelData(channel)`.

## Files to update

### `src/transcribe.ts` (~line 65-77)

```diff
- interface DecodedAudio {
-   getChannelData(channel: number): Float32Array;
-   sampleRate: number;
- }
+ interface DecodedAudio {
+   channelData: Float32Array[];
+   sampleRate: number;
+ }
  const { default: decode } = await import("audio-decode") as { default: (buf: Buffer) => Promise<DecodedAudio> };
  const audioBuffer = await decode(audioBytes);
- const channelData = audioBuffer.getChannelData(0);
+ const channelData = audioBuffer.channelData[0];
```

### `src/tts.ts` (~line 223-230)

Same pattern — replace `decoded.getChannelData(0)` with `decoded.channelData[0]`.

### Test mocks

- `src/transcribe.test.ts` (~line 149): Update mock to return `{ channelData: [...], sampleRate }` instead of `{ getChannelData: () => ..., sampleRate }`
- `src/tts.test.ts` (~line 15+): Same mock shape update

### `package.json`

Change `"audio-decode": "^2.2.3"` to `"audio-decode": "^3.0.0"` and run `pnpm install`.

## Steps

1. Branch from master
2. Update `package.json`, run `pnpm install`
3. Update `transcribe.ts` and `tts.ts` (interface + call sites)
4. Update test mocks in `transcribe.test.ts` and `tts.test.ts`
5. Build + full test suite
6. Commit, create PR, merge
7. Close PR #24 with a comment linking to the consolidated commit
8. Monitor CI
