# 0001 — Vite+ for lint + format in generated projects

Date: 2026-10-18. Status: accepted.

## Decision

Generated projects use the project-local `vite-plus` package (1.3.0) for
linting and formatting, configured in a root `vite.config.ts` (`lint` +
`fmt` blocks). Root scripts: `lint` = `vp lint`, `format` = `vp fmt`,
`check` = `vp check`. Biome is removed from generated projects.

Turborepo stays as the task runner (`dev`, `build`, `typecheck`, `test`
keep running through `turbo run`). Vitest stays as-is per package
(`vp test` is the same Vitest 5.0.5 build; switching buys nothing).

Effect diagnostics come from `@effect/tsgo` (0.53.4), not
`@effect/language-service`: the language-service README says to use tsgo
on TypeScript 7+. Wired per tsgo's official setup — devDeps, a `prepare`
patch script, the tsconfig plugin entry — with the Oxlint rules expressed
in the `lint` block instead of `.oxlintrc.json`.

## Evidence (probed 2026-10-18, not just read)

- `vite-plus@1.3.0` bundles vite 8.3.4, vitest 5.0.5, oxlint 1.88.0,
  oxlint-tsgolint 7.0.2004 (`vp toolchain`). Vitest and Vite match our
  existing pins exactly, so no version churn.
- `lint.categories`, `lint.rules`, `lint.plugins`, `fmt` options and both
  `ignorePatterns` verified working via `vp lint --print-config`, including
  `categories: { correctness: "error", ... }` failing with exit 1.
- `vp fmt` defaults to writing in place; `fmt: { semi: false,
  singleQuote: true, printWidth: 100 }` reproduces the current Biome look
  (verified on a sample file), so template churn stays small.
- tsgo's supported-components table lists exactly typescript 7.0.2,
  oxlint 1.86–1.88, oxlint-tsgolint 7.0.2003/2004 — all satisfied, with
  oxlint/tsgolint shared (deduped) with vite-plus 1.3.0's bundle.
- `effect-tsgo patch --oxlint` patches the shared pnpm-store copy that
  `vp lint` also resolves; `plugins: ["effecttsgo"]` + an
  `effecttsgo/*` rule in the `lint` block fires through `vp lint`
  (verified: `return-effect-in-gen` reported as error). Without the
  `plugins` entry the rule is silently dropped — so the plugin must be
  declared, not just the rules.
- Full `patch --typescript --oxlint` keeps stock `tsc --noEmit` working
  (exit 0; Effect findings surface as suggestions) — verified.
- The tsconfig `"plugins": [{ "name": "@effect/language-service" }]`
  entry is tolerated by stock tsc (verified: no plugin error).

## Why Turborepo stays

`vp run` runs scripts with caching and workspace awareness, but adopting
it means re-expressing `turbo.json` pipeline semantics (topological
`dependsOn`, persistent `dev`, `outputs`) in Vite Task config and
re-verifying caching on every stack. No clear simplification, so per the
task's decision rule we keep Turborepo and revisit only if it hurts.

## Consequences

- `src/versions.ts` pins `vite-plus`, `oxlint`, `oxlint-tsgolint`,
  `@effect/tsgo`; drops `@biomejs/biome`.
- Root `vite.config.ts` is a lint/format-only config (`defineConfig`
  from `vite-plus`); `apps/web/vite.config.ts` keeps the app build config
  (Vite+ never applies nested lint/fmt blocks per file, root wins).
- Effect rules use the tsgo `recommended` preset defaults (warn); our bar
  is zero warnings on generated code, fixed in templates.
- `prepare: effect-tsgo patch --typescript --oxlint` mutates
  node_modules binaries on install (tsgo's documented flow); if a future
  vite-plus/oxlint bump leaves the supported table, `vp check` still runs
  but Effect rules go quiet — `scripts/bump.ts` must check the table.
- Add-ons extend lint via `lint.overrides` entries and AGENTS.md via the
  `appendAgentsSection` transform (see task report).

## Implementation notes (added on completion)

- `tsconfig.base.json` sets `diagnosticSeverity.unstableApiUsage: "off"`: stock
  `tsc` exits 1 on that warning (e.g. `@effect/vitest`), unlike plain suggestions.
- The root `vite.config.ts` turns `effecttsgo/strict-effect-provide` off only for
  entry points (`server/runtime.ts`, `packages/*/scripts/**`).
- `AGENTS.md` carries an `<!-- efforge:agents -->` footer; add-ons insert sections
  above it with `appendAgentsSection { id, content }` (idempotent per id).
- Sandbox note: `/tmp` here is quota-limited and a parent `.gitignore` of `*` makes
  oxfmt see no files, so verify in a dir outside `$HOME` and `/tmp` (e.g. `/var/tmp`).
