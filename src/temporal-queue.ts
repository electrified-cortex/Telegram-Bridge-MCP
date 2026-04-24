/**
 * Generic temporal ordered queue with batch-delivery semantics.
 *
 * Design:
 *   - **Single FIFO queue** — events are stored in arrival order.
 *   - **Heavyweight delimiter** — heavyweight events (text, voice) act as
 *     batch boundaries. `dequeueBatch` collects all lightweight events that
 *     precede the first heavyweight, then includes the heavyweight itself.
 *   - **Voice hold** — if the heavyweight delimiter is not yet ready (e.g.
 *     voice transcription still in flight), the entire batch is held until
 *     readiness is signalled via `notifyWaiters()`.
 *   - **Lightweight-only flush** — if no heavyweight exists in the queue, all
 *     queued items (all lightweight) are returned as a single batch.
 *   - Legacy `enqueueResponse`/`enqueueMessage` are kept as aliases for
 *     `enqueue()` so existing callers compile without changes.
 */

import Queue from "@tsdotnet/queue";

// ---------------------------------------------------------------------------
// TemporalQueue
// ---------------------------------------------------------------------------

export interface TemporalQueueOptions<T> {
  /** Maximum items in the queue. Default 5 000. */
  maxSize?: number;
  /**
   * Return true if the item is a heavyweight event — a batch delimiter
   * (e.g. a user text message or voice message). Lightweight items are
   * reactions, callbacks, files, service messages, etc.
   * Default: all items are lightweight (batch drains everything).
   */
  isHeavyweight?: (item: T) => boolean;
  /** Return false to hold the item queued (e.g. voice pending transcription). */
  isReady?: (item: T) => boolean;
  /** Extract a numeric ID for consumed-tracking. Return 0 to skip tracking. */
  getId?: (item: T) => number;
}

const DEFAULT_MAX_SIZE = 5000;

export class TemporalQueue<T> {
  private readonly _queue = new Queue<T>();
  private readonly _consumedIds = new Set<number>();
  private readonly _pendingIds = new Set<number>();
  private _waiters: Array<() => void> = [];
  private _wakeVersion = 0;
  private readonly _maxSize: number;
  private readonly _isHeavyweight: (item: T) => boolean;
  private readonly _isReady: (item: T) => boolean;
  private readonly _getId: (item: T) => number;

  constructor(options?: TemporalQueueOptions<T>) {
    this._maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;
    this._isHeavyweight = options?.isHeavyweight ?? (() => false);
    this._isReady = options?.isReady ?? (() => true);
    this._getId = options?.getId ?? (() => 0);
  }

  // -------------------------------------------------------------------------
  // Enqueue
  // -------------------------------------------------------------------------

  /** Add an item to the end of the temporal queue. */
  enqueue(item: T): void {
    if (this._queue.count >= this._maxSize) {
      const evicted = this._queue.dequeue();
      if (evicted !== undefined) {
        const evictedId = this._getId(evicted);
        if (evictedId > 0) this._pendingIds.delete(evictedId);
      }
    }
    this._queue.enqueue(item);
    const id = this._getId(item);
    if (id > 0) this._pendingIds.add(id);
    this._wakeVersion++;
    this._notifyWaiters();
  }

  /** @deprecated Use enqueue(). Kept for backward compatibility. */
  enqueueResponse(item: T): void { this.enqueue(item); }

  /** @deprecated Use enqueue(). Kept for backward compatibility. */
  enqueueMessage(item: T): void { this.enqueue(item); }

  // -------------------------------------------------------------------------
  // Dequeue
  // -------------------------------------------------------------------------

  /**
   * Single-item dequeue in temporal order — returns the first ready item.
   * Primarily used by drain operations (session teardown).
   * Skips not-ready items and re-queues them at the back.
   */
  dequeue(): T | undefined {
    const items = [...this._queue.consumer()];
    let found: T | undefined;
    for (const item of items) {
      if (found === undefined && this._isReady(item)) {
        found = item;
        continue; // don't re-enqueue — it's being consumed
      }
      this._queue.enqueue(item);
    }
    if (found !== undefined) this._trackConsumed(found);
    return found;
  }

