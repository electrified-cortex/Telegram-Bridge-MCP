# [Unreleased]

## Fixed

- Fixed cross-session race condition where `_bypassing` global boolean in `outbound-proxy.ts` could suppress message tracking hooks in unrelated sessions; replaced with `AsyncLocalStorage`-scoped bypass
- Made `_fileSendTypingGen` per-session (keyed by SID) to eliminate typing-cancel races during concurrent file sends
