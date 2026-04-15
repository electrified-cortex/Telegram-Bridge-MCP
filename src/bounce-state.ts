let _planned = false;
let _plannedAt = 0;
const BOUNCE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export function setPlannedBounce(v: boolean): void {
  _planned = v;
  _plannedAt = v ? Date.now() : 0;
}

export function isPlannedBounce(): boolean {
  return _planned && (Date.now() - _plannedAt) < BOUNCE_WINDOW_MS;
}

export function resetBounceStateForTest(): void {
  _planned = false;
  _plannedAt = 0;
}
