/**
 * fetch() with a per-attempt abort timeout + bounded retries.
 *
 * Purpose: recover intermittent connect/TLS-handshake stalls on outbound
 * Telegram file downloads. A stalled attempt is aborted at `perAttemptTimeoutMs`
 * and the next attempt opens a fresh connection (observed to clear in ~0.5 s on
 * retry). Use ONLY for idempotent GET downloads — never for the whisper POST.
 *
 * Correctness (verified empirically on node 24 / undici, 2026-06-30):
 *  - A FRESH AbortController per attempt (never reused or shared across attempts).
 *  - The timeout is cleared in `finally` on BOTH the success and error paths, so a
 *    settled request's timer can never fire abort() late.
 *  - Uses AbortController + setTimeout, NOT `AbortSignal.timeout()` (which has
 *    known node-24/undici timer bugs).
 *  - Retries only on a thrown network/abort error. An HTTP-error Response
 *    (4xx/5xx) is returned as-is for the caller's `res.ok` check and is NEVER
 *    retried, so real server errors are not masked.
 *
 * Teardown note (honest): aborting a stalled attempt issues a graceful close
 * (FIN). Against a truly unresponsive peer the socket then sits in FIN_WAIT2
 * until the OS reaps it (~`tcp_fin_timeout`, default 60 s). This is BOUNDED and
 * is strictly better than the prior bare `fetch()`, which never aborted at all
 * (the socket hung indefinitely). Forcing an instant RST teardown was tested and
 * REJECTED: `socket.resetAndDestroy()` raises an unhandled `ECONNRESET` that can
 * crash the process — a worse failure mode than a bounded FIN_WAIT2.
 */
export interface FetchRetryOpts {
  /** Total attempts (default 2 — i.e. one retry). */
  attempts?: number;
  /** Per-attempt abort timeout in ms (default 20000 — well above a legit
   *  voice-note download (<1s), below the 10-25s stalls observed in the wild).
   *  NOTE: this is a *total* per-attempt timeout, not a time-to-first-byte /
   *  idle timeout — adequate for small Telegram file downloads. */
  perAttemptTimeoutMs?: number;
}

export async function fetchWithRetry(
  url: string | URL,
  init?: RequestInit,
  opts: FetchRetryOpts = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 2;
  const perAttemptTimeoutMs = opts.perAttemptTimeoutMs ?? 20_000;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, perAttemptTimeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        // Small linear backoff before opening a fresh connection.
        await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr;
}
