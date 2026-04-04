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

/** Activate timed auto-approve for `durationMs` milliseconds. */
export function activateAutoApproveTimed(durationMs: number): void {
  cancelAutoApprove();
  _state = { mode: "timed", expiresAt: Date.now() + durationMs };
  _timer = setTimeout(() => {
    _state = { mode: "none" };
    _timer = undefined;
  }, durationMs);
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
    _state = { mode: "none" };
    return true;
  }
  if (_state.mode === "timed") {
    if (_state.expiresAt !== undefined && Date.now() >= _state.expiresAt) {
      _state = { mode: "none" };
      return false;
    }
    return true;
  }
  return false;
}

/** Returns the current auto-approve state (for status display). */
export function getAutoApproveState(): Readonly<AutoApproveState> {
  return _state;
}
