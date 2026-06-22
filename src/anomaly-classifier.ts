/**
 * Anomaly classifier and escalation router for agent monitoring loops.
 *
 * Loads anomaly categories from `src/anomaly-taxonomy.json` (data file — do not
 * hardcode categories here). On each `reportAnomaly()` call:
 *   1. Classifies the event by slug against the taxonomy.
 *   2. Tracks per-slug occurrence counts within a rolling window (default 10 min).
 *   3. Routes escalation:
 *      count === 1  → category.action.first   (typically notify-governor)
 *      count === 2  → category.action.second  (typically alert-loud)
 *      count  >  2  → suppress within window  (no further spam)
 *
 * Normal-flow errors (empty queue, already-claimed, merge conflict, etc.) are
 * excluded via `NORMAL_FLOW_CODES` — they must never trigger anomaly escalation.
 *
 * Designed for dependency injection so the module is fully unit-testable
 * without a live Telegram bot or session queue.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EscalationAction =
  | "log-only"
  | "notify-governor"
  | "alert-loud"
  | "auto-remediate";

export type Severity = "WARN" | "ERROR" | "CRITICAL";

export interface AnomalyCategory {
  /** Unique identifier matching the taxonomy JSON `slug` field. */
  slug: string;
  /** Human-readable category name. */
  name: string;
  /** Description of the signals that indicate this anomaly. */
  detection_signal: string;
  severity: Severity;
  action: {
    /** Action on the first occurrence within the window. */
    first: EscalationAction;
    /** Action on the second occurrence within the window. */
    second: EscalationAction;
  };
  notes?: string;
}

/**
 * A runtime anomaly event submitted to the classifier.
 * Callers detect the anomaly and supply the pre-classified slug.
 */
export interface AnomalyEvent {
  /**
   * The anomaly category slug (must match a slug in `anomaly-taxonomy.json`).
   * Unknown slugs and normal-flow codes return null from the classifier.
   */
  slug: string;
  /** Session ID where the anomaly was detected (optional — used for context). */
  sid?: number;
  /** Human-readable description appended to the escalation message. */
  message?: string;
  /** Additional key/value context for the escalation payload. */
  details?: Record<string, unknown>;
}

/**
 * Dependencies injected into `reportAnomaly` so the classifier is testable
 * without live sessions or a running Telegram bot.
 */
export interface AnomalyEscalationDeps {
  /**
   * Deliver a service message to the governor session.
   * Returns true if the message was queued, false if no governor session exists.
   */
  notifyGovernor: (text: string, details?: Record<string, unknown>) => boolean;
  /**
   * Send a direct alert to the operator via Telegram (best-effort, fire-and-forget).
   * Resolves when the send attempt completes or is enqueued.
   */
  alertOperator: (text: string) => Promise<void>;
  /**
   * Optional stderr logger. Defaults to `process.stderr.write`.
   * Provided so tests can suppress or capture output.
   */
  log?: (text: string) => void;
}

// ---------------------------------------------------------------------------
// Normal-flow exclusion list
// ---------------------------------------------------------------------------

/**
 * TelegramErrorCodes (and symbolic keys) that represent normal operational flow.
 * If an event's `details.errorCode` matches any of these, the classifier returns null.
 *
 * "Normal-flow" means: the system behaved correctly; no escalation is warranted.
 * Examples:
 *   - LAST_SESSION: can't close the only remaining session — expected guard.
 *   - NOT_PENDING: approve called on a non-pending approval — caller timing issue.
 *   - SESSION_NOT_FOUND: session ended before a deferred call arrived — race.
 *   - STREAM_EXPIRED: SSE stream naturally expired on reconnect — expected.
 *   - NAME_CONFLICT: session name collision on start — normal on concurrent retry.
 */
export const NORMAL_FLOW_CODES = new Set<string>([
  "LAST_SESSION",
  "NOT_PENDING",
  "SESSION_NOT_FOUND",
  "STREAM_EXPIRED",
  "NAME_CONFLICT",
]);

// ---------------------------------------------------------------------------
// Taxonomy loading
// ---------------------------------------------------------------------------

let _taxonomy: Map<string, AnomalyCategory> | undefined;

function loadTaxonomy(): Map<string, AnomalyCategory> {
  if (_taxonomy) return _taxonomy;
  const path = resolve(__dirname, "anomaly-taxonomy.json");
  const raw = readFileSync(path, "utf-8");
  const categories = JSON.parse(raw) as AnomalyCategory[];
  _taxonomy = new Map(categories.map((c) => [c.slug, c]));
  return _taxonomy;
}

/**
 * Inject a pre-built taxonomy map — for use in tests that don't want to hit
 * the filesystem. Call with `undefined` to restore filesystem loading.
 */
export function setTaxonomyForTest(
  map: Map<string, AnomalyCategory> | undefined,
): void {
  _taxonomy = map;
}

