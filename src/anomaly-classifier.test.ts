/**
 * Tests for the anomaly classifier and escalation router.
 *
 * AC coverage:
 *   AC1 — taxonomy data file loaded with all AUTH/SESSION/RATE/DELIVERY/INFRA slugs
 *   AC2 — count===1 routes to governor; count===2 routes to operator
 *   AC3 — count>2 is suppressed within the window (no 3rd notification)
 *   AC4 — normal-flow codes return null from the classifier
 *   AC5 — regression: repeated hook denial (auth_governor_gate_repeated) escalates
 *           on the 2nd occurrence within the window
 *   AC6 — all existing tests passing (enforced by the pnpm test gate)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyAnomalyEvent,
  reportAnomaly,
  getTaxonomy,
  resetCountersForTest,
  getCountForSlug,
  NORMAL_FLOW_CODES,
  setTaxonomyForTest,
  DEFAULT_WINDOW_MS,
  type AnomalyCategory,
  type AnomalyEscalationDeps,
  type AnomalyEvent,
} from "./anomaly-classifier.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a set of no-op deps that record calls for assertions. */
function makeDeps(): {
  deps: AnomalyEscalationDeps;
  governorCalls: Array<{ text: string; details?: Record<string, unknown> }>;
  operatorCalls: string[];
  logLines: string[];
} {
  const governorCalls: Array<{ text: string; details?: Record<string, unknown> }> = [];
  const operatorCalls: string[] = [];
  const logLines: string[] = [];

  const deps: AnomalyEscalationDeps = {
    notifyGovernor: (text, details) => {
      governorCalls.push({ text, details });
      return true;
    },
    alertOperator: (text) => {
      operatorCalls.push(text);
      return Promise.resolve();
    },
    log: (text) => logLines.push(text),
  };

  return { deps, governorCalls, operatorCalls, logLines };
}

/** Build a minimal AnomalyCategory for injection in tests. */
function makeCategory(
  slug: string,
  first: AnomalyCategory["action"]["first"],
  second: AnomalyCategory["action"]["second"],
  severity: AnomalyCategory["severity"] = "ERROR",
): AnomalyCategory {
  return {
    slug,
    name: `Test ${slug}`,
    detection_signal: "test",
    severity,
    action: { first, second },
  };
}

/** Inject an in-memory taxonomy with a single test category. */
function useSingleCategory(
  slug: string,
  first: AnomalyCategory["action"]["first"],
  second: AnomalyCategory["action"]["second"],
  severity: AnomalyCategory["severity"] = "ERROR",
): void {
  const cat = makeCategory(slug, first, second, severity);
  setTaxonomyForTest(new Map([[slug, cat]]));
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetCountersForTest();
  // Restore real taxonomy between tests
  setTaxonomyForTest(undefined);
});

// ---------------------------------------------------------------------------
// AC1 — Taxonomy data file
// ---------------------------------------------------------------------------

