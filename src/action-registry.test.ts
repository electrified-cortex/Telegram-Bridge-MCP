import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerAction,
  resolveAction,
  listCategories,
  listSubPaths,
  clearRegistry,
} from "./action-registry.js";

describe("action-registry", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("resolves a registered handler by exact path", () => {
    const handler = vi.fn();
    registerAction("session/list", handler);
    const entry = resolveAction("session/list");
    expect(entry).toBeDefined();
    expect(entry!.handler).toBe(handler);
  });

  it("returns undefined for an unregistered path", () => {
    const entry = resolveAction("session/list");
    expect(entry).toBeUndefined();
  });

  it("lists distinct categories from registered paths", () => {
    registerAction("session/start", vi.fn());
    registerAction("session/list", vi.fn());
    registerAction("config/voice", vi.fn());
    registerAction("message/edit", vi.fn());
    expect(listCategories()).toEqual(["config", "message", "session"]);
  });

  it("returns empty categories when nothing is registered", () => {
    expect(listCategories()).toEqual([]);
  });

  it("lists sub-paths for a given category", () => {
    registerAction("session/start", vi.fn());
    registerAction("session/close", vi.fn());
    registerAction("session/list", vi.fn());
    registerAction("config/voice", vi.fn());
    expect(listSubPaths("session")).toEqual([
      "session/close",
      "session/list",
      "session/start",
    ]);
  });

  it("returns empty sub-paths for an unrecognized category", () => {
    registerAction("session/list", vi.fn());
    expect(listSubPaths("unknown")).toEqual([]);
  });

  it("stores meta.governor flag when provided", () => {
    registerAction("log/get", vi.fn(), { governor: true });
    const entry = resolveAction("log/get");
    expect(entry?.meta.governor).toBe(true);
  });

  it("defaults meta.governor to falsy when not provided", () => {
    registerAction("session/list", vi.fn());
    const entry = resolveAction("session/list");
    expect(entry?.meta.governor).toBeFalsy();
  });

  it("clearRegistry removes all entries", () => {
    registerAction("session/list", vi.fn());
    clearRegistry();
    expect(resolveAction("session/list")).toBeUndefined();
    expect(listCategories()).toEqual([]);
  });
});
