/**
 * Tests for service-message text layout.
 *
 * For multi-attribute events each attribute must appear on its own line with a
 * **bold label:**. Single-attribute events (no labels, plain prose) keep their
 * current inline form. Tests snapshot the exact output so regressions in
 * whitespace or label wording are caught immediately.
 */
import { describe, it, expect } from "vitest";
import { SERVICE_MESSAGES } from "./service-messages.js";

// ---------------------------------------------------------------------------
// SESSION_CLOSED — 2 attributes (name + SID) → vertical
// ---------------------------------------------------------------------------
describe("SERVICE_MESSAGES.SESSION_CLOSED layout", () => {
  it("renders name and SID on separate labeled lines", () => {
    const text = SERVICE_MESSAGES.SESSION_CLOSED.text("Overseer", 2);
    expect(text).toMatchInlineSnapshot(`
      "**Session closed:**
      **Name:** Overseer
      **SID:** 2"
    `);
  });

  it("event type is session_closed", () => {
    expect(SERVICE_MESSAGES.SESSION_CLOSED.eventType).toBe("session_closed");
  });

  it("contains session name", () => {
    const text = SERVICE_MESSAGES.SESSION_CLOSED.text("Alpha", 5);
    expect(text).toContain("Alpha");
  });

  it("contains SID value", () => {
    const text = SERVICE_MESSAGES.SESSION_CLOSED.text("Beta", 7);
    expect(text).toContain("7");
  });

  it("each attribute is on its own line", () => {
    const text = SERVICE_MESSAGES.SESSION_CLOSED.text("Worker", 3);
    const lines = text.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.some(l => l.includes("Worker"))).toBe(true);
    expect(lines.some(l => l.includes("3"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SESSION_CLOSED_NEW_GOVERNOR — 3 attributes → vertical
// ---------------------------------------------------------------------------
describe("SERVICE_MESSAGES.SESSION_CLOSED_NEW_GOVERNOR layout", () => {
  it("renders closed name, new governor SID and name on separate lines", () => {
    const text = SERVICE_MESSAGES.SESSION_CLOSED_NEW_GOVERNOR.text("Overseer", 1, "Primary");
    expect(text).toMatchInlineSnapshot(`
      "**Session closed:** Overseer
      **New governor:**
      **SID:** 1
      **Name:** Primary"
    `);
  });

  it("event type is session_closed_new_governor", () => {
    expect(SERVICE_MESSAGES.SESSION_CLOSED_NEW_GOVERNOR.eventType).toBe("session_closed_new_governor");
  });

  it("contains all three data values", () => {
    const text = SERVICE_MESSAGES.SESSION_CLOSED_NEW_GOVERNOR.text("Scout", 4, "Command");
    expect(text).toContain("Scout");
    expect(text).toContain("4");
    expect(text).toContain("Command");
  });
});

// ---------------------------------------------------------------------------
// SESSION_JOINED — 2 attributes (name + SID) → vertical
// ---------------------------------------------------------------------------
describe("SERVICE_MESSAGES.SESSION_JOINED layout", () => {
  it("renders name and SID on separate labeled lines", () => {
    const text = SERVICE_MESSAGES.SESSION_JOINED.text("Worker", 3);
    expect(text).toMatchInlineSnapshot(`
      "**Session joined:**
      **Name:** Worker
      **SID:** 3
      You are the governor — route ambiguous messages."
    `);
  });

  it("event type is session_joined", () => {
    expect(SERVICE_MESSAGES.SESSION_JOINED.eventType).toBe("session_joined");
  });
});

// ---------------------------------------------------------------------------
// SESSION_JOINED_FELLOW — inline prose (non-governor path)
// ---------------------------------------------------------------------------
describe("SERVICE_MESSAGES.SESSION_JOINED_FELLOW layout", () => {
  it("renders name, SID, and governor label", () => {
    const text = SERVICE_MESSAGES.SESSION_JOINED_FELLOW.text("Worker", 3, "'Curator' (SID 1)");
    expect(text).toBe("Worker (SID 3) joined. Ambiguous messages go to 'Curator' (SID 1).");
  });

  it("works when governorLabel is SID-only (no governor session name)", () => {
    const text = SERVICE_MESSAGES.SESSION_JOINED_FELLOW.text("Worker", 3, "SID 1");
    expect(text).toBe("Worker (SID 3) joined. Ambiguous messages go to SID 1.");
  });

  it("event type is session_joined", () => {
    // Intentionally shares "session_joined" with SESSION_JOINED — same bridge event, different text.
    expect(SERVICE_MESSAGES.SESSION_JOINED_FELLOW.eventType).toBe("session_joined");
  });

  it("empty name produces leading space (pinned degenerate behavior)", () => {
    // name = "" results in a leading space before "(SID 3)" — pinned so regressions are caught.
    const text = SERVICE_MESSAGES.SESSION_JOINED_FELLOW.text("", 3, "'Curator' (SID 1)");
    expect(text).toBe(" (SID 3) joined. Ambiguous messages go to 'Curator' (SID 1).");
  });

  it("empty governorLabel produces trailing period with no label (pinned degenerate behavior)", () => {
    // governorLabel = "" results in a trailing "go to ." — pinned so regressions are caught.
    const text = SERVICE_MESSAGES.SESSION_JOINED_FELLOW.text("Worker", 3, "");
    expect(text).toBe("Worker (SID 3) joined. Ambiguous messages go to .");
  });
});

// ---------------------------------------------------------------------------
// GOVERNOR_CHANGED — 2 attributes → vertical
// ---------------------------------------------------------------------------
describe("SERVICE_MESSAGES.GOVERNOR_CHANGED layout", () => {
  it("renders SID and name on separate labeled lines", () => {
    const text = SERVICE_MESSAGES.GOVERNOR_CHANGED.text(3, "Command");
    expect(text).toMatchInlineSnapshot(`
      "**New governor:**
      **SID:** 3
      **Name:** Command"
    `);
  });

  it("event type is governor_changed", () => {
    expect(SERVICE_MESSAGES.GOVERNOR_CHANGED.eventType).toBe("governor_changed");
  });
});

// ---------------------------------------------------------------------------
// GOVERNOR_PROMOTED_SINGLE — vertical
// ---------------------------------------------------------------------------
describe("SERVICE_MESSAGES.GOVERNOR_PROMOTED_SINGLE layout", () => {
  it("renders closed session name on its own labeled line", () => {
    const text = SERVICE_MESSAGES.GOVERNOR_PROMOTED_SINGLE.text("Overseer");
    expect(text).toMatchInlineSnapshot(`
      "**You are now the governor.**
      **Closed session:** Overseer
      Single-session mode restored."
    `);
  });

  it("event type is governor_promoted", () => {
    expect(SERVICE_MESSAGES.GOVERNOR_PROMOTED_SINGLE.eventType).toBe("governor_promoted");
  });
});

// ---------------------------------------------------------------------------
// GOVERNOR_PROMOTED_MULTI — vertical
// ---------------------------------------------------------------------------
describe("SERVICE_MESSAGES.GOVERNOR_PROMOTED_MULTI layout", () => {
  it("renders closed session name on its own labeled line", () => {
    const text = SERVICE_MESSAGES.GOVERNOR_PROMOTED_MULTI.text("Overseer");
    expect(text).toMatchInlineSnapshot(`
      "**You are now the governor.**
      **Closed session:** Overseer
      Ambiguous messages will be routed to you."
    `);
  });

  it("event type is governor_promoted", () => {
    expect(SERVICE_MESSAGES.GOVERNOR_PROMOTED_MULTI.eventType).toBe("governor_promoted");
  });
});

// ---------------------------------------------------------------------------
// pending_approval message layout (composed in session_start.ts)
// ---------------------------------------------------------------------------
describe("pending_approval service message layout", () => {
  /**
   * Build the pending_approval text the same way session_start.ts does.
   * Kept here as a pure-function snapshot so we catch formatting regressions
   * without needing to spin up the full session machinery.
   */
  function buildPendingApprovalText(name: string, ticket: string): string {
    return (
      `**Pending approval:**\n**Session:** ${name}\n**Ticket:** ${ticket}\n` +
      `**Action:** action(type: 'approve', token: <your_token>, ticket: ${ticket})`
    );
  }

  it("renders session name and ticket on separate labeled lines", () => {
    const text = buildPendingApprovalText("Worker", "abc123");
    expect(text).toMatchInlineSnapshot(`
      "**Pending approval:**
      **Session:** Worker
      **Ticket:** abc123
      **Action:** action(type: 'approve', token: <your_token>, ticket: abc123)"
    `);
  });

  it("contains the approve action hint", () => {
    const text = buildPendingApprovalText("Scout", "xyz789");
    expect(text).toContain("action(type: 'approve'");
    expect(text).toContain("xyz789");
    expect(text).toContain("Scout");
  });

  it("each piece of information is on its own line", () => {
    const text = buildPendingApprovalText("Curator", "t42");
    const lines = text.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// shutdown_warn (notify_shutdown_warning) message layout
// ---------------------------------------------------------------------------
describe("shutdown_warn message layout", () => {
  const SHUTDOWN_CLEANUP =
    "**Action required:**\n" +
    "(1) finish current task\n" +
    "(2) delete stored session token from memory\n" +
    "(3) call action(type: \"session/close\") to close cleanly\n" +
    "(4) do NOT retry — session is being terminated.";

  const BASE_WARNING =
    "⛔ **Shutdown warning:** session termination imminent.\n" +
    SHUTDOWN_CLEANUP;

  function buildShutdownWarnText(reason?: string, wait_seconds?: number): string {
    const parts: string[] = [BASE_WARNING];
    if (reason) parts.push(`**Reason:** ${reason}`);
    if (typeof wait_seconds === "number") {
      parts.push(`**Shutdown in:** ~${wait_seconds}s`);
    }
    return parts.join("\n");
  }

  it("base warning contains session termination notice and action steps", () => {
    const text = buildShutdownWarnText();
    expect(text).toMatchInlineSnapshot(`
      "⛔ **Shutdown warning:** session termination imminent.
      **Action required:**
      (1) finish current task
      (2) delete stored session token from memory
      (3) call action(type: "session/close") to close cleanly
      (4) do NOT retry — session is being terminated."
    `);
  });

  it("with reason and wait_seconds renders each on its own labeled line", () => {
    const text = buildShutdownWarnText("code update", 60);
    expect(text).toMatchInlineSnapshot(`
      "⛔ **Shutdown warning:** session termination imminent.
      **Action required:**
      (1) finish current task
      (2) delete stored session token from memory
      (3) call action(type: "session/close") to close cleanly
      (4) do NOT retry — session is being terminated.
      **Reason:** code update
      **Shutdown in:** ~60s"
    `);
  });

  it("with reason only renders reason on labeled line", () => {
    const text = buildShutdownWarnText("config change");
    expect(text).toContain("**Reason:** config change");
    expect(text).not.toContain("**Shutdown in:**");
  });

  it("with wait_seconds only renders countdown on labeled line", () => {
    const text = buildShutdownWarnText(undefined, 30);
    expect(text).toContain("**Shutdown in:** ~30s");
    expect(text).not.toContain("**Reason:**");
  });

  it("contains session/close instruction for agent compliance", () => {
    const text = buildShutdownWarnText();
    expect(text).toContain("session/close");
  });

  it("contains token deletion instruction", () => {
    const text = buildShutdownWarnText();
    expect(text).toContain("delete stored session token");
  });

  it("session termination notice is present", () => {
    const text = buildShutdownWarnText();
    expect(text).toContain("session termination imminent");
  });
});

// ---------------------------------------------------------------------------
// Single-attribute events — keep inline form (regression guard)
// ---------------------------------------------------------------------------
describe("single-attribute events stay inline", () => {
  it("SHUTDOWN has no line breaks (single status notice)", () => {
    expect(SERVICE_MESSAGES.SHUTDOWN.text).not.toContain("\n");
  });

  it("ONBOARDING_TOKEN_SAVE has no label prefix", () => {
    expect(SERVICE_MESSAGES.ONBOARDING_TOKEN_SAVE.text).not.toMatch(/^\*\*/);
  });
});