/** Return a read-only snapshot of the current taxonomy. */
export function getTaxonomy(): ReadonlyMap<string, AnomalyCategory> {
  return loadTaxonomy();
}

// ---------------------------------------------------------------------------
// Counter store
// ---------------------------------------------------------------------------

/** Default rolling window in milliseconds (10 minutes). */
export const DEFAULT_WINDOW_MS = 600_000;

interface WindowEntry {
  count: number;
  window_start: number;
}

let _counters = new Map<string, WindowEntry>();

/** Reset all counters — for use in tests only. */
export function resetCountersForTest(): void {
  _counters = new Map();
}

/**
 * Return the current in-window count for `slug`.
 * Returns 0 if no entry exists or the window has expired.
 */
export function getCountForSlug(
  slug: string,
  nowMs: number = Date.now(),
  windowMs: number = DEFAULT_WINDOW_MS,
): number {
  const entry = _counters.get(slug);
  if (!entry) return 0;
  if (nowMs - entry.window_start > windowMs) return 0;
  return entry.count;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a runtime event against the anomaly taxonomy.
 *
 * Returns the matching `AnomalyCategory`, or `null` when:
 *   - `event.details.errorCode` is in the `NORMAL_FLOW_CODES` exclusion list, OR
 *   - `event.slug` does not match any taxonomy entry.
 */
export function classifyAnomalyEvent(event: AnomalyEvent): AnomalyCategory | null {
  // Exclude normal-flow error codes supplied by the caller
  if (
    event.details?.errorCode !== undefined &&
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    NORMAL_FLOW_CODES.has(String(event.details.errorCode))
  ) {
    return null;
  }
  const taxonomy = loadTaxonomy();
  return taxonomy.get(event.slug) ?? null;
}

// ---------------------------------------------------------------------------
// Escalation router
// ---------------------------------------------------------------------------

/** Return value indicating what action was taken (or why nothing was done). */
export type ReportOutcome = EscalationAction | "suppress" | "skipped";

/**
 * Report an anomaly event.
 *
 * Steps:
 *   1. Classify (`classifyAnomalyEvent`).  Returns "skipped" on null.
 *   2. Increment the rolling-window counter for the slug.
 *   3. Dispatch the appropriate escalation action:
 *        count === 1  → `category.action.first`
 *        count === 2  → `category.action.second`
 *        count  >  2  → "suppress" (no notification, no spam)
 *
 * @param event     The anomaly event to process.
 * @param deps      Escalation callbacks (governor notify + operator alert).
 * @param windowMs  Rolling window size in ms (default 600 000 = 10 min).
 * @param nowMs     Current timestamp in ms; defaults to `Date.now()`.
 *                  Exposed so tests can control time without mocking globals.
 * @returns The action taken or "suppress"/"skipped".
 */
export function reportAnomaly(
  event: AnomalyEvent,
  deps: AnomalyEscalationDeps,
  windowMs: number = DEFAULT_WINDOW_MS,
  nowMs: number = Date.now(),
): ReportOutcome {
  const category = classifyAnomalyEvent(event);
  if (!category) return "skipped";

  // --- Counter update ---
  const slug = event.slug;
  const existing = _counters.get(slug);

  let count: number;
  if (!existing || nowMs - existing.window_start > windowMs) {
    count = 1;
    _counters.set(slug, { count: 1, window_start: nowMs });
  } else {
    count = existing.count + 1;
    _counters.set(slug, { count, window_start: existing.window_start });
  }

  // --- Action resolution ---
  const action: ReportOutcome =
    count === 1
      ? category.action.first
      : count === 2
        ? category.action.second
        : "suppress";

  // --- Escalation dispatch ---
  const log =
    deps.log ??
    ((msg: string) => process.stderr.write(`[anomaly] ${msg}\n`));

  const label = `[${category.severity}] ${category.name} (${slug})`;
  const body = event.message ?? `Anomaly detected: ${category.name}`;
  const text = `🚨 ${label}\n${body}`;
  const eventDetails: Record<string, unknown> = {
    slug,
    count,
    severity: category.severity,
    ...(event.sid !== undefined ? { sid: event.sid } : {}),
    ...event.details,
  };

  switch (action) {
    case "log-only":
      log(`${slug}: count=${count} — ${category.name}`);
      break;

    case "notify-governor":
      deps.notifyGovernor(text, eventDetails);
      break;

    case "alert-loud":
      void deps.alertOperator(text);
      break;

    case "auto-remediate":
      // Caller is responsible for the remediation; we still fire alert-loud so
      // there is an explicit anomaly record beyond the service message.
      void deps.alertOperator(`🔧 auto-remediate: ${text}`);
      break;

    case "suppress":
      log(`${slug}: count=${count} — suppressed within window`);
      break;
  }

  return action;
}
