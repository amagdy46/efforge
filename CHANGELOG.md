# Changelog

## Unreleased

Coding agents can drive efforge from start to finish: every choice has a flag, nothing waits for a terminal, and `--json` is a documented contract in which every error says what to run instead. The contract ships in 0.3.0; the skill, `llms.txt` and the README section say so, and tell an agent how to spot an older CLI.

### Added

- A new identity: a maker's punch with ef struck through it replaces the ember logo. The README header, social preview and avatar use it, and `docs/brand.md` is the brand guide.
- Generated apps get a placeholder favicon (`apps/web/public/favicon.svg`) and a "made with efforge" badge in their README.
- `create`, `add` and `list` start with one line: an `ef` cell and the version. It is plain text under `NO_COLOR`, in a pipe and in CI. `--json` prints none of it.
- `pnpm brand` regenerates every brand asset, the README header and the generated README's badge line from `scripts/brand/source.ts`, and a test fails when any of them is stale.
- `--json` is a versioned contract ([docs/json.md](docs/json.md)). `create`, `add` and `list` print one JSON document on stdout, on success and on failure, carrying `efforge` (the CLI version), `contract` (1) and `ok`. Success documents include the project directory, the stack, the files, the env vars with where their local values go, and the next commands with the directory to run each in. Errors have a stable `code`, a `message` and a `fix`: a command that does what was asked, or `null` with the values to choose from. A `fix` never picks a different capability, never creates a project you didn't ask for, keeps the name and flags you gave, and never prompts. Every fix is built and checked in one place (`src/fix.ts`), and a seeded property test runs hundreds of generated invocations, follows their fixes and holds them to those rules.
- When there is more than one way out (`--database=none --auth=better-auth`, `add auth/better-auth` on a project without a database), the error has `fix: null` and `alternatives`: each way out as a complete command with a one-line description. `add`'s `needs` lists the slots to fill and the ids that can fill each.
- Errors without `--json` end with `Try: <command>` when a command fixes them.
- JSON Schemas for `efforge.jsonc` and the `--json` documents ship in the package under `schemas/`. New projects' `efforge.jsonc` points at its schema with `$schema`.
- An agent skill, `skills/efforge/SKILL.md` (`npx skills add amagdy46/efforge`), an `llms.txt`, and a "For coding agents" section in the README.
- The generated `AGENTS.md` says to add capabilities with `npx -y create-efforge@latest add <id> --json`.
- `--completions` covers both bin names, `create-efforge` and `efforge`.
- `--version --json` prints the contract envelope, `{ efforge, contract, ok }`.
- An interrupted `create --json` or `add --json` (Ctrl-C, SIGTERM, a tool's timeout) prints an `Interrupted` document with what was written and the steps that finish it, and exits 130.
- `list --json` outside a project's root, but inside one or beside one, names it in `nearby`, and the text output says so.
- `efforge add ai` (or `infra`) means the slot's one add-on.
- Generated apps open on a landing page that names the project and shows the stack it was created with, read from `efforge.jsonc`, so it stays true after `efforge add`. It links to the dashboard, points to `AGENTS.md`, and gives the `add` command for a capability the project does not have.
- The dashboard (`/app`) shows one card per capability: a working demo next to the Effect code behind it, read from the files as they are, and the files, test and `AGENTS.md` section to read next. Runtime, database, auth and realtime have cards, and a layer graph shows what `AppLayer` merges.
- An add-on contributes its card with a `card` entry in `addon.json`; `create` and `add` register it. `docs/capability-cards.md` describes the contract. A card's files and the transforms on them are one unit: in a project made before cards, `add` adds the add-on without any of it and says so in a note.
- On auth stacks every server function a card calls requires a session, reads included. efforge adds the guard, also to cards that were there before auth was added.
- A card shows only the marked region of a file: a Vite plugin in the generated app cuts it out at build time, so the rest of the file never reaches the browser, and a file without the region fails the build.
- A missing setting, from any add-on, shows as a page that names the setting and the file to put it in (`.dev.vars`, or `.env` with Alchemy), and as "not configured" on a card, instead of a raw 500.
- An add-on file can be `ifAbsent`: written only where the project has no such file. Auth uses it for the app shell and the project name, so adding auth to a renamed app keeps the name.
- Each capability with a card ships a test that swaps in a test layer and checks a tagged error, replacing the placeholder test. The generated `AGENTS.md` shows the pattern.
- Generated projects have `engines` in their root `package.json` and an `.nvmrc`.
- The generated `README.md` is written for the stack: what the project has, how to run it, a scripts table that matches `package.json`, the layout, each capability's service, layer, env vars and card, a first deploy with wrangler or Alchemy, and an add-on the project doesn't have yet. `efforge add` rewrites the text between its `efforge:readme` markers and leaves everything else alone; a README without markers is not touched, and `add` says so in one line.
- The generated `AGENTS.md` has sections for Alchemy, both ORMs, Postgres and D1. Every section is written from the stack: `add` keeps them in the add-ons' order and removes one that no longer holds, such as the `wrangler.jsonc` line once Alchemy declares the Worker.
- `add` says, for each new add-on, where its card is, which `AGENTS.md` sections it added and where its docs page is; under `--json` these are `card`, `agents` and `docs` in each `added` entry.
- A marker counts only on a line of its own, and each region needs one opening and one closing marker, in order, not nested. When a README or `AGENTS.md` breaks that, `add` leaves the whole file as it is and names the marker, in text and in `notes`. A seeded property test with random user text and random marker damage holds this ([ADR 0010](docs/decisions/0010-generated-docs-regions.md)).
- `efforge upgrade` brings a project up to date with this efforge and leaves your work alone. It applies one consistent set: the Effect version guard and a `packageManager` that honours it, the pins efforge wrote (a set that moves together moves as one), the scripts and dependencies it wrote, every generated file you haven't changed, new files, and, in a file you changed that efforge edits in place, only what its new files need there (the `// #region card` block the dashboard shows from `layers.ts`), with the same transforms `add` uses. A change that would break a file of yours is held back with every file that needs it, and the output says which and why. It computes everything first and writes nothing if a step fails, refuses uncommitted changes (`--allow-dirty`), runs `pnpm install`, records the efforge version and the new hashes in `efforge.jsonc` (keeping your comments), and shows its plan with `--dry-run`. It never puts back a file or `AGENTS.md` section you removed, a layer you replaced or a binding you renamed, and never moves a pin you set yourself. An older efforge refuses a project a newer one made or upgraded.
- efforge knows what is its own from records, not guesses: the hash of each file it wrote, and a record of what each release generated (pins, scripts, dependencies, `engines`, and fingerprints of the files it edits in place), extended at every release by `scripts/history.ts`. A Drizzle snapshot pin such as `1.0.0-rc.5-5935859` is the one efforge 0.2.0 wrote, so it moves.
- `efforge upgrade --check` says the same without writing, and answers two questions apart: `needs-action` (a guard missing, efforge's pins of a set at two releases' versions, an import broken now, an install owed; exit code 2) and `behind` (`upgrade` has something to apply; exit code 0, or 3 with `--strict`). Files you changed whose template moved too are listed as kept, each with what efforge's change is for and the command that shows efforge's version (`--diff --file <path>`). A project that only ran efforge's own `add` has nothing to review: in-place files are compared by structure, not text.
- `efforge doctor` checks a checkout and says what is wrong, each finding with the reason and a fix you can run, after which that check passes: Node and pnpm, whether `node_modules` matches the package.json files and `pnpm-lock.yaml`, exactly one Effect version installed (the 0.2.0 build failure in one line), peers (with the pinned pnpm when it made `node_modules`), env vars (never your values), bindings, local D1 migrations, the local Postgres, `efforge.jsonc`, the layers (read as code, so a commented-out layer is missing and a refactor isn't), and `upgrade --check`'s answer. Where it can't read a file the way it expects, it says it could not verify, instead of failing. It changes nothing and uses the network only with `--online`. Exit code 2 when a check fails.
- `--json` covers both: `upgrade` and `upgrade --check` documents and the `doctor` document, with schemas in `schemas/`; the `ProjectNewerThanCli` and `UncommittedChanges` errors; exit codes 2 and 3 for a check that found something (the document has `ok: true`). The skill and `llms.txt` tell agents to check their own work with `doctor --json` and to bring a project up to date with `upgrade --json`.

### Changed

- The `--json` output changed shape (see [ADR 0007](docs/decisions/0007-json-contract.md)). Against 0.2.1:

  | Was (0.2.1) | Now (0.3.0) |
  |---|---|
  | `create`: `{ stack, command, files }` | adds `efforge`, `contract`, `ok`, `dryRun`, `directory`, `installed`, `git`, `env`, `nextSteps`, `warnings`; `command` is `npx -y create-efforge create <name> --yes ...` |
  | `list`: a bare array | an object: `{ efforge, contract, ok, project, directory?, stack?, addons }` |
  | `add`: `written` | removed: `created` (new files) and `changed` (existing files) |
  | `add`: `transformed` | removed: in `changed` |
  | `add`: `envVars` (`name`, `description`) | `env` (`name`, `description`, `file`, `set`) |
  | `add`: `nextSteps` as strings | `nextSteps` as `{ command, cwd, note?, longRunning? }`; also new: `directory`, `installed`, `warnings` |
  | error: `{ error: { code, message } }` | `{ efforge, contract, ok: false, error: { code, message, fix, ... } }` |
  | `UnrecognizedOption` | `UnknownFlag` |
  | `InvalidValue` | `InvalidFlagValue` |
  | `MissingArgument` (`add` with no ids) | `NoAddonIds` |
  | `IncompatibleStack` for a value that isn't an option | `UnknownValue` |
  | `IncompatibleStack` when `add` would swap a choice | `SlotAlreadySet` |
  | `UnknownAddon` for `<slot>/none` | `RemoveNotSupported` |
  | `GenerateError`, `AddonLoadError`, `UnknownTransform` | `InternalError` |
  | none | new: `UnknownCommand`, `InsideProject`, `Interrupted` |

  A script reading `envVars` or `written` gets `undefined` with no error, so check `contract`: documents from 0.3.0 on have it. From here, a rename or removal bumps `contract`; new fields and codes don't, and `schemas/error.schema.json` leaves `code` open.
- `efforge add` with no ids prints a short error listing the add-ons the project can still add, not the help.
- `CI` set to any value other than `0` or `false` counts as no terminal: a needed prompt fails at once and names the flag.
- Hints, errors and `command` say `npx -y create-efforge`, never `efforge` alone or `npm create efforge`, so every printed command works when copied and npx doesn't ask before downloading. `efforge.jsonc`'s `command` uses the same form.
- One install command everywhere: `create` and `add` run `pnpm install --no-frozen-lockfile`, and every next step and fix says the same.
- `list` in a pipe prints only the list, without the intro line.
- A directory that isn't empty is no longer answered with a renamed project (`my-app-2`): when it holds an efforge project, the error says so and gives the steps that finish or use it; otherwise `fix` is `null`.
- The generated app uses efforge's palette as its default theme, in light and dark.
- The page title and headers show the project's name instead of "My app".
- Server functions behind the cards return tagged errors as data (`runOutcome` in `server/outcome.ts`); a call the server rejects keeps its tag in the browser (`Unauthorized`, `InvalidInput`, `Unreachable`), and only a bug shows as `Defect`.
- `RealtimeError` has a message.
- `add --json` reports a skipped card in `notes`.
- `efforge add realtime` no longer rewrites a 0.2.x project's dashboard to show the widgets: the widgets are gone, and such a project has no card registry, so an add-on comes without its card and a note says so.
- With Alchemy, local settings are written to `.env`, the file `alchemy dev` reads, at `create` and at every `add`; `add infra/alchemy` moves what `.dev.vars` held there. No step copies one settings file to another.
- `.env.example` has a value that works locally for every variable, and an empty one marked "Fill in" for a real secret, so a fresh clone runs after `cp .env.example .dev.vars` (`.env` with Alchemy) and filling in the named secrets.
- The README's "Run it", `create`'s next steps and `nextSteps` under `--json` come from one function, and depend only on the stack in `efforge.jsonc`, never on which untracked files exist.
- Alchemy with Postgres: `DATABASE_URL` has no default keyed on the stage name, and `pnpm dev` turns TLS off only for a database on this machine (`localhost`, `127.0.0.1`, `::1`).

### Fixed

- `npx create-efforge lst` no longer creates a project called "lst", and following the fixes for `ad email --cwd my-app` no longer ends in a project called `ad-email-my-app`. The root form takes exactly one name: a command in other case (`Add`), a typo of one, a word people guess as a command (`help`, `version`, `update`, `init`, `install`, `remove`, `ls`, `new`, `run`, `dev`, `build`, `deploy` and more), more words, or a flag only `add` and `list` take is refused with `UnknownCommand`, before anything else parses, with the command it names or no fix. Inside an efforge project the root form creates nothing (`InsideProject`), so `update --json` there no longer makes `my-app/update`. `create <name>` still takes any valid name. `create my app` is no longer turned into `my-app`.
- A wrong or missing value for a flag that isn't a stack choice (`--completions=nushell`, `--install=maybe`, `--log-level=nope`, `--cwd` with no value) gets `fix: null` and the allowed values, instead of a fix that dropped the flag and, for `--completions`, created a project.
- A fix keeps flags before a `--`: `add --json -- email` no longer loops, adding `--cwd` after the `--` on every hop. A mistyped command is moved to the front (`--json lst` gets `list --json`), and `--name=app` becomes `create app`.
- `create ../app` and `create apps/web` no longer get a fix that creates `./app` or `./web`; only case and spaces are normalised (`My App` to `my-app`). `CREATE` and `Add` are the commands they name. A name that starts with `-` is refused.
- `TargetNotEmpty` offers to finish the project in the directory only when its stack is the one asked for, and never with an install or commit the caller turned off.
- Whether an install is owed is read from the project (its package.json files and pnpm-workspace.yaml against pnpm's record of what it installed), not from a marker file, so an install run by hand settles it and a healthy project is never told it owes one.
- `list --cwd <file>` is an error (`NotAnEfforgeProject`, with the project around the file as `fix`), like a directory that doesn't exist.
- The failure documents keep `warnings`, and `add`'s also `skipped`, `replacedScripts` and `packageManager`.
- A `fix` no longer swaps in a different capability: `add r2` used to suggest `database/d1`, `add stripe` `extras/storage`, and `--database=mysql` `--database=postgres`. Only a clear typo is corrected (one edit for options up to six characters, two above, never for one- or two-character options like `d1`); otherwise `fix` is `null` and the error lists `allowed` or `addons`. An unknown flag that isn't a typo is no longer dropped silently.
- After a failed install, the `SetupIncomplete` and `CommandFailed` documents carry what success would have: the files, `env` and `nextSteps`. Running the same `add` again runs the install it still owes instead of reporting nothing to do.
- Output without a terminal no longer starts with a section header (`◇ Data`) before an error.
- When `add` leaves the install to you after changing dependencies, its next step is `pnpm install --no-frozen-lockfile`, which works with `CI` set, like the install `add` runs itself.
- Sign-up no longer fails with `INVALID_ORIGIN` when Vite picks a port other than 5173: under `pnpm dev`, Better Auth takes the origin from each request on a local host while `BETTER_AUTH_URL` is unset. A set `BETTER_AUTH_URL` always wins, and sign-in from a host that is not allowed gets a 403 that says what to set, not a 500.
- `efforge.jsonc` with a comment no longer breaks the landing page.
- On Alchemy stacks the landing page no longer says the app is configured in `wrangler.jsonc`.
- `pnpm db:generate` no longer fails on a new Postgres + Drizzle project ("snapshot.json is not of the latest version"): the committed snapshots are the version the pinned drizzle-kit reads, and CI runs `pnpm db:generate` on every Drizzle stack.
- `pnpm run deploy` deploys the built Worker config; wrangler refused the config in `apps/web`.
- `pnpm db:migrate --remote` on D1 no longer passes `--local` too, which wrangler refuses. On Alchemy, D1 + Drizzle's `pnpm db:migrate` says why it doesn't apply and leaves no `packages/db/migrations/` behind.

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
