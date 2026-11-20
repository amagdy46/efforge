# Changelog

## Unreleased

Coding agents can drive efforge from start to finish: every choice has a flag, nothing waits for a terminal, and `--json` is a documented contract in which every error says what to run instead. The contract ships in 0.3.0; the skill, `llms.txt` and the README section say so, and tell an agent how to spot an older CLI.

### Added

- `create --preset=saas|ai|minimal`: the whole stack in one choice. `saas` is Postgres, Drizzle, Better Auth with organizations, email and storage; `ai` is D1, Effect SQL, Better Auth, AI with your own key and realtime; `minimal` has no database and no auth. A stack flag beside it always wins (`--preset=saas --database=d1`). A part of the preset that a flag leaves no room for is dropped, and the run says so, as a line and under `--json` as a `warnings` entry (`--preset=saas --database=none` has no ORM and no auth). A flag that needs a part the preset doesn't have is `IncompatibleStack`, with alternatives that are complete commands (`--preset=minimal --auth=better-auth` offers `--auth=none`, another preset, or `--database` with `--orm`). In the prompts, the question after the name is "Start from a preset, or choose each part?", and Back from the first slot returns to it. After a preset, "Create it?" also offers Change parts: every part again with the preset's as the defaults, and the summary gives the flags that make the result (`--preset=saas --database=d1`). `list` and `list --json` show the presets. The recorded command stays explicit, flag by flag, since a preset can change between versions.
- `efforge add` with no ids, in a terminal, opens a picker: the add-ons the project doesn't have, by slot, with descriptions; those in a slot the project already filled are shown disabled, with why. A pick the rules refuse is said and asked again, and picking nothing adds nothing. Without a terminal, or with `--json`, it is `NoAddonIds` as before.
- `efforge info <id>` describes one add-on: what it is for, its service and layer, what it needs and conflicts with, the files it writes and edits, packages, env vars, its dashboard card, its `AGENTS.md` sections and its docs page. Inside a project it shows what that project would get and the command that adds it. `--json` has the same as data.
- `efforge graph` prints the project's layer graph, read from `apps/web/src/server/layers.ts`: what `AppLayer` merges, what each layer provides and needs. Mermaid by default, in the tempering colours, readable on GitHub light and dark; `--format=text` for an indented list; `--json` for nodes and edges. Layers you added yourself are shown with provides and needs unknown. `graph --write` puts it in `README.md` between `efforge:readme:graph` markers, and `add` keeps it current.
- Two error codes: `LayersUnreadable` (`graph` can't find `AppLayer = Layer.mergeAll(...)`) and `ReadmeUnwritable` (`graph --write` found no README markers, or broken ones, and wrote nothing).
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
- The dashboard (`/app`) shows one card per capability: a working demo next to the Effect code behind it, read from the files as they are, and the files, test and `AGENTS.md` section to read next. Runtime, database, auth, AI, workflows, realtime, browser, storage and email have cards, and a layer graph shows what `AppLayer` merges.
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
- Storage has a dashboard card: upload a file to R2, list the bucket, open a file through a signed link, delete it. `Storage` gains `list`, and the `upload`, `listUploads` and `deleteUpload` programs come with `FileTooLarge` and `NotAnUpload`.
- Email has a dashboard card: it says which transport is active and how to switch, sends a test email and shows what went out. `sendTestEmail` refuses a non-address with `InvalidAddress`.
- Workflows card: start a run of the example workflow and follow it step by step as it happens, a failed first attempt retried, a durable 5-second sleep and the result, read from `WorkflowInstance.subscribe`. A blank name is `MissingName`.
- AI card: ask the configured model and read the answer as it streams. With no key the card names the missing setting and its file, or, with organizations, says to add a key in Settings > AI.
- Browser card: open a page in the Playwright container and see its screenshot, title and request count. A local or private address is `UrlRefused`. With containers off in `pnpm dev`, the card says what to turn on. Every call ends within 90 seconds.
- Test layers you can reuse in your own tests ship in `packages/core/test`: `StorageInMemory`, `MailerInMemory`, `JobsInMemory`, `LlmFixed`, `LlmUnconfigured` and `BrowserInMemory`, each with a test, and the `AGENTS.md` sections say how to use them.
- Every card says who may use it when its demo writes or spends (`access` on the card, shown by the card frame): without auth, "Open endpoint" and what to do before deploying, the database card included; with auth, that any signed-in user can, and that sign-up is open. An `AGENTS.md` subsection says the same without auth; it goes away once auth is added. A test over the registry fails on a card with a `POST` server function that says it only reads. Cards read the stack through one hook, `useStack`, which asks `getStack` once per page.
- On a project with auth, every server function requires a session at runtime, however it is written: `sessionGate`, global function middleware in `apps/web/src/start.ts`, refuses one without a session unless it is in `apps/web/src/server/public-server-fns.json`. Every request under `/api/` needs one too, whether a Worker route or a route file's `server: { handlers }` answers it (`requireApiSession`, first in `workerRoutes`; `/api/auth/` is public). `pnpm check` still fails on a server function without `requireSession` (`efforge/server-fn-session`), as early feedback; it also needs `requireSession` imported from the guard file and reports `createServerFn` aliased or re-exported.
- `add auth` puts `requireSession` first in a server function's existing middleware list, names in a note any function it cannot edit, and says once, in text and under `--json`, that every server function now requires a session, naming yours, and how to make one public.
- On a project with auth, the realtime room refuses a WebSocket without a session (close code 4401, "Not signed in"), and the card shows it. Without auth, the card says the room is open.
- Lint rejects `?raw` and other whole-file imports, and `pnpm build` fails if a server file, `.dev.vars`, `.env*` or a secret's value would reach the browser.
- Ten layer colours, the tempering sequence then Sky, Gold, Plum, Slate, Teal and Moss, with a light and a dark variant each in `scripts/brand/source.ts`: each reaches 3:1 on both surfaces of its theme and stands apart from its neighbours (`docs/brand.md` has the checked table). The dashboard and `efforge graph`'s Mermaid use the same values; the brand's named colours keep theirs. The layer graph balances its rows, so no layer sits alone on one (nine layers are three rows of three). A project with every add-on, cluster included, repeats none.
- A signed-in user's uploads and workflow runs are their own: uploads live under `uploads/<user id>/`, a run id starts with a hash of its owner, and another user can't list, open, delete or watch them (`apps/web/src/server/owner.ts`; per user with organizations too). Notes are shared on purpose, and the card says so.
- The auth section of `AGENTS.md`, the README's new "Before you deploy" and `docs/limits.md` say that sign-up is open, so any visitor can register and use the cards that spend, and how to close it (`disableSignUp: true` in `auth.ts`).

- `doctor` has an `ignored` check: a project that isn't its own git repository, under a `.gitignore` that ignores everything (a dotfiles repository in `~` with `*`), has no files for `pnpm check` and no styles from Tailwind. It names the rule and its file, and its `fix` is `git init` in the project. `create` without a repository of its own (`--no-git`) says the same in one line, a `warnings` entry under `--json`.
- `upgrade` appends the env vars the stack reads that `.env.example` lacks, there and in the local settings file (`.dev.vars`, or `.env` with Alchemy) when there is one, as `add` does: no line already there changes. They are listed in the output and as `env` under `--json`, in `--check` too.
- Tagged errors survive the trip to the browser. A server function returns its Effect's `Exit`, encoded (`runOutcome(program, ...errors)`), and `useServerCall(fn, ...errors)` decodes it, so `state.error instanceof FileTooLarge` holds and `state.error.limit` is there. Every card's error state shows the error it received, with its fields, and the runtime card's code panel shows the client lines that match on it. An error you don't list still arrives as its tag and message; a call refused before it ran (no session, bad input) or a defect is `rejected: true`.
- `ServerOnly` (`packages/core/src/server-only.ts`): an error field that stays in the server log. A driver's `cause` uses it, so no raw driver text reaches the browser.
- Every service call is a named span (`Notes.list`, `Storage.put`, `Auth.currentSession`, ...) and every server function call is one (`serverFn.addNote`). Nothing records them until a tracer is set; then a trace reads by name.
- `layers.ts` has a telemetry slot, `TelemetryLive`, underneath `AppLayer`, so a tracer there reaches what a layer forks while it builds as well as each request. Add-ons fill it with the new `addTelemetry` transform.
- The generated `AGENTS.md` says how to add an error to a service and handle it in a component, to restart `pnpm dev` after adding a dependency, and where the Local Explorer is (`/cdn-cgi/local/explorer/`: D1 rows, R2 objects, Durable Object storage, Workflows, traces).
- `efforge add rpc` (or `--extras=rpc`): call Effect from TanStack Start with Effect RPC. `AppRpcs` in `packages/core/src/rpc.ts` is one contract for the server and the browser; `RpcLive`, a layer in `AppLayer`, serves it at `POST /api/rpc` from a Start server route, so its handlers run on the same layers as the server functions and each call is a span (`rpc.Greet`). `AppClient` (`AtomRpc`, `@effect/atom-react`) makes each call an atom: a failure arrives as its error's class with its fields, and a stream call streams. With auth, `/api/rpc` needs a session like the rest of `/api/`, and a call without one fails with `Unauthorized`, as a server function's does. A dashboard card calls it, shows the typed error and watches a stream; it adds about 40 KiB of gzipped JavaScript to the dashboard and nothing to the landing page. [docs/rpc.md](docs/rpc.md) compares it with a server function and `HttpApi`.
- An add-on's card module can have variants for different stacks: a later card file with the same target and its own `when`. Each is registered on its stacks.
- `efforge add cluster` (experimental): Effect Cluster, Effect Workflow and a durable queue on Durable Objects, through Effect's `@effect/platform-cloudflare` 4.1.4, pinned exactly with `effect`. A `Counter` entity keeps its count in its own SQLite; a `Review` workflow runs two activities around a durable wait for an approval; a `GreetingQueue` is drained by the request that offers to it, since nothing runs a worker in the background on Workers. The dashboard card, labelled experimental, increments a counter, starts and approves a run step by step, and offers a greeting; counters and runs are per user. It works on wrangler and on Alchemy (four `DurableObject` resources), beside `extras/workflows` and `extras/realtime`. `docs/cluster.md` walks through it and says what experimental means here: a durable sleep that is a run's first wait wakes about a minute late in 4.1.4, `pnpm dev` needs a restart after a handler changes, and a deploy is not tested.
- `doctor` checks that every Durable Object class a binding names is created by a migration in `wrangler.jsonc` and exported from the Worker entry.
- `doctor` has a `gates` check on stacks with auth: `sessionGate` first in `functionMiddleware` and passed to `createStart`, `requireApiSession` first in `workerRoutes`. A gate taken out, or something listed before it, fails with the lines to put back; on a project made before the gates, the fix is `upgrade`, which adds them.
- `add --dry-run` groups what it would write by add-on, as `create --dry-run` does, with rows for the files it edits and removes; `--verbose` lists every file.
- A new error code, `UpgradeFirst`: `add` refuses to write dashboard cards onto a project whose card boundary (`apps/web/src/server/outcome.ts`) is older than the cards, and writes nothing. `fix` is `upgrade`; `after` is the same `add`, to run once it is done.
- `upgrade --json` and `upgrade --check --json` have `notes`, as `add` does.

### Changed

- `create --dry-run` counts the files by the add-on they come from, with the top-level directories of each, instead of a flat list of 100 paths; `--verbose` lists every file, and `--json` always has them all.
- Terminal output: a run of steps is one line each, without a spacer line between them; the empty "Data", "Platform" and "Features" headers are gone; `create` and `add` end with their total time; the outro's lines line up; `--help` has a blank line before EXAMPLES and its global flags fit in 100 columns.
- Without a terminal, a `create` that would prompt now names `preset` first: `No terminal to ask for "preset": pass --preset=saas|ai|minimal or the stack flags, or --yes to accept the defaults.`
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
- The README's "Run it", `create`'s next steps and `nextSteps` under `--json` come from one function, and depend only on the stack in `efforge.jsonc`, never on which untracked files exist; the one exception is whether `pnpm db:migrate` is still owed, below.
- Whether `pnpm db:migrate` is still owed is read from the project, as `doctor`'s `migrations` check reads it, in the next steps of `create`, `add` and `upgrade` and in an `Interrupted` document. On D1 it is there while the local database lacks a migration: after an add-on that brings one (auth's tables, which `add` didn't mention), after a run that never migrated, and not once everything is applied. Postgres can't be read without connecting, so there it follows the migration files the run writes.
- `add` with no ids and no terminal, and `info` with no id, are `NoAddonIds` with `fix: null`: a list isn't an add. The ids are in `available`, and the message names the `list --json` command that says what each one adds. The fix property test now fails any fix that runs a different command from the one it fixes.
- `--wizard`, a built-in flag of the CLI library, isn't one of efforge's flags: without a terminal it showed a prompt, printed "Wizard cancelled." and exited 0. It is now an `UnknownFlag` error, and efforge's own prompts do its job. `docs/json.md` says what `--help`, `--version`, `--completions` and `--log-level` do with and without a terminal and `--json`; `-v --json` prints the envelope as `--version --json` does.
- Alchemy with Postgres: `DATABASE_URL` has no default keyed on the stage name, and `pnpm dev` turns TLS off only for a database on this machine (`localhost`, `127.0.0.1`, `::1`).
- Service interfaces grew. If you wrote your own implementation of one (a test fake, say), add the new members: `Jobs.events` (workflows), `Llm.streamText` (AI), `Storage.list` (storage), and `Mailer.transport` and `Mailer.from` (email). `StoredObject` gains `uploaded`; `StorageError`, `MailerError`, `JobError` and `BrowserError` carry a `message`.
- The storage programs take an owner: `upload(owner, name, type, bytes)`, `listUploads(owner)` and `deleteUpload(owner, key)`, each working only under `uploadsOf(owner)`. `Jobs.start` takes an optional `{ id }`; `startExample(owner, input)` and `watchExample(owner, id, after)` scope runs, and another owner's run is `UnknownRun`. An implementation of `Jobs` of your own should pass `id` on.
- The runtime card's `greet` is a `GET`: it changes nothing.
- The example server functions `example-job.ts` and `run-browser.ts` are now the cards' `workflows-demo.ts` and `browser-demo.ts`. A project made before cards (0.2.x) that adds workflows or browser gets the service, its layer and its tests but no demo server function, and `add` says so: its note now names the card files it left out instead of saying there is nothing to do.
- The browser container answers a refused address with 403 and a page that would not load with 502, and returns a screenshot.
- A missing or unusable setting names itself on the page and from `/api/auth/*`, for example `STORAGE_SIGNING_SECRET is too short`, a malformed `BETTER_AUTH_URL`, or an `LLM_PROVIDER` that is not a provider.
- Every region a card shows fits 80 characters on every stack, and the code column is never narrower than 80 characters of its font, so the code panel never scrolls sideways at 1280 px or wider; below that the demo and the code stack. A test checks every card on both infras, and the browser flow every tab at 1280 px.
- The README's Deploy section covers every add-on that binds a Cloudflare resource, from one record in `src/readme.ts`; a test fails for a new add-on with a wrangler binding until Deploy names it on both infras.

- Service errors in `packages/core` are `Schema.TaggedError` classes (were `Data.TaggedError`), and several carry the fields a UI needs: `InvalidName.length`, `InvalidNote.limit`, `MessageTooLarge.limit`, `FileTooLarge.size` and `limit`, `InvalidAddress.address`, `UrlRefused.url`, `InvalidUrl.url`.
- Effect's "experimental API" warning is off in `tsconfig.base.json` and lint, like the "unstable" one: an add-on that uses an experimental API (Effect Cluster) no longer fails `pnpm check`.
- A server function's errors are one list, declared beside it (`export const AnnounceErrors = [MessageTooLarge, RealtimeError] as const`) and spread on both sides: `runOutcome(program, ...AnnounceErrors)` and `useServerCall(announce, ...AnnounceErrors)`. The types hold them together: a client that lists other errors, one too few or none does not typecheck. Every card, `docs/capability-cards.md` and the generated `AGENTS.md` show it.
- The note `add auth` prints names every server function `pnpm check` now fails on, exported or not, in a route file too, and says what changed for routes: under `/api/` they need a session, outside it they check it themselves. `upgrade` prints the same note when it brings the session gates to a project made before them.
- The realtime room's rule for which sockets count is `isAttended` in `realtime-limits.ts`, with a test in the generated project.
- `docs/upgrading.md`'s worked example is today's output, and an end-to-end test holds each quoted line to a real run on the committed 0.2.0 project.

### Fixed

- `upgrade` of a 0.2.x project whose dashboard the owner edited left it failing its gate: a file held back for the owner's dashboard lost what it imported (`server/mailer.ts` stayed while the `Mailer` it builds moved), and the old server functions it kept failed the session lint. A held file now keeps what it imports, and on a stack with auth a held server file of efforge's gets `requireSession`.
- Under `alchemy dev` the realtime card said "Disconnected, retrying" and disabled Send while connected: the socket React's StrictMode had closed reported its late close. `connectRoom` ignores a socket it has given up on.
- At 390 px the storage card with a long file name, and the database card with a long unbroken note, pushed their buttons out of view; the browser flow now checks every card at 390 px with long input.
- An `LLM_PROVIDER` that is not a provider was reported as "not set"; it says it must be one of the four.
- A signed-out plain `GET` on the realtime socket's path answered 500; it gets 401. `HEAD` on a signed file link answers like `GET` instead of 404.
- `efforge/no-whole-file-import` covers `packages/` too; the build already stopped a whole-file import there.
- A project made by 0.2.0 on wrangler had no root `deploy` script after `upgrade`, so the deploy guide ended in "Missing script: deploy". `upgrade` now adds a script today's templates define that no release wrote for the project's stack, and still never puts back one a release wrote that you removed: the release history records which stacks got each script, regenerated from each release's own source.
- Every command efforge prints runs as written without a prompt: the `--help` examples, the generated README's "Add more", the landing page's `add` line and the `efforge.jsonc` schema said `npx create-efforge` without `-y`, which stops at npx's "Ok to proceed?" on a first run. A test collects the commands from the real output of every command, the generated projects and the schemas.
- Errors on stderr wrap at 80 columns like prompts and ordinary output, never inside a command or a path.
- Ctrl-C or Escape in `add`'s picker exits 130 with "Cancelled. Nothing written.", like every other prompt; it printed "This is a bug in efforge" and exited 1. A test finds every prompt in the source and cancels at each.
- Every prompt and every line of ordinary output fits 80 columns: the preset question wrapped at 80 and 100, and so did the picker's hints. Prose is wrapped under the guide, and a command too long for the line is printed whole on its own line. A test draws each prompt as a terminal does and fails on a wrapped line.
- `info --json` said `secret: false` for `BETTER_AUTH_SECRET`, `STORAGE_SIGNING_SECRET` and `LLM_ENCRYPTION_KEY`. `secret` now means the value is a secret (never print or commit the deployed one), and `set` means efforge wrote a local value, with the same meaning in `create`, `add` and `info`, which all give both. `doctor`'s `env` check gives each variable the same two fields.
- `add` reported `set: true` for an empty secret such as `LLM_API_KEY` when another line followed it in the local settings file.
- `-- create`, `-- add` and the other commands after `--` made a project of that name; a word after `--` is an argument, so efforge now refuses it and says to put the command before `--`.
- `--preset=SaaS` and `--database=D1` get the lower-case value as their fix.
- `--verbose` without `--dry-run` says it does nothing, instead of being silently ignored.
- A flag of another command on the root form (`x1 --write`) names the commands that take it; it said "add and list" for every one.
- `info` outside a project marks with `when` an edit only some stacks get, as it already did for files and env vars; `graph --json` no longer has a stray `provided` field on a layer you added.
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
- Better Auth no longer fails sign-ups on a cold Worker: its start-up goes to `waitUntil` instead of being awaited across requests.
- The realtime room counts only clients that are there, so the count stays right under `pnpm dev`.
- With Alchemy and the AI add-on, `pnpm dev` starts without `LLM_API_KEY`. Before, Alchemy refused to plan.
- `vite.config.ts` no longer warns about `./regions` on every `pnpm dev` and `pnpm build`.
- The browser add-on passes the lint of a project made by efforge 0.2.x (it read `_tag`, which that lint forbids).
- `scripts/history.ts` read `src/history.data.ts` with `JSON.parse`, which fails on the formatted file; it went on with an empty history, so the next release would have dropped every earlier one's record. It imports the module now.
- `add` wrote a re-export wider than 100 characters on one line, which `pnpm check` then reported; `addExport` writes it one name per line, as `create`'s formatter does.
- A route file under `/api/auth/` answered a signed-out request at `/API/auth/...` or `/%61pi/auth/...`: `requireApiSession` exempted the path after lower-casing and decoding it, while Better Auth's handler takes only the raw `/api/auth/`. A path is now public only as that handler serves it.
- `public-server-fns.json` and `public-api-paths.json` are checked as they load. A string where a list belongs no longer matches as a substring: a list of the wrong shape makes nothing public and says so in the server log.
- A `// #region card` line inside a template string or a string started a card region. The markers in a `.ts` or `.tsx` file are now read as comments by the parser.

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
