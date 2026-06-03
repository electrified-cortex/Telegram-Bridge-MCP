/**
 * Parent-child session ownership registry.
 *
 * Tracks which parent SID spawned each child SID, and which display slot (1-9)
 * was assigned to each child. Used by session/revoke-child to verify ownership,
 * and by spawn-child for gap-fill slot assignment and SUB_SESSION_LIMIT enforcement.
 *
 * Authoritative store for parent/child relationships and display indices.
 */

const _childToParent = new Map<number, number>();
const _parentToSlots = new Map<number, Map<number, number>>(); // parentSid → Map<slot, childSid>
const _childToSlot = new Map<number, number>(); // childSid → slot (1-9)

/**
 * Register a child session under a parent. Assigns the lowest free display slot
 * (gap-fill, 1-9). Returns the assigned display_index.
 * Throws if all 9 slots are already occupied for this parent.
 */
export function registerChild(parentSid: number, childSid: number): number {
  let slots = _parentToSlots.get(parentSid);
  if (!slots) {
    slots = new Map();
    _parentToSlots.set(parentSid, slots);
  }
  // Gap-fill: lowest free slot in 1-9
  let slot = 1;
  while (slot <= 9 && slots.has(slot)) slot++;
  if (slot > 9) throw new Error(`SUB_SESSION_LIMIT: parent ${parentSid} already has 9 children`);

  _childToParent.set(childSid, parentSid);
  _childToSlot.set(childSid, slot);
  slots.set(slot, childSid);
  return slot;
}

export function getParent(childSid: number): number | undefined {
  return _childToParent.get(childSid);
}

/** Return the assigned display slot (1-9) for a child session. */
export function getDisplayIndex(childSid: number): number | undefined {
  return _childToSlot.get(childSid);
}

/**
 * Return the display_index slot numbers (1-9) of currently-alive children for a parent.
 * Gap-fill uses this set: lowest integer in 1-9 not present = next available slot.
 */
export function getChildren(parentSid: number): number[] {
  const slots = _parentToSlots.get(parentSid);
  if (!slots) return [];
  return [...slots.keys()];
}

/** Return the SIDs of currently-alive children for a parent. */
export function getChildSids(parentSid: number): number[] {
  const slots = _parentToSlots.get(parentSid);
  if (!slots) return [];
  return [...slots.values()];
}

export function unregisterChild(childSid: number): void {
  const parentSid = _childToParent.get(childSid);
  const slot = _childToSlot.get(childSid);
  _childToParent.delete(childSid);
  _childToSlot.delete(childSid);
  if (parentSid !== undefined && slot !== undefined) {
    _parentToSlots.get(parentSid)?.delete(slot);
  }
}

/** Clear all registrations. Intended for use in tests only. */
export function clearChildRegistry(): void {
  _childToParent.clear();
  _parentToSlots.clear();
  _childToSlot.clear();
}
