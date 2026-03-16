import { vi, beforeEach } from "vitest";

// Suppress the ALLOWED_USER_ID startup warnings globally in
// the test suite.  ALLOW_ALL_USERS=true acts as a safety valve so that any
// test that calls getSecurityConfig() without setting ALLOWED_USER_ID won't
// trigger the process.exit(1) guard introduced in this version.
// Tests that exercise the security filtering explicitly manage env vars and
// call resetSecurityConfig() in their own beforeEach/afterEach.
process.env.ALLOW_ALL_USERS = "true";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
