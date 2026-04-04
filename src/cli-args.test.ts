import { describe, it, expect } from "vitest";
import { resolveHttpPort } from "./cli-args.js";

describe("resolveHttpPort", () => {
  it("returns undefined when no --http flag and no MCP_PORT", () => {
    expect(resolveHttpPort(["node", "index.js"], {})).toBeUndefined();
  });

  it("returns 3099 default when --http with no port argument", () => {
    expect(resolveHttpPort(["node", "index.js", "--http"], {})).toBe(3099);
  });

  it("returns explicit port when --http <port>", () => {
    expect(resolveHttpPort(["node", "index.js", "--http", "4000"], {})).toBe(4000);
  });

  it("throws on invalid port after --http", () => {
    expect(() => resolveHttpPort(["node", "index.js", "--http", "0"], {})).toThrow();
    expect(() => resolveHttpPort(["node", "index.js", "--http", "99999"], {})).toThrow();
  });

  it("treats --http <next-flag> as --http with default port", () => {
    expect(resolveHttpPort(["node", "index.js", "--http", "--verbose"], {})).toBe(3099);
  });

  it("falls through to MCP_PORT env when no --http", () => {
    expect(resolveHttpPort(["node", "index.js"], { MCP_PORT: "4000" })).toBe(4000);
  });

  it("--http takes precedence over MCP_PORT env var", () => {
    expect(resolveHttpPort(["node", "index.js", "--http", "5000"], { MCP_PORT: "4000" })).toBe(5000);
  });

  it("--http default takes precedence over MCP_PORT env var", () => {
    expect(resolveHttpPort(["node", "index.js", "--http"], { MCP_PORT: "4000" })).toBe(3099);
  });

  it("throws on invalid MCP_PORT", () => {
    expect(() => resolveHttpPort(["node", "index.js"], { MCP_PORT: "not-a-port" })).toThrow();
    expect(() => resolveHttpPort(["node", "index.js"], { MCP_PORT: "0" })).toThrow();
  });

  it("throws when --http is followed by a non-numeric non-flag value", () => {
    expect(() => resolveHttpPort(["node", "index.js", "--http", "foo"], {})).toThrow();
  });
});