  /**
   * Temporal batch dequeue with heavyweight delimiter.
   *
   * Collects events in arrival order:
   *  - All leading lightweight events are always included.
   *  - Stops after the first heavyweight event (inclusive).
   *  - If the heavyweight is not ready (e.g. voice pending), the entire
   *    batch is held — returns [].
   *  - If no heavyweight exists, drains all queued items (all lightweight).
   */
  dequeueBatch(): T[] {
    const items = [...this._queue.consumer()]; // temporarily drain

    // Find the first heavyweight
    let heavyIdx = -1;
    for (let i = 0; i < items.length; i++) {
      if (this._isHeavyweight(items[i])) {
        heavyIdx = i;
        break;
      }
    }

    if (heavyIdx >= 0 && !this._isReady(items[heavyIdx])) {
      // Heavyweight not ready — hold the entire batch
      for (const item of items) this._queue.enqueue(item);
      return [];
    }

    const batchEnd = heavyIdx >= 0 ? heavyIdx + 1 : items.length;
    const batch = items.slice(0, batchEnd);
    const remaining = items.slice(batchEnd);

    for (const item of remaining) this._queue.enqueue(item);
    for (const item of batch) this._trackConsumed(item);
    return batch;
  }

  /**
   * Find and remove the first item matching the predicate.
   * Returns the predicate's result, or undefined if no match.
   * Notifies waiters on match.
   */
  dequeueMatch<R>(predicate: (item: T) => R | undefined): R | undefined {
    const items = [...this._queue.consumer()];
    let found: R | undefined;
    let consumedItem: T | undefined;
    for (const item of items) {
      if (found === undefined) {
        const result = predicate(item);
        if (result !== undefined) {
          found = result;
          consumedItem = item;
          continue; // matched item is consumed — don't re-enqueue
        }
      }
      this._queue.enqueue(item);
    }
    if (consumedItem !== undefined) this._trackConsumed(consumedItem);
    if (found !== undefined) this._notifyWaiters();
    return found;
  }

  // -------------------------------------------------------------------------
  // State queries
  // -------------------------------------------------------------------------

  /** Number of unconsumed items in the queue. */
  pendingCount(): number {
    return this._queue.count;
  }

  /**
   * Non-destructive peek: returns item counts grouped by type without consuming anything.
   * Items are temporarily drained from the internal queue then re-enqueued in order.
   */
  peekCategories(getType: (item: T) => string): Record<string, number> {
    const items = [...this._queue.consumer()];
    const counts: Record<string, number> = {};
    for (const item of items) {
      const type = getType(item);
      counts[type] = (counts[type] ?? 0) + 1;
      this._queue.enqueue(item);
    }
    return counts;
  }

  /**
   * Non-destructive peek: returns the first item matching the predicate, or undefined.
   * Safe: `@tsdotnet/queue` Queue._getIterator() is a non-consuming generator that reads
   * by index offset into the internal array — early return does not drain or corrupt state.
   * Does not check isReady — finds items regardless of readiness.
   */
  peekFirst(predicate: (item: T) => boolean): T | undefined {
    for (const item of this._queue) {
      if (predicate(item)) return item;
    }
    return undefined;
  }

  /** True if the given ID has been dequeued. */
  isConsumed(id: number): boolean {
    return this._consumedIds.has(id);
  }

  /** True if at least one caller is blocked waiting for data. */
  hasPendingWaiters(): boolean {
    return this._waiters.length > 0;
  }

  /** Promise that resolves when a new item is enqueued (or notifyWaiters is called). */
  waitForEnqueue(): Promise<void> {
    return this.waitForEnqueueSince(this._wakeVersion);
  }

  /** Monotonic wake version used for race-free wait registration. */
  getWakeVersion(): number {
    return this._wakeVersion;
  }

  /**
   * Promise that resolves when the queue wake-version changes from `version`.
   *
   * Use this with a version captured before checking queue state to avoid the
   * classic lost-wakeup race:
   * 1) check queue empty
   * 2) event enqueued
   * 3) waiter registered too late and blocks forever
   */
  waitForEnqueueSince(version: number): Promise<void> {
    if (this._wakeVersion !== version) return Promise.resolve();
    return new Promise((resolve) => {
      if (this._wakeVersion !== version) {
        resolve();
        return;
      }
      this._waiters.push(resolve);
    });
  }

  // -------------------------------------------------------------------------
  // Public mutation
  // -------------------------------------------------------------------------

  /**
   * Wake all blocked waiters. Call after mutating a queued item in-place
   * (e.g. patchVoiceText filling in transcription) to unblock dequeueBatch.
   */
  notifyWaiters(): void {
    this._wakeVersion++;
    this._notifyWaiters();
  }

  /** Reset all queue state. For tests only. */
  clear(): void {
    this._queue.clear();
    this._consumedIds.clear();
    this._waiters = [];
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private _notifyWaiters(): void {
    const batch = this._waiters;
    this._waiters = [];
    for (const resolve of batch) resolve();
  }

  private _trackConsumed(item: T): void {
    const id = this._getId(item);
    if (id > 0) {
      this._consumedIds.add(id);
      this._pendingIds.delete(id);
    }
  }

  /** True if the queue contains a pending (not yet consumed) item with the given ID. */
  hasItem(id: number): boolean {
    return id > 0 && this._pendingIds.has(id);
  }
}
