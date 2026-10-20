# Changelog

## Unreleased

### Added

- Generated projects lint two rules that `AGENTS.md` only described before: `Effect.run*` and `ManagedRuntime.make` in test files (a local oxlint plugin, `lint/effect-tests.js`), and importing `env` from `cloudflare:workers` outside `server/cloudflare.ts`.
- Generated projects lint `typescript/no-deprecated` and `typescript/no-misused-promises`.
- The generated `AGENTS.md` has a Tests section and asks for lifecycles as tagged states. See `docs/decisions/0003-rat-stack-learnings.md`.

### Changed

- The `effect-ai-byok` crypto test uses `it.effect` instead of `Effect.runPromise`.
- Template forms and buttons use React's `SubmitEvent` instead of the deprecated `FormEvent`, and wrap async handlers as `() => void handler()`.

## 0.1.0 (2026-10-19)

First release.

### Added

- `npm create efforge` (also `efforge`): interactive and flag-driven scaffolding of an Effect 4 + TanStack Start + Cloudflare monorepo, with `--dry-run`, `--json`, `--yes`, `--install` and `--git`.
- Slots: `runtime` (cloudflare), `database` (postgres, d1, none), `orm` (drizzle, effect-sql, none), `auth` (better-auth-orgs, better-auth, none), `infra` (none, alchemy), `ai` (none, effect-ai-byok) and multi-select `extras` (workflows, realtime, browser, storage, email), with compatibility rules.
- `efforge add <id...>` to add an add-on to an existing project, using idempotent AST transforms and hash-tracked generated files (`efforge.jsonc`).
- Generated projects: pnpm workspace with a pinned `catalog:`, Turborepo, `@effect/vitest`, Tailwind v4 + shadcn/ui, an `AGENTS.md`, and Vite+ lint and format with Effect diagnostics.
- `scripts/bump.ts` compares the pins in `src/versions.ts` with npm; `scripts/e2e-cases.ts` lists the e2e matrix.
- CI: unit job, one e2e job per stack, a browser-image build and the browser flow with a Postgres service.

### Fixed

- Generated projects with `alchemy` installed two vitest copies, so `pnpm test` failed in `@effect/vitest`. The generated `pnpm-workspace.yaml` now overrides `vite` to the catalog version.

- `efforge add` for storage, realtime, email and ai (each transform declares the files it edits), `extras/browser` (new workspace package), `infra/alchemy` (removes `wrangler.jsonc`, applies scripts and wires existing add-ons' secrets).
- Templates and transform output are already formatted, so `pnpm check` passes right after `create --no-install`; a test runs the formatter over `templates/` and generated stacks.

### Changed

- The root `package.json` is named `<name>-monorepo`, so it cannot clash with a workspace package called `<name>`.
- The formatter uses double quotes (no `singleQuote`) to match the templates.

- efforge's own repo uses Vite+ (`vp lint`, `vp fmt`) instead of Biome.
- The e2e helper runs the generated project's full gate: `typecheck`, `check`, `test`, `build`.

### Known limits

- Cloudflare is the only runtime.
- `alchemy` is a beta (`2.0.0-beta.83`) and `drizzle-orm`/`drizzle-kit` are pinned to a release candidate.
