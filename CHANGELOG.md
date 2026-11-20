# Changelog

## 0.3.0 (2026-11-20)

A new project now opens on a dashboard: one card per capability, a working demo beside the Effect code behind it, and a graph of the layers the app is made of. `efforge upgrade` brings a project from an older efforge up to date and leaves your changes alone, and `efforge doctor` says what is wrong with a checkout and the command that fixes it. Coding agents can drive efforge from start to finish: every choice has a flag, nothing waits for a terminal, and `--json` is a versioned contract in which every error says what to run instead.

### Upgrading from 0.2.x

From inside the project, with your work committed:

```sh
npx -y create-efforge@latest doctor
npx -y create-efforge@latest upgrade --check   # what upgrade would do; --diff shows each change
npx -y create-efforge@latest upgrade
pnpm typecheck && pnpm check && pnpm test && pnpm build
```

Run `upgrade` before any `add`: `add` writes nothing on a 0.2.x project and answers `UpgradeFirst`, because 0.3.0's add-ons need files and pins 0.2.x didn't generate. `upgrade` refuses uncommitted changes, writes nothing if any step fails, and runs `pnpm install`. It applies what efforge can prove is still its own: the Effect version guard (the `overrides` in `pnpm-workspace.yaml` and a `packageManager` that honours them), the pins, scripts and dependencies efforge wrote, every generated file you haven't changed, the new files (the dashboard's cards, `apps/web/src/start.ts` with the session gate, the test layers), the env vars the stack reads that `.env.example` lacks, and removal of files efforge no longer generates that you never changed (`components/widgets.tsx`, the placeholder `core.test.ts`). In a file efforge edits in place that you changed (`layers.ts`, `routes.ts`, `AGENTS.md`), it adds only what its new files need there.

