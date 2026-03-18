/**
 * Backward-compatibility shim — TwoLaneQueue is now TemporalQueue.
 *
 * Import from temporal-queue.ts directly for new code.
 */
export { TemporalQueue as TwoLaneQueue } from "./temporal-queue.js";
export type { TemporalQueueOptions as TwoLaneQueueOptions } from "./temporal-queue.js";
