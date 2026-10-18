import { defineConfig } from "vite-plus"

// efforge's own lint + format (Vite+), as in the projects it generates; tests run through
// vitest.config.ts. Generated templates are not linted here: they are verified by generating
// and checking real projects (test:e2e).
const ignorePatterns = [
  "dist/**",
  "out/**",
  ".e2e/**",
  "spike/**",
  "templates/**",
  "test/fixtures/templates/**",
  "pnpm-lock.yaml",
  "docs/**",
  "**/*.md",
]

export default defineConfig({
  lint: {
    ignorePatterns,
    categories: { correctness: "error", suspicious: "error", perf: "error" },
    plugins: ["oxc", "typescript", "unicorn", "import"],
    options: { typeAware: true, typeCheck: true },
    rules: {
      "typescript/no-explicit-any": "error",
      "typescript/no-floating-promises": "error",
      "no-unused-vars": "error",
      "prefer-const": "error",
      eqeqeq: "error",
      // deliberate: the codebase narrows with `as` after checks, and tests index into fixtures
      "typescript/no-unsafe-type-assertion": "off",
      // `_` prefixes mark intentionally unused names; sequential awaits in loops are intended
      "no-underscore-dangle": "off",
      "no-await-in-loop": "off",
      // Effect.gen bodies return early without a value; accumulators here are tiny
      "typescript/consistent-return": "off",
      "unicorn/consistent-function-scoping": "off",
      "oxc/no-accumulating-spread": "off",
    },
  },
  fmt: {
    ignorePatterns,
    semi: false,
    printWidth: 100,
  },
})
