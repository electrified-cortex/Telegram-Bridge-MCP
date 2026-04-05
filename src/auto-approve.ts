/** Auto-approve mode for session_start requests. */
export type AutoApproveMode = "none" | "one" | "timed";

interface AutoApproveState {
  mode: AutoApproveMode;
  expiresAt?: number; // ms timestamp, only when mode === "timed"
}

let _state: AutoApproveState = { mode: "none" };
let _timer: ReturnType<typeof setTimeout> | undefined;

/** Activate single-request auto-approve. */
export function activateAutoApproveOne(): void {
  cancelAutoApprove();
  _state = { mode: "one" };
}

const MAX_TIMER_MS = 2_000_000_000;

/** Activate timed auto-approve for `durationMs` milliseconds. */
export function activateAutoApproveTimed(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  cancelAutoApprove();
  _state = { mode: "timed", expiresAt: Date.now() + durationMs };
  const tick = () => {
    const remaining = (_state.expiresAt ?? 0) - Date.now();
    if (remaining > 0) {
      _timer = setTimeout(tick, Math.min(remaining, MAX_TIMER_MS));
      return;
    }
    cancelAutoApprove();
  };
  _timer = setTimeout(tick, Math.min(durationMs, MAX_TIMER_MS));
}

/** Cancel any active auto-approve. */
export function cancelAutoApprove(): void {
  if (_timer !== undefined) {
    clearTimeout(_timer);
    _timer = undefined;
  }
  _state = { mode: "none" };
}

/**
 * Check if a session_start should be auto-approved.
 * Consumes a "one" token if active. Returns true if auto-approved.
 */
export function checkAndConsumeAutoApprove(): boolean {
  if (_state.mode === "none") return false;
  if (_state.mode === "one") {
    cancelAutoApprove();
    return true;
  }
  if (_state.expiresAt !== undefined && Date.now() >= _state.expiresAt) {
    cancelAutoApprove();
    return false;
  }
  return true;
}

/** Returns the current auto-approve state (for status display). */
export function getAutoApproveState(): Readonly<AutoApproveState> {
  return { ..._state };
}
