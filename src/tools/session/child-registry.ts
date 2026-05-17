/**
 * Parent-child session ownership registry.
 *
 * Tracks which parent SID spawned each child SID. Used by session/revoke-child
 * to verify the caller is the session's spawning parent before closing it.
 *
 * Intentionally kept separate from the Session data model (no schema changes).
 */

const _childToParent = new Map<number, number>();

export function registerChild(parentSid: number, childSid: number): void {
  _childToParent.set(childSid, parentSid);
}

export function getParent(childSid: number): number | undefined {
  return _childToParent.get(childSid);
}

export function unregisterChild(childSid: number): void {
  _childToParent.delete(childSid);
}

/** Clear all registrations. Intended for use in tests only. */
export function clearChildRegistry(): void {
  _childToParent.clear();
}
