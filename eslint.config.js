// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Ignored paths
  { ignores: ["dist/**", "coverage/**", "temp/**"] },

  // Strict + type-checked: every recommended rule plus stricter alternatives.
  // Requires the TypeScript compiler (slower) but catches far more issues.
  ...tseslint.configs.strictTypeChecked,

  // Type-aware linting. Uses tsconfig.eslint.json which includes test files.
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Project-specific rule tuning — keep every rule active but allow
  // number/boolean coercion in templates (safe, well-defined, not a bug).
  {
    rules: {
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],

      // Allow unused args/vars when prefixed with _
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Test files: relax strict type-safety rules.
  // Tests intentionally use mocks, non-null assertions, and partial
  // type casts that don't reflect production safety concerns.
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // Partial mock objects don't match full type shapes — guards
      // that are "unnecessary" per the type may be required at runtime.
      "@typescript-eslint/no-unnecessary-condition": "off",
      // Mock method references are intentionally separated from their
      // objects in assertions (e.g. expect(mock.method).toHaveBeenCalled).
      "@typescript-eslint/unbound-method": "off",
    },
  },
);
