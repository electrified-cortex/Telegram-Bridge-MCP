export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Graceful shutdown / poller-exit race timeout. */
export const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10_000;

/** Poll interval while waiting for sessions to close during shutdown. */
export const SHUTDOWN_POLL_INTERVAL_MS = 500;

/** Post-send delay after a voice message (rendering takes 2–5 s). */
export const POST_VOICE_SEND_DELAY_MS = 3_000;
