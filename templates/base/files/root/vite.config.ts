import { defineConfig } from "vite-plus"

// Lint and format live here. Contributors and agents run `pnpm check`
// (format + lint + typecheck); `pnpm lint` / `pnpm format` run one step.
// The Effect rules need a patched install: `pnpm install` runs the
// `prepare` script for that. Unpatched oxlint rejects the config.
export default defineConfig({
  lint: {
    ignorePatterns: [
      "**/dist/**",
      "**/.turbo/**",
      "**/.wrangler/**",
      "**/routeTree.gen.ts",
      "**/package-lock.json",
    ],
    categories: { correctness: "error", suspicious: "error", perf: "error" },
    // an explicit list replaces oxlint's defaults, so keep oxc/typescript/unicorn
    plugins: ["oxc", "typescript", "unicorn", "react", "import", "effecttsgo"],
    jsPlugins: ["./lint/effect-tests.js", "./lint/efforge.js"],
    options: { typeAware: true, typeCheck: true },
    rules: {
      "typescript/no-explicit-any": "error",
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "typescript/no-deprecated": "error",
      "no-unused-vars": "error",
      "react/exhaustive-deps": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      eqeqeq: "error",
      "no-nested-ternary": "error",
      // every tsconfig sets jsx: react-jsx, so React is never imported for JSX
      "react/react-in-jsx-scope": "off",
      // Effect's tagged values are matched on `_tag` (Data.TaggedEnum, Data.TaggedError)
      "no-underscore-dangle": ["error", { allow: ["_tag"] }],
      // exact pins make "unstable" and "experimental" Effect APIs safe (an upgrade is
      // a deliberate step); the first flags it.effect itself
      "effecttsgo/unstable-api-usage": "off",
      "effecttsgo/experimental-api-usage": "off",
      // bindings reach code through effect-cf layers; cloudflare.ts is the one file that reads env
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "cloudflare:workers",
              importNames: ["env"],
              message:
                "Read bindings through effect-cf layers; only server/cloudflare.ts reads env.",
            },
          ],
        },
      ],
    },
    overrides: [
      {
        files: ["apps/web/**"],
        rules: {
          // with auth, sessionGate runs before every server function (apps/web/src/start.ts);
          // this rule is early feedback: a function without `.middleware([requireSession])` is an
          // error unless it is in the public list, which the runtime reads too
          "efforge/server-fn-session": [
            "error",
            { publicList: "apps/web/src/server/public-server-fns.json" },
          ],
          // only ?region=<name> may import a file as text; the rest would ship it to the browser
          "efforge/no-whole-file-import": [
            "error",
            { allow: { "apps/web/src/server/manifest.ts": ["../../../../efforge.jsonc?raw"] } },
          ],
        },
      },
      {
        // shared packages reach the browser too, through the app's imports
        files: ["packages/**"],
        rules: { "efforge/no-whole-file-import": "error" },
      },
      {
        files: ["**/*.test.ts", "**/*.test.tsx"],
        rules: { "effect-tests/no-manual-runtime": "error" },
      },
      {
        // TypeScript checks default imports; this rule cannot see the default export of the
        // `?region=card` modules (apps/web/regions.ts) the dashboard shows source with. A card
        // may show its own client lines (`./runtime.tsx?region=card`): a module of its own, not
        // a self-import
        files: ["apps/web/src/capabilities/**", "apps/web/src/routes/app/index.tsx"],
        rules: { "import/default": "off", "import/no-self-import": "off" },
      },
      {
        files: ["apps/web/src/server/cloudflare.ts"],
        rules: { "no-restricted-imports": "off" },
      },
      {
        // entry points are where layers get provided: the server runtime and one-off scripts
        files: ["apps/web/src/server/runtime.ts", "packages/*/scripts/**"],
        rules: { "effecttsgo/strict-effect-provide": "off" },
      },
      {
        // seam file: add-ons re-export their services from here, so minimal stacks leave it empty
        files: ["packages/core/src/index.ts"],
        rules: { "unicorn/no-empty-file": "off" },
      },
    ],
  },
  fmt: {
    ignorePatterns: [
      "**/dist/**",
      "**/.turbo/**",
      "**/.wrangler/**",
      "**/routeTree.gen.ts",
      "**/package-lock.json",
      // generated or edited by efforge transforms (JSONC with trailing commas the formatter adds)
      "efforge.jsonc",
      "wrangler.jsonc",
    ],
    semi: false,
    printWidth: 100,
  },
})