describe("AC1: taxonomy data file", () => {
  it("loads without error and returns a non-empty map", () => {
    const taxonomy = getTaxonomy();
    expect(taxonomy.size).toBeGreaterThan(0);
  });

  it("contains all AUTH slugs", () => {
    const taxonomy = getTaxonomy();
    expect(taxonomy.has("auth_repeated_failure")).toBe(true);
    expect(taxonomy.has("auth_invalid_token_pattern")).toBe(true);
    expect(taxonomy.has("auth_governor_gate_repeated")).toBe(true);
  });

  it("contains all SESSION slugs", () => {
    const taxonomy = getTaxonomy();
    expect(taxonomy.has("session_unexpected_disconnect")).toBe(true);
    expect(taxonomy.has("session_reconnect_storm")).toBe(true);
    expect(taxonomy.has("session_ghost")).toBe(true);
    expect(taxonomy.has("session_sub_limit_exceeded")).toBe(true);
  });

  it("contains all RATE slugs", () => {
    const taxonomy = getTaxonomy();
    expect(taxonomy.has("rate_runaway_dequeue")).toBe(true);
    expect(taxonomy.has("rate_message_flood")).toBe(true);
    expect(taxonomy.has("rate_api_burst")).toBe(true);
  });

  it("contains all DELIVERY slugs", () => {
    const taxonomy = getTaxonomy();
    expect(taxonomy.has("delivery_repeated_failure")).toBe(true);
    expect(taxonomy.has("delivery_tts_timeout")).toBe(true);
    expect(taxonomy.has("delivery_async_send_timeout")).toBe(true);
    expect(taxonomy.has("delivery_queue_eviction")).toBe(true);
  });

  it("contains all INFRASTRUCTURE slugs", () => {
    const taxonomy = getTaxonomy();
    expect(taxonomy.has("infra_server_unavailable")).toBe(true);
    expect(taxonomy.has("infra_sse_stream_drop")).toBe(true);
    expect(taxonomy.has("infra_memory_pressure")).toBe(true);
    expect(taxonomy.has("infra_activity_file_failure")).toBe(true);
  });

  it("each category has required fields", () => {
    for (const [slug, cat] of getTaxonomy()) {
      expect(cat.slug, `${slug}.slug`).toBe(slug);
      expect(typeof cat.name, `${slug}.name`).toBe("string");
      expect(typeof cat.detection_signal, `${slug}.detection_signal`).toBe("string");
      expect(["WARN", "ERROR", "CRITICAL"]).toContain(cat.severity);
      expect(cat.action.first).toBeDefined();
      expect(cat.action.second).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// AC2 — Routing: count===1 → governor, count===2 → operator
// ---------------------------------------------------------------------------

describe("AC2: escalation routing by occurrence count", () => {
  it("count===1 with first=notify-governor routes to governor", () => {
    useSingleCategory("test_slug", "notify-governor", "alert-loud");
    const { deps, governorCalls, operatorCalls } = makeDeps();
    const now = 1_000_000;

    reportAnomaly({ slug: "test_slug" }, deps, DEFAULT_WINDOW_MS, now);

    expect(governorCalls).toHaveLength(1);
    expect(operatorCalls).toHaveLength(0);
    expect(governorCalls[0].text).toContain("test_slug");
  });

  it("count===2 with second=alert-loud routes to operator", () => {
    useSingleCategory("test_slug", "notify-governor", "alert-loud");
    const { deps, governorCalls, operatorCalls } = makeDeps();
    const now = 1_000_000;

    reportAnomaly({ slug: "test_slug" }, deps, DEFAULT_WINDOW_MS, now);
    reportAnomaly({ slug: "test_slug" }, deps, DEFAULT_WINDOW_MS, now + 1000);

    expect(governorCalls).toHaveLength(1);  // first occurrence only
    expect(operatorCalls).toHaveLength(1);  // second occurrence
    expect(operatorCalls[0]).toContain("test_slug");
  });

  it("count===1 with first=alert-loud routes directly to operator", () => {
    useSingleCategory("test_critical", "alert-loud", "alert-loud", "CRITICAL");
    const { deps, operatorCalls } = makeDeps();
    const now = 1_000_000;

    reportAnomaly({ slug: "test_critical" }, deps, DEFAULT_WINDOW_MS, now);

    expect(operatorCalls).toHaveLength(1);
  });

  it("count===1 with first=log-only does not notify governor or operator", () => {
    useSingleCategory("test_log", "log-only", "notify-governor", "WARN");
    const { deps, governorCalls, operatorCalls, logLines } = makeDeps();
    const now = 1_000_000;

    reportAnomaly({ slug: "test_log" }, deps, DEFAULT_WINDOW_MS, now);

    expect(governorCalls).toHaveLength(0);
    expect(operatorCalls).toHaveLength(0);
    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toContain("test_log");
  });

  it("count===2 with second=notify-governor routes to governor", () => {
    useSingleCategory("test_slug2", "log-only", "notify-governor", "WARN");
    const { deps, governorCalls } = makeDeps();
    const now = 1_000_000;

    reportAnomaly({ slug: "test_slug2" }, deps, DEFAULT_WINDOW_MS, now);
    reportAnomaly({ slug: "test_slug2" }, deps, DEFAULT_WINDOW_MS, now + 5_000);

    expect(governorCalls).toHaveLength(1);
    expect(governorCalls[0].details?.count).toBe(2);
  });

  it("details include slug, count, and severity in the governor payload", () => {
    useSingleCategory("test_detail", "notify-governor", "alert-loud", "ERROR");
    const { deps, governorCalls } = makeDeps();
    const now = 1_000_000;

    reportAnomaly({ slug: "test_detail", sid: 42 }, deps, DEFAULT_WINDOW_MS, now);

    expect(governorCalls[0].details?.slug).toBe("test_detail");
    expect(governorCalls[0].details?.count).toBe(1);
    expect(governorCalls[0].details?.severity).toBe("ERROR");
    expect(governorCalls[0].details?.sid).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// AC3 — Rate limit: no spam beyond 2 notifications per category per window
// ---------------------------------------------------------------------------

describe("AC3: rate limiting — no spam beyond 2 notifications per window", () => {
  it("count>2 suppresses further notifications", () => {
    useSingleCategory("test_spam", "notify-governor", "alert-loud");
    const { deps, governorCalls, operatorCalls } = makeDeps();
    const now = 1_000_000;

    reportAnomaly({ slug: "test_spam" }, deps, DEFAULT_WINDOW_MS, now);           // 1 → gov
    reportAnomaly({ slug: "test_spam" }, deps, DEFAULT_WINDOW_MS, now + 1_000);   // 2 → op
    reportAnomaly({ slug: "test_spam" }, deps, DEFAULT_WINDOW_MS, now + 2_000);   // 3 → suppress
    reportAnomaly({ slug: "test_spam" }, deps, DEFAULT_WINDOW_MS, now + 3_000);   // 4 → suppress
    reportAnomaly({ slug: "test_spam" }, deps, DEFAULT_WINDOW_MS, now + 4_000);   // 5 → suppress

    expect(governorCalls).toHaveLength(1);
    expect(operatorCalls).toHaveLength(1);
    // Counter advanced but no extra calls fired
    expect(getCountForSlug("test_spam", now + 5_000)).toBe(5);
  });

  it("window reset after windowMs allows new escalation cycle", () => {
    useSingleCategory("test_reset", "notify-governor", "alert-loud");
    const { deps, governorCalls, operatorCalls } = makeDeps();
    const windowMs = 10_000;
    const now = 1_000_000;

    // First cycle
    reportAnomaly({ slug: "test_reset" }, deps, windowMs, now);           // 1 → gov
    reportAnomaly({ slug: "test_reset" }, deps, windowMs, now + 1_000);   // 2 → op
    reportAnomaly({ slug: "test_reset" }, deps, windowMs, now + 2_000);   // 3 → suppress

    // After window expires: fresh cycle
    const afterWindow = now + windowMs + 1;
    reportAnomaly({ slug: "test_reset" }, deps, windowMs, afterWindow);           // 1 → gov (new window)
    reportAnomaly({ slug: "test_reset" }, deps, windowMs, afterWindow + 1_000);   // 2 → op (new window)

    expect(governorCalls).toHaveLength(2);  // one from each cycle
    expect(operatorCalls).toHaveLength(2);  // one from each cycle
  });

  it("getCountForSlug returns 0 after window expires", () => {
    useSingleCategory("test_window", "notify-governor", "alert-loud");
    const { deps } = makeDeps();
    const windowMs = 5_000;
    const now = 1_000_000;

    reportAnomaly({ slug: "test_window" }, deps, windowMs, now);
    expect(getCountForSlug("test_window", now + 1_000, windowMs)).toBe(1);
    expect(getCountForSlug("test_window", now + windowMs + 1, windowMs)).toBe(0);
  });

  it("different slugs have independent counters", () => {
    const cat1 = makeCategory("slug_a", "notify-governor", "alert-loud");
    const cat2 = makeCategory("slug_b", "notify-governor", "alert-loud");
    setTaxonomyForTest(new Map([["slug_a", cat1], ["slug_b", cat2]]));
    const { deps, governorCalls, operatorCalls } = makeDeps();
    const now = 1_000_000;

    reportAnomaly({ slug: "slug_a" }, deps, DEFAULT_WINDOW_MS, now);
    reportAnomaly({ slug: "slug_b" }, deps, DEFAULT_WINDOW_MS, now + 100);
    reportAnomaly({ slug: "slug_a" }, deps, DEFAULT_WINDOW_MS, now + 200);  // slug_a count=2 → op
    reportAnomaly({ slug: "slug_b" }, deps, DEFAULT_WINDOW_MS, now + 300);  // slug_b count=2 → op

    expect(governorCalls).toHaveLength(2);  // one for each slug's first
    expect(operatorCalls).toHaveLength(2);  // one for each slug's second
  });
});

// ---------------------------------------------------------------------------
// AC4 — Normal-flow errors return null
// ---------------------------------------------------------------------------

describe("AC4: normal-flow errors return null", () => {
  it("returns null for LAST_SESSION error code", () => {
    const result = classifyAnomalyEvent({
      slug: "auth_repeated_failure",
      details: { errorCode: "LAST_SESSION" },
    });
    expect(result).toBeNull();
  });

  it("returns null for NOT_PENDING error code", () => {
    const result = classifyAnomalyEvent({
      slug: "rate_runaway_dequeue",
      details: { errorCode: "NOT_PENDING" },
    });
    expect(result).toBeNull();
  });

  it("returns null for SESSION_NOT_FOUND error code", () => {
    const result = classifyAnomalyEvent({
      slug: "session_unexpected_disconnect",
      details: { errorCode: "SESSION_NOT_FOUND" },
    });
    expect(result).toBeNull();
  });

  it("returns null for STREAM_EXPIRED error code", () => {
    const result = classifyAnomalyEvent({
      slug: "infra_sse_stream_drop",
      details: { errorCode: "STREAM_EXPIRED" },
    });
    expect(result).toBeNull();
  });

  it("returns null for NAME_CONFLICT error code", () => {
    const result = classifyAnomalyEvent({
      slug: "session_ghost",
      details: { errorCode: "NAME_CONFLICT" },
    });
    expect(result).toBeNull();
  });

  it("returns null for unknown slug (not in taxonomy)", () => {
    const result = classifyAnomalyEvent({ slug: "not_a_real_slug" });
    expect(result).toBeNull();
  });

  it("returns null when slug is empty string", () => {
    const result = classifyAnomalyEvent({ slug: "" });
    expect(result).toBeNull();
  });

  it("all NORMAL_FLOW_CODES are in the exclusion set", () => {
    for (const code of NORMAL_FLOW_CODES) {
      const result = classifyAnomalyEvent({
        slug: "auth_repeated_failure",   // valid slug
        details: { errorCode: code },
      });
      expect(result, `${code} should be excluded`).toBeNull();
    }
  });

  it("normal-flow codes cause reportAnomaly to return 'skipped'", () => {
    const { deps } = makeDeps();
    const outcome = reportAnomaly(
      {
        slug: "rate_runaway_dequeue",
        details: { errorCode: "NOT_PENDING" },
      },
      deps,
    );
    expect(outcome).toBe("skipped");
  });

  it("unknown slug causes reportAnomaly to return 'skipped'", () => {
    const { deps } = makeDeps();
    const outcome = reportAnomaly({ slug: "no_such_anomaly" }, deps);
    expect(outcome).toBe("skipped");
  });
});

// ---------------------------------------------------------------------------
// AC5 — Regression: repeated hook denial escalates on 2nd occurrence
// ---------------------------------------------------------------------------

describe("AC5: regression — repeated hook denial escalates on 2nd occurrence", () => {
  /**
   * In the TMCP bridge, "hook denial" corresponds to a governor-gate denial:
   * a session repeatedly receiving NOT_GOVERNOR / PERMISSION_DENIED errors.
   *
   * Category: auth_governor_gate_repeated
   *   action.first  = "log-only"       → no escalation on 1st occurrence
   *   action.second = "notify-governor" → escalation fires on 2nd occurrence
   *
   * This regression guards against the 2026-04-19 incident where Workers looped
   * through repeated denials silently for hours without escalating.
   */
  it("first hook denial only logs — no governor or operator notification", () => {
    const { deps, governorCalls, operatorCalls, logLines } = makeDeps();
    const now = 1_000_000;

    const outcome = reportAnomaly(
      { slug: "auth_governor_gate_repeated", sid: 7 },
      deps,
      DEFAULT_WINDOW_MS,
      now,
    );

    expect(outcome).toBe("log-only");
    expect(governorCalls).toHaveLength(0);
    expect(operatorCalls).toHaveLength(0);
    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toContain("auth_governor_gate_repeated");
  });

  it("second hook denial within window escalates to governor", () => {
    const { deps, governorCalls, operatorCalls } = makeDeps();
    const now = 1_000_000;

    // First denial — log only
    reportAnomaly(
      { slug: "auth_governor_gate_repeated", sid: 7 },
      deps,
      DEFAULT_WINDOW_MS,
      now,
    );

    // Second denial within window — must escalate
    const outcome = reportAnomaly(
      { slug: "auth_governor_gate_repeated", sid: 7, message: "Repeated hook denial detected" },
      deps,
      DEFAULT_WINDOW_MS,
      now + 30_000,  // 30 s later, well within 10 min window
    );

    expect(outcome).toBe("notify-governor");
    expect(governorCalls).toHaveLength(1);
    expect(operatorCalls).toHaveLength(0);
    expect(governorCalls[0].text).toContain("Repeated hook denial detected");
    expect(governorCalls[0].details?.count).toBe(2);
    expect(governorCalls[0].details?.slug).toBe("auth_governor_gate_repeated");
  });

  it("third hook denial within window is suppressed — no further notifications", () => {
    const { deps, governorCalls, operatorCalls } = makeDeps();
    const now = 1_000_000;

    reportAnomaly({ slug: "auth_governor_gate_repeated" }, deps, DEFAULT_WINDOW_MS, now);
    reportAnomaly({ slug: "auth_governor_gate_repeated" }, deps, DEFAULT_WINDOW_MS, now + 30_000);

    const outcome = reportAnomaly(
      { slug: "auth_governor_gate_repeated" },
      deps,
      DEFAULT_WINDOW_MS,
      now + 60_000,
    );

    expect(outcome).toBe("suppress");
    expect(governorCalls).toHaveLength(1);  // from 2nd only
    expect(operatorCalls).toHaveLength(0);
  });

  it("hook denial after window reset triggers a fresh log-only cycle", () => {
    const { deps, governorCalls, logLines } = makeDeps();
    const windowMs = 60_000; // 1 minute for faster test
    const now = 1_000_000;

    // Initial cycle
    reportAnomaly({ slug: "auth_governor_gate_repeated" }, deps, windowMs, now);            // log
    reportAnomaly({ slug: "auth_governor_gate_repeated" }, deps, windowMs, now + 10_000);   // gov
    reportAnomaly({ slug: "auth_governor_gate_repeated" }, deps, windowMs, now + 20_000);   // suppress

    // After window expires: new cycle starts
    const fresh = now + windowMs + 5_000;
    const outcome = reportAnomaly(
      { slug: "auth_governor_gate_repeated" },
      deps,
      windowMs,
      fresh,
    );

    expect(outcome).toBe("log-only");       // fresh window → count=1 → log-only
    expect(governorCalls).toHaveLength(1);  // only from original 2nd occurrence
    // log lines: initial 1st (log-only) + suppress (3rd in cycle) + fresh 1st (log-only)
    expect(logLines).toHaveLength(3);
  });

  it("hook denial does NOT fire when errorCode is a normal-flow code", () => {
    const { deps, governorCalls, operatorCalls } = makeDeps();
    const now = 1_000_000;

    const event: AnomalyEvent = {
      slug: "auth_governor_gate_repeated",
      details: { errorCode: "SESSION_NOT_FOUND" },
    };

    const outcome = reportAnomaly(event, deps, DEFAULT_WINDOW_MS, now);
    expect(outcome).toBe("skipped");
    expect(governorCalls).toHaveLength(0);
    expect(operatorCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("auto-remediate action fires alertOperator", async () => {
    useSingleCategory("test_auto", "alert-loud", "auto-remediate");
    const { deps, operatorCalls } = makeDeps();
    const now = 1_000_000;

    reportAnomaly({ slug: "test_auto" }, deps, DEFAULT_WINDOW_MS, now);           // count=1 → alert
    await Promise.resolve(); // flush microtasks
    reportAnomaly({ slug: "test_auto" }, deps, DEFAULT_WINDOW_MS, now + 1_000);   // count=2 → auto-remediate

    // Wait for async send
    await new Promise((r) => setTimeout(r, 0));

    expect(operatorCalls).toHaveLength(2);
    expect(operatorCalls[1]).toContain("auto-remediate");
  });

  it("reportAnomaly accepts optional custom message", () => {
    useSingleCategory("test_msg", "notify-governor", "alert-loud");
    const { deps, governorCalls } = makeDeps();

    reportAnomaly(
      { slug: "test_msg", message: "Custom anomaly description" },
      deps,
      DEFAULT_WINDOW_MS,
      1_000_000,
    );

    expect(governorCalls[0].text).toContain("Custom anomaly description");
  });

  it("events to the same slug in different sessions share the counter", () => {
    useSingleCategory("test_shared", "notify-governor", "alert-loud");
    const { deps, governorCalls, operatorCalls } = makeDeps();
    const now = 1_000_000;

    reportAnomaly({ slug: "test_shared", sid: 1 }, deps, DEFAULT_WINDOW_MS, now);
    reportAnomaly({ slug: "test_shared", sid: 2 }, deps, DEFAULT_WINDOW_MS, now + 100);

    expect(governorCalls).toHaveLength(1);
    expect(operatorCalls).toHaveLength(1);
  });
});
