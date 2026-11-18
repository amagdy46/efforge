# Changelog

## Unreleased

### Added

- A new identity: a maker's punch with ef struck through it replaces the ember logo. The README header, social preview and avatar use it, and `docs/brand.md` is the brand guide.
- Generated apps get a placeholder favicon (`apps/web/public/favicon.svg`) and a "made with efforge" badge in their README.
- `create`, `add` and `list` start with one line: an `ef` cell and the version. It is plain text under `NO_COLOR`, in a pipe and in CI. `--json` prints none of it.
- `pnpm brand` regenerates every brand asset, the README header and the generated README's badge line from `scripts/brand/source.ts`, and a test fails when any of them is stale.

## 0.2.1 (2026-11-18)

`npm create efforge` starts again, and new projects with a database or realtime build again. Generated projects now use Effect 4.1.4.

If you created a project with 0.2.0 and `pnpm build` fails with `failed to resolve import "effect/..."`, two Effect versions are installed side by side. Any `efforge add` run with 0.2.1 repairs it. To repair it by hand:

- In the root `package.json`, set `"packageManager": "pnpm@12.21.0"` (the overrides need pnpm 12.17 or later).
- In `pnpm-workspace.yaml`, add the overrides below under `overrides:`, set to your catalog's `effect` (4.0.5 for 0.2.0), then run `pnpm install`.

```yaml
  effect@>=4.0.0-0: 4.0.5
  "@effect/ai-*": 4.0.5
  "@effect/atom-*": 4.0.5
  "@effect/openapi-generator": 4.0.5
  "@effect/opentelemetry": 4.0.5
  "@effect/platform-*": 4.0.5
  "@effect/sql-*": 4.0.5
  "@effect/vitest": 4.0.5
```

### Added

- `pnpm smoke:pack` packs the CLI, installs the tarball with npm in an empty directory, runs it through npm, npx and pnpm dlx, then creates the default stack, builds it, adds email and builds again. Releases run it on the tarball they publish.
- CI runs daily and on demand without the pnpm cache, runs the packed-tarball smoke test and the `add` e2e case, and actually runs the e2e matrix. The name filter matched no test before, so no stack had run in CI.
- `scripts/bump.ts` checks pins against `@effect/tsgo`'s supported versions and the tools Vite+ bundles, and exits 1 when they disagree. `--write` leaves a pin that check holds (vitest stays on the version Vite+ bundles) and prints why.

### Changed

- Generated projects use Effect 4.1.4, effect-cf 0.59.0, better-auth 1.7.25, Vite+ 1.7.0, `@effect/tsgo` 0.70.0, Alchemy 2.0.0-beta.87 and the official Drizzle `1.0.0-rc.5`, and pin pnpm 12.21.0.
- The Alchemy stack imports the Cloudflare provider from `@alchemy.run/cloudflare`, where Alchemy moved it.
- `efforge add --json` output includes `nextSteps`, the commands left to run, `packageManager` and `notes`.
- `efforge add` raises the root `packageManager` to pnpm 12.21.0 when it is older than 12.17, which ignores the overrides that hold Effect's packages at one version, and says so. It never lowers it.

### Fixed

