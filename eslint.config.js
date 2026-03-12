// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Ignored paths
  { ignores: ["dist/**", "coverage/**", "temp/**"] },

  // Strict + type-checked: all recommended rules plus stricter alternatives.
  // Requires the TypeScript compiler (slower) but catches far more issues.
  ...tseslint.configs.strictTypeChecked,

  // Enable type-aware linting via project service
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
  },

  // Project-specific overrides
  {
    rules: {
      // Allow unused args when prefixed with _
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
