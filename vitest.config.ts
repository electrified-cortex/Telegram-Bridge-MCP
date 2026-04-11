import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts"],
    exclude: ["src/tools/_retired/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/index.ts",
        "src/setup.ts",
        "src/tools/test-utils.ts",
        "src/test-setup.ts",
        // Runtime entrypoint — not unit-testable
        "src/server.ts",
        // Low-level audio codec — integration-level concern, no unit tests
        "src/ogg-opus-encoder.ts",
        // Tool registration stubs with no logic
        "src/tools/shutdown.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
});