- `npm create efforge` and `pnpm dlx create-efforge` no longer crash on start. The CLI ships as one bundled file with no dependencies, so nothing is resolved when you install it.
- Projects with a database, and projects with realtime but no database, build again. Effect's packages are released together, and libraries such as drizzle-orm and effect-cf asked for them with open ranges, which installed Effect 4.1 next to 4.0. Generated projects now pin every Effect 4 package to one version with `overrides` in `pnpm-workspace.yaml`, and `efforge add` adds those overrides to older projects. Libraries that depend on Effect 3, such as uploadthing, keep their own copy.
- The realtime demo shows on `/app` with every database and auth choice. The ORM and auth dashboards now render the add-on widgets. `efforge add realtime` on an older project updates its dashboard if you haven't edited it, and otherwise prints the two lines to add. If you created a 0.2.0 project with realtime and a database or auth, nothing prompts the repair: add `import { widgets } from "@/components/widgets"` to `apps/web/src/routes/app/index.tsx` and put `{widgets}` in the page.
- `pnpm lint` and `pnpm check` load the Effect rules again. They run through `effect-tsgo vp`, because Vite+ 1.7 lints types with its own bundled tsrs.
- `efforge add` no longer leaves a `pnpm-lock.yaml` in a project that was never installed, so it no longer warns about uncommitted changes it caused. `create` no longer writes one into the current directory either.
- `efforge add` on a project that was never installed skips the route tree and tells you to run `pnpm install`.
- `efforge add` installs when `CI` is set (CI, and many agent sandboxes). pnpm freezes the lockfile there by default and refused to add the new dependencies with `ERR_PNPM_OUTDATED_LOCKFILE`; `add` now runs `pnpm install --no-frozen-lockfile`.
- A mistyped or invalid flag prints a short error that names the closest flag, instead of the full help. With `--json` it is one `{"error": {"code", "message"}}` object on stdout. `efforge add` with no ids says what to pass.
- Docs and error messages no longer say "v0.1".

## 0.2.0 (2026-10-22)

### Added

- Generated projects lint two rules that `AGENTS.md` only described before: `Effect.run*` and `ManagedRuntime.make` in test files (a local oxlint plugin, `lint/effect-tests.js`), and importing `env` from `cloudflare:workers` outside `server/cloudflare.ts`.
- Generated projects lint `typescript/no-deprecated` and `typescript/no-misused-promises`.
- The generated `AGENTS.md` has a Tests section and asks for lifecycles as tagged states. See `docs/decisions/0003-rat-stack-learnings.md`.
- `efforge list` shows every add-on, and marks the ones a project already has.
- `npm create efforge .` creates the project in the current directory. A directory that holds only `.git` counts as empty.
- `create` ends with next steps for the stack: start Postgres, run migrations, then `pnpm dev`.
- A dry run warns when the target directory isn't empty. Names npm rejects (over 214 characters, `node_modules`) and confusing ones (`test`, `src`) are refused.
- Help shows examples.

### Changed

- The `effect-ai-byok` crypto test uses `it.effect` instead of `Effect.runPromise`.
- Template forms and buttons use React's `SubmitEvent` instead of the deprecated `FormEvent`, and wrap async handlers as `() => void handler()`.
- Without a terminal (CI, pipes), a prompt that would be needed fails at once and names the flag to pass, instead of hanging.
- Ctrl-C exits with code 130. Stopping during setup lists the commands that finish it.
- pnpm is checked before the first prompt; a failed install lists the remaining steps. Unsupported Node versions get a warning, and a missing git skips git.
- The name prompt rejects a directory that isn't empty and asks again, instead of failing after the last prompt.
- Errors for incompatible flags say why (for example, auth needs a database), and unknown values say they are unknown. With `--json`, errors are JSON on stdout.
- The install shows its latest output line, and steps show how long they took. In CI or a pipe, each step prints one line.
- `add` shows a summary of new (`+`) and changed (`~`) files, warns about removed files, replaced package scripts and a dirty git tree, and lists the env vars to fill in. It runs `pnpm install` only when dependencies changed.
- `add` accepts ids in any case, suggests a fix for typos (unknown ids are an `UnknownAddon` error), says which ids to add together (database, ORM and auth), checks for pnpm before writing, and prints the database setup steps when it adds a database.
- The README is shorter, with a demo recording (`.github/assets/demo.tape`); the limits moved to `docs/limits.md`.
- The generated README explains the database setup.

### Fixed

- Duplicate `--extras` values are dropped.
- The name prompt accepts the default again after showing an error.
- `add infra/alchemy` no longer refuses to remove a `wrangler.jsonc` that only earlier `add`s changed. It compares the data and comments, not the text.
- Piping output into `head` no longer crashes with EPIPE.
- `list --cwd` with a missing directory is an error; piped `list` output keeps full descriptions.

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
