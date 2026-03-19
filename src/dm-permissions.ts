/**
 * Direct message permissions between sessions.
 *
 * All active sessions can DM each other — permission is implicit.
 * Operator approval at session_start is the trust gate.
 * Permissions are ephemeral (reset on restart).
 */

import { dlog } from "./debug-log.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Always returns true — all approved sessions can DM each other. */
export function hasDmPermission(_sender: number, _target: number): boolean {
  return true;
}

/** Remove all permissions involving a session. No-op: permissions are implicit. */
export function revokeAllForSession(sid: number): void {
  dlog("dm", `revokeAllForSession sid=${sid} — no-op (permissions are implicit)`);
}

// ---------------------------------------------------------------------------
// Reset (testing only)
// ---------------------------------------------------------------------------

export function resetDmPermissionsForTest(): void {
  // no state to reset
}
