import { describe, it, expect, beforeEach } from "vitest";
import {
  setGovernorSid,
  getGovernorSid,
  resetRoutingModeForTest,
} from "./routing-mode.js";

describe("routing-mode", () => {
  beforeEach(() => {
    resetRoutingModeForTest();
  });

  it("defaults to no governor (0)", () => {
    expect(getGovernorSid()).toBe(0);
  });

  it("sets and gets governor SID", () => {
    setGovernorSid(3);
    expect(getGovernorSid()).toBe(3);
  });

  it("updates governor SID", () => {
    setGovernorSid(1);
    setGovernorSid(5);
    expect(getGovernorSid()).toBe(5);
  });

  it("clears governor SID when set to 0", () => {
    setGovernorSid(3);
    setGovernorSid(0);
    expect(getGovernorSid()).toBe(0);
  });

  it("resets to default (no governor)", () => {
    setGovernorSid(2);
    resetRoutingModeForTest();
    expect(getGovernorSid()).toBe(0);
  });
});