It leaves alone every file you changed, a file or `AGENTS.md` section you removed, a layer you replaced, a binding you renamed and a pin you set yourself. It lists those under "Kept", each with why; `upgrade --check --diff --file <path>` prints efforge's version. A file of efforge's that your file still needs as it is (your edited dashboard imports `getGreeting` from `greeting.ts`) is held back, with the files that need it. Merge your file by hand and run `upgrade` again, and the held files arrive. [docs/upgrading.md](https://github.com/amagdy46/efforge/blob/main/docs/upgrading.md) walks a real 0.2.0 project through it.

What `upgrade` can't do for you:

- **Your own server functions need a session.** On a stack with auth, `sessionGate` refuses every server function without a session, yours included, and every request under `/api/` needs one too. To make one public, add its file and name to `apps/web/src/server/public-server-fns.json`. `pnpm check` now fails on a server function that doesn't chain `.middleware([requireSession])`. `upgrade` names your functions in a note.
- **Your own implementation of a service** (a test fake, say) needs the new members: `Jobs.events` (workflows), `Llm.streamText` (AI), `Storage.list` (storage), and `Mailer.transport` and `Mailer.from` (email). `StoredObject` has `uploaded`. `Jobs.start` takes an optional `{ id }`; pass it on.
- **Code that constructs efforge's errors.** The services' errors are `Schema.TaggedError` classes now (they were `Data.TaggedError`; auth's `Forbidden` still is): `StorageError`, `MailerError` and `RealtimeError` take a `message`, and a driver's `cause` stays in the server log (`ServerOnly`).
- **The storage programs take an owner**: `upload(owner, name, type, bytes)`, `listUploads(owner)` and `deleteUpload(owner, key)`, each under `uploads/<owner>/`.
- **The old demos are gone.** `example-job.ts` and `run-browser.ts` became the workflows and browser cards' `workflows-demo.ts` and `browser-demo.ts`, and the realtime and ORM widgets are cards. A dashboard you edited keeps the old ones until you take efforge's version.
- **On Alchemy, local settings live in `.env`**, the file `alchemy dev` reads. If yours are still in `.dev.vars`, move them; `upgrade` adds new settings to `.env` only when it exists.
- **Sign-up is open.** Anyone can register and use every card, including the ones that spend your AI key. Close it with `disableSignUp: true` in `apps/web/src/server/auth.ts` before you deploy.

A script that reads `--json` output needs changes; `contract` tells the two shapes apart. Against 0.2.x:

| Was (0.2.x) | Now (0.3.0) |
|---|---|
| `create`: `{ stack, command, files }` | adds `efforge`, `contract`, `ok`, `dryRun`, `directory`, `installed`, `git`, `env`, `nextSteps`, `warnings`; `command` is `npx -y create-efforge create <name> --yes ...` |
| `list`: a bare array | an object: `{ efforge, contract, ok, project, directory?, stack?, addons }` |
| `add`: `written` | removed: `created` (new files) and `changed` (existing files) |
| `add`: `transformed` | removed: in `changed` |
| `add`: `envVars` (`name`, `description`) | `env` (`name`, `description`, `file`, `set`, `secret`) |
| `add`: `nextSteps` as strings | `nextSteps` as `{ command, cwd, note?, longRunning? }`; also new: `directory`, `installed`, `warnings` |
| error: `{ error: { code, message } }` | `{ efforge, contract, ok: false, error: { code, message, fix, ... } }` |
| `UnrecognizedOption` | `UnknownFlag` |
| `InvalidValue` | `InvalidFlagValue` |
| `MissingArgument` (`add` with no ids) | `NoAddonIds` |
| `IncompatibleStack` for a value that isn't an option | `UnknownValue` |
| `IncompatibleStack` when `add` would swap a choice | `SlotAlreadySet` |
| `UnknownAddon` for `<slot>/none` | `RemoveNotSupported` |
| `GenerateError`, `AddonLoadError`, `UnknownTransform` | `InternalError` |
| none | new: `UnknownCommand`, `UnexpectedArgument`, `InsideProject`, `Interrupted`, `ProjectNewerThanCli`, `UncommittedChanges`, `UpgradeFirst`, `LayersUnreadable`, `ReadmeUnwritable` |

A script reading `envVars` or `written` gets `undefined` with no error, so check `contract`: documents from 0.3.0 on have it. From here, a rename or removal bumps `contract`; new fields and codes don't, and `schemas/error.schema.json` leaves `code` open.

### Added

- The dashboard (`/app`) has a card per capability: runtime, database, auth, AI, workflows, realtime, browser, storage, email, rpc and cluster. Each runs a working demo next to the Effect code behind it, read from the files as they are (a Vite plugin cuts out only the marked `// #region card` part, so the rest of the file never reaches the browser), and links the service, layer, test and `AGENTS.md` section to read next. Storage uploads, lists, opens and deletes through signed links; email says which transport is active and sends a test; workflows follows a run step by step, retry and durable sleep included; AI streams the answer; browser opens a page in the Playwright container and shows its screenshot. A layer graph shows what `AppLayer` merges, what each layer provides and needs.
- Every card that writes or spends says who may use it: without auth, "Open endpoint" and what to do before deploying; with auth, any signed-in user, and that sign-up is open. Uploads and workflow runs are per user (`apps/web/src/server/owner.ts`); notes are shared on purpose, and the card says so.
- Tagged errors survive the trip to the browser. A server function returns its Effect's `Exit` (`runOutcome(program, ...Errors)`) and `useServerCall(fn, ...Errors)` decodes it, so `state.error instanceof FileTooLarge` holds and `state.error.limit` is there. A server function's errors are one list declared beside it, and the types hold the server and the client to it. A call refused before it ran (no session, bad input) is `rejected: true`; only a bug is a `Defect`.
- On a stack with auth, `sessionGate` (global function middleware in `apps/web/src/start.ts`) refuses every server function without a session at runtime, however it is written, except those in `public-server-fns.json`. `requireApiSession` does the same for every request under `/api/` except `/api/auth/`, whether a Worker route or a route file answers it. The realtime room refuses a socket without a session (close code 4401). `add auth` says once which of your server functions now need a session and how to make one public.
- A missing or unusable setting, from any add-on, shows as a page that names it and the file to put it in (`.dev.vars`, or `.env` with Alchemy), and as "not configured" on a card, instead of a raw 500. `/api/auth/*` and `/api/` routes answer 503 `NotConfigured` with the setting's name. Outside `pnpm dev` the page and the 503 name only the setting, and the reason goes to the Worker's log.
- Test layers to reuse in your own tests, in `packages/core/test`: `StorageInMemory`, `MailerInMemory`, `JobsInMemory`, `LlmFixed`, `LlmUnconfigured` and `BrowserInMemory`. Each capability with a card ships a test that swaps one in and checks a tagged error, in place of the placeholder test.
- Every service call is a named span (`Notes.list`, `Storage.put`, `serverFn.addNote`). Nothing records them until a tracer is set in `TelemetryLive`, a slot underneath `AppLayer`.
- `ServerOnly` (`packages/core/src/server-only.ts`): an error field that stays in the server log, so no raw driver text reaches the browser.
- `efforge add rpc`: Effect RPC from TanStack Start. `AppRpcs` in `packages/core/src/rpc.ts` is one contract for the server and the browser, served at `POST /api/rpc` on the same layers as the server functions; a failure arrives as its error's class, and a stream call streams. It adds about 40 KiB of gzipped JavaScript to the dashboard and nothing to the landing page. [docs/rpc.md](https://github.com/amagdy46/efforge/blob/main/docs/rpc.md) compares it with a server function and `HttpApi`.
- `efforge add cluster` (experimental): Effect Cluster, Effect Workflow and a durable queue on Durable Objects, through `@effect/platform-cloudflare` 4.1.4, pinned exactly with `effect`. The card increments a per-user counter, starts and approves a durable run, and offers to a queue. It works on D1 and Postgres, with wrangler and with Alchemy. [docs/cluster.md](https://github.com/amagdy46/efforge/blob/main/docs/cluster.md) says what experimental means here.
- `efforge upgrade` and `upgrade --check`, described above. `--check` answers two questions apart: `needs-action` (something breaks the project now or at the next install; exit code 2) and `behind` (`upgrade` has something to apply; exit 0, or 3 with `--strict`). efforge tells its own work from yours by records, not guesses: a hash of each file it wrote, and a record of what each release generated, which `upgrade` compares against.
- `efforge doctor` checks a checkout: Node and pnpm, whether `node_modules` matches the lockfile, exactly one Effect version installed (the 0.2.0 build failure in one line), peers, env vars (never your values), bindings, Durable Object migrations, local D1 migrations, the local Postgres, `efforge.jsonc`, the layers, the session gates, a parent `.gitignore` that hides the project, and `upgrade --check`'s answer. Each finding comes with the reason and a fix you can run. It changes nothing and uses the network only with `--online`; exit code 2 when a check fails.
- `create --preset=saas|ai|minimal`: the whole stack in one choice, the first question at the prompts. A stack flag beside it wins (`--preset=saas --database=d1`); a part the flag leaves no room for is dropped and the run says so. After a preset, "Create it?" also offers Change parts. `list` shows the presets. `efforge.jsonc` records the stack flag by flag, since a preset can change between versions.
- `efforge info <id>` describes an add-on: its service and layer, what it needs and conflicts with, the files it writes and edits, packages, env vars, card, `AGENTS.md` sections and docs page. Inside a project it shows what that project would get and the command that adds it.
- `efforge graph` prints the project's layer graph from `layers.ts`: Mermaid by default, readable on GitHub light and dark, `--format=text` or `--json`. `graph --write` puts it in `README.md` between markers, and `add` keeps it current.
- `efforge add` with no ids, in a terminal, opens a picker of the add-ons the project can still add. Without a terminal it lists them in a short error.
- `--json` is a versioned contract ([docs/json.md](https://github.com/amagdy46/efforge/blob/main/docs/json.md)): `create`, `add`, `list`, `info`, `graph`, `upgrade` and `doctor` print one document on stdout, on success and on failure, with `efforge` (the version), `contract` (1) and `ok`. Errors have a stable `code`, a `message` and a `fix`: a command that does what was asked, or `null` with the values to choose from, and `alternatives` when there is more than one way out. A fix never picks a different capability, never creates a project you didn't ask for, keeps your name and flags, and never prompts. Without `--json`, an error ends with `Try: <command>`. An interrupted `create` or `add` prints an `Interrupted` document with the steps that finish it and exits 130.
- JSON Schemas for `efforge.jsonc` and every `--json` document ship in the package under `schemas/`; new projects' `efforge.jsonc` points at its schema.
- An agent skill (`npx -y skills add amagdy46/efforge`), an `llms.txt`, and a "For coding agents" section in the README. The skill and `llms.txt` tell an agent to check its work with `doctor --json`, and the generated `AGENTS.md` says to add capabilities with `npx -y create-efforge@latest add <id> --json`.
- The generated `README.md` is written for the stack: how to run it, a scripts table, the layout, each capability's service, layer, env vars and card, and a first deploy with wrangler or Alchemy for every add-on that binds a Cloudflare resource. `add` rewrites only the text between its markers.
- The generated `AGENTS.md` has a section per part of the stack (Alchemy, both ORMs, Postgres, D1), kept in order by `add`, and says how to add an error to a service and handle it in a component, and where the Local Explorer is.
- A landing page that names the project, shows its stack (read from `efforge.jsonc`, so it stays true after `add`), links the dashboard and gives the `add` command for a capability it doesn't have.
- A new identity: a maker's punch with ef struck through it. Generated apps use efforge's palette in light and dark, the project's name in the title, a placeholder favicon and a "made with efforge" badge. `create`, `add` and `list` start with one line: an `ef` cell and the version.
- Generated projects have `engines` in the root `package.json` and an `.nvmrc`.
- Lint rejects `?raw` and other whole-file imports, and `pnpm build` fails if a server file, `.dev.vars`, `.env*` or a secret's value would reach the browser.
- `add ai` (or `infra`) means the slot's one add-on. `--completions` covers both bin names. `add` says where each new add-on's card, `AGENTS.md` sections and docs page are.

### Changed

- `create --dry-run` and `add --dry-run` count the files by the add-on they come from; `--verbose` lists every file, and `--json` always has them all.
- Terminal output: one line per step, no empty section headers, the total time at the end, `--help`'s global flags fit 100 columns, and every prompt and line of ordinary output fits 80. `list` in a pipe prints only the list.
- `CI` set to anything but `0` or `false` counts as no terminal: a prompt that would be needed fails at once and names the flag. Without a terminal, `create` names `--preset` first.
- Every command efforge prints runs as written: hints, errors, `command` and `efforge.jsonc` say `npx -y create-efforge`, and `create` and `add` install with `pnpm install --no-frozen-lockfile`, which every next step repeats.
- A directory that isn't empty is no longer answered with a renamed project (`my-app-2`): when it holds an efforge project, the error says so and gives the steps that finish it.
- With Alchemy, local settings go to `.env`, the file `alchemy dev` reads, at `create` and at every `add`; `add infra/alchemy` moves what `.dev.vars` held. `.env.example` has a value that works locally for every variable and an empty one marked "Fill in" for a real secret.
- With Alchemy and Postgres, `DATABASE_URL` has no default keyed on the stage name, and `pnpm dev` turns TLS off only for a database on this machine.
- Whether `pnpm db:migrate` is still owed is read from the local database, in the next steps of `create`, `add` and `upgrade`.
- `efforge add` writes only onto a project from its own release line. On a 0.2.x project it writes nothing and answers `UpgradeFirst`: run `upgrade`, then the same `add`.
- The browser container answers a refused address with 403 and a page that would not load with 502, and returns a screenshot.
- Effect's "experimental API" warning is off in `tsconfig.base.json` and lint, like the "unstable" one.
- Generated projects use `@effect/atom-react`, `@effect/platform-cloudflare` and `@effect/sql-sqlite-node` 4.1.4 for rpc and cluster, held with `effect` by the overrides. The other pins are 0.2.1's.

### Fixed

- `npx create-efforge lst` no longer creates a project called "lst". The root form takes exactly one name: a command in other case, a typo of one, a word people guess as a command (`help`, `init`, `install`, `dev`, `deploy` and more) or a second word is refused with `UnknownCommand`; inside a project, the root form creates nothing (`InsideProject`). A command after `--` is refused too.
- A `fix` no longer swaps in a different capability (`add r2` suggested `database/d1`, `--database=mysql` suggested `--database=postgres`): only a clear typo is corrected, and an unknown flag that isn't a typo is no longer dropped silently.
- `--wizard`, a flag of the CLI library, showed a prompt without a terminal, printed "Wizard cancelled." and exited 0. It is an `UnknownFlag` error now.
- Commands efforge printed without `-y` (the `--help` examples, the generated README, the `efforge.jsonc` schema) stopped at npx's "Ok to proceed?" on a first run.
- Output without a terminal no longer starts with a section header (`◇ Data`) before an error, and errors on stderr wrap at 80 columns, never inside a command or a path.
- `list --cwd <file>` is an error naming the project around the file. Running the same `add` again after a failed install runs the install it still owes.
- Sign-up failed with `INVALID_ORIGIN` when Vite picked a port other than 5173. Under `pnpm dev`, Better Auth takes the origin from each request on a local host while `BETTER_AUTH_URL` is unset; a host that isn't allowed gets a 403 that says what to set.
- Better Auth failed sign-ups on a cold Worker; its start-up now goes to `waitUntil`.
- `pnpm db:generate` failed on a new Postgres + Drizzle project ("snapshot.json is not of the latest version").
- `pnpm run deploy` deploys the built Worker config; wrangler refused the one in `apps/web`. `pnpm db:migrate --remote` on D1 no longer passes `--local` too. On Alchemy with D1 and Drizzle, `pnpm db:migrate` says why it doesn't apply.
- The realtime room counts only clients that are there, so the count stays right under `pnpm dev`. A signed-out plain `GET` on its path answered 500; it gets 401. `HEAD` on a signed file link answers like `GET` instead of 404.
- With Alchemy and AI, `pnpm dev` starts without `LLM_API_KEY`.
- On Alchemy stacks the landing page said the app is configured in `wrangler.jsonc`.
- `add browser` wrote a re-export wider than 100 characters on one line, which `pnpm check` then reported.

### In this repository

- CI runs `upgrade` on real projects made by 0.2.0 and 0.2.1, with and without an owner's edits, then each project's full gate, and generates and gates 20 stacks (`scripts/e2e-cases.ts`), which between them build every add-on on every database it allows.
- `scripts/history.ts` records what each release generates in `src/history.data.ts`, for `upgrade`; run it at every release (CONTRIBUTING.md).
- `pnpm brand` regenerates every brand asset from `scripts/brand/source.ts`, and a test fails when one is stale.

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
