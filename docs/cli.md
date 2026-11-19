# efforge CLI reference

## `npm create efforge`

```
npm create efforge [name] -- [flags]

--preset saas|ai|minimal                          the whole stack in one choice (see below)
--runtime --database --orm --auth --infra --ai    one value each (see the README's stack table)
--extras workflows,realtime,...                   comma-separated
-y, --yes        accept defaults for anything a flag did not set
--dry-run        count the files that would be written, by add-on; write nothing
--verbose        with --dry-run, list every file
--json           print one JSON document on stdout, nothing else (implies --yes; see json.md)
--install / --no-install    run pnpm install (default: yes)
--git / --no-git            git init + initial commit (default: yes)
```

`npm create` passes flags to efforge only after `--`. `pnpm create`, `bun create` and a direct call take them without it: `npx create-efforge my-app --yes --database=d1`.

Pass `.` as the name to create the project in the current directory, named after it. The target directory must be empty; a directory holding only `.git` counts as empty.

`npx create-efforge create my-app` is the same as `npx create-efforge my-app`. A first argument that looks like a command is refused rather than taken as a project name: a command in other case or one typo away (`Add`, `lst`, `ad`), or a word people guess as one (`help`, `update`, `init`, `install`, `ls` and the rest of `reservedWords` in `src/fix.ts`). Inside an efforge project the form without `create` creates nothing. `create lst` names a project `lst`, wherever you run it.

After the name, the first question is "Start from a preset, or choose each part?". A preset is a whole stack:

| Preset | Stack |
|---|---|
| `saas` | Postgres, Drizzle, Better Auth with organizations, email and storage |
| `ai` | D1, Effect SQL, Better Auth, AI with your own key, and realtime |
| `minimal` | No database and no auth: the app, its layers and the dashboard |

Every prompt, every line of ordinary output and every error on stderr fits 80 columns, broken only between words of prose: a path or a command is never split, and a command too long for the line is printed whole on its own line, so it can be copied.

Choosing one shows the stack and asks "Create it?" with three answers: Yes, Change parts, No. Change parts walks every part with the preset's as the defaults, so "SaaS, but on D1" is one change; the summary then reads "the SaaS preset, changed" and gives the flags that make the same stack without the prompts (`flags  --preset=saas --database=d1`). "Choose each part" walks the slots from the defaults, and Back from the first slot returns to this question.

`--preset=<name>` answers the question. A stack flag beside it wins, always, and is never dropped: `--preset=saas --database=d1` is the saas preset on D1. A choice of the preset that can't stand next to your flag is dropped, and the run says so: `--preset=saas --database=none` makes a project without Drizzle or auth, with a line (a `warnings` entry under `--json`) for each part dropped and why. A preset gives way only by leaving a part out, never by choosing one for you. So when your flag needs something neither it nor another flag gives, it is the usual `IncompatibleStack` error, with `alternatives` that are complete commands: `--preset=minimal --auth=better-auth` fails, because auth needs a database and the minimal preset has none, and the alternatives include `--auth=none`, another preset, and the same command with `--database=postgres --orm=drizzle`. Two flags that conflict with each other are the same error, as without a preset. Once you pass any stack flag or `--yes`, the question isn't asked. An unknown preset is an `UnknownValue` error that lists them. `list` and `list --json` show the presets, which live in one place, `src/presets.ts`.

A preset's contents can change between versions, so nothing records its name: the summary, the `command` in `efforge.jsonc` and `--json` give the stack as flags: one for each part that differs from the default. Running that command makes the same project with any later efforge whose defaults are the same; a part left at its default follows the default.

`--dry-run` prints a line per add-on, how many files it writes and in which top-level directories (`base 64 apps/web 45, (root) 13, ...`, then `auth/better-auth +20 ...`); `--verbose` lists every file under its add-on, and `--json` always has the full list. `create` has no `--cwd`: it creates the project under the directory you run it in, and every path it prints is relative to that; run it from there (`cd ~/projects && npx create-efforge my-app`).

Also available: `--help` (with examples), `--version`, `--completions bash|zsh|fish|powershell` (prints a completion script that covers both `create-efforge` and `efforge`) and `--log-level`, which efforge accepts and which changes nothing, since efforge logs nothing. None of them prompts. efforge has no `--wizard`: the prompts above do that job.

The summary before writing, and the `command` field of `efforge.jsonc`, give a non-interactive command that recreates the stack, for example:

```sh
npm create efforge my-app -- --yes --database=d1 --orm=effect-sql --auth=better-auth --extras=storage,realtime
```

When it finishes, `create` prints the next steps for the stack: `docker compose up -d --wait` for Postgres, `pnpm db:migrate` when there is a database, then `pnpm dev` (with Alchemy, no `db:migrate` on D1). Whether `pnpm db:migrate` is still owed is read from the project, as `doctor`'s `migrations` check reads it: on D1 it is there while the local database lacks a migration file, so `add` says it after an add-on that brings a migration (auth's tables) and after any earlier run that never migrated, and leaves it out when everything is applied. Postgres can't be read without connecting, so there it follows the migration files the run writes. The generated README's "Run it" has the same steps, from the same code, and its other sections (scripts, layout, capabilities, a first deploy for wrangler or Alchemy) are written for the stack too.

Compatibility rules: `orm` is set exactly when `database` is; `auth` needs a database; `d1`, `workflows`, `realtime` and `browser` need the Cloudflare runtime. With `infra=none`, bindings live in `wrangler.jsonc`; with `infra=alchemy`, they live in `infra/alchemy.run.ts` and there is no `wrangler.jsonc`.

## CI, scripts and coding agents

efforge only prompts when stdin is a terminal and `CI` isn't set. Without one (CI, a pipe, `</dev/null`, `CI=1`), a prompt it would need fails at once and names the flag to pass, for example `No terminal to ask for "preset": pass --preset=saas|ai|minimal or the stack flags, or --yes to accept the defaults.`, followed by `Try: <the command with --yes>`. Pass `--yes` plus the flags you care about. Every choice the prompts offer has a flag: the stack flags, the name argument (a non-empty directory is an error, not a re-ask) and `--yes` for the confirmation.

In CI or a pipe, each step prints one line instead of a spinner. In a terminal too, a run of steps is one line each, and `create` and `add` end with the total time. `NO_COLOR=1` turns colour off. Errors go to stderr, and end with `Try: <command>` when a command fixes them. Every command efforge prints (help examples, errors, next steps, the generated README and landing page) runs as written without a prompt: it starts with `npx -y create-efforge`, because `npx` without `-y` asks "Ok to proceed?" before its first download.

Exit codes: `0` success (and answering No at the confirmation), `1` an error, `2` `upgrade` or `doctor` found something that breaks the project, `3` `upgrade --check --strict` found something to apply, `130` cancelled with Ctrl-C. Cancelling during setup leaves the files written so far and prints the commands that finish the job.

`--json` makes `create`, `add`, `list`, `info`, `graph`, `upgrade` and `doctor` print exactly one JSON document on stdout, on success and on failure, and nothing else. It never prompts, and it still creates the project unless you add `--dry-run`. Errors carry a stable `code` and a `fix`: the command to run instead. The documents, every error code and the versioning rules are in [json.md](json.md); JSON Schemas ship in the package under `schemas/`. Under `npm create`, npm prints its own lines first; use `npx create-efforge ... --json`. Coding agents can learn all of this from one file: [skills/efforge/SKILL.md](../skills/efforge/SKILL.md).

Before writing anything, efforge checks that pnpm is installed (unless `--no-install`), warns about unsupported Node versions, and skips git if git isn't installed.

## `efforge list`

```sh
npx create-efforge list            # every add-on with a one-line description
npx create-efforge list --json     # {project, addons: [{id, slot, option, title, description, installed?}]}
```

Inside an efforge project (or with `--cwd`), add-ons the project already has are marked `✓`. Outside one, the list ends with the presets `create --preset` takes; `list --json` always has them, under `presets`.

## `efforge add`

Run inside a generated project, or pass `--cwd`:

```sh
npx create-efforge add email
npx create-efforge add ai/effect-ai-byok extras/storage --dry-run
```

Ids are `email`, `extras/email` or `ai/effect-ai-byok`, in any case. A slot name with one add-on (`ai`, `infra`) means that add-on; a typo or an ambiguous id (`auth`) gets a suggestion. Flags: `--overwrite`, `--dry-run`, `--json`, `--cwd <dir>`, `--no-install`.

The single-choice slots depend on each other, so add them together: on a project without a database, `add database/d1 orm/effect-sql auth/better-auth` works where `add auth/better-auth` alone is refused (the error lists each combination that works, as a command to run; which database and ORM is your choice).

`add` prints the files it creates (`+`) and changes (`~`), warns when it removes a generated file (for example `wrangler.jsonc` when you add Alchemy) or replaces a package script, and ends with the env vars the new add-ons need, then, for each new add-on, its dashboard card and the `AGENTS.md` sections it added, and links to the add-ons' docs pages. It rewrites the text between the `efforge:readme` markers of `README.md` to match the new stack and leaves the rest alone; a README without markers (from an older efforge, or rewritten) is not touched, and `add` says so in one line. It warns, but doesn't stop, when the git tree has uncommitted changes. It runs `pnpm install` only when dependencies changed. On a project that was never installed (`--no-install`), it skips the route tree and tells you to run `pnpm install`. With `--json`, success lists the files created and changed, the new env vars, `nextSteps` (commands still to run, such as `pnpm install` or `pnpm db:migrate`), `packageManager`, `notes` and `added` (one entry per new add-on with its `docs` link, its `card` file and the `agents` sections it added); see [json.md](json.md).

On a project made by efforge 0.2.0, `add` also repairs the Effect version guard: it adds the `overrides` to `pnpm-workspace.yaml` and raises `packageManager` from pnpm 12.4.2, which ignores them, to 12.21.0. When an add-on brings a dashboard widget (realtime) and the dashboard is still the one efforge generated, `add` replaces it with one that renders the widgets; if you edited it, `add` leaves it alone and prints what to add.

`add` re-checks compatibility, writes the add-on's files, and edits the files that compose the app (layers, exports, bindings, workflow secrets) with idempotent AST transforms. It records hashes of the template files it writes in `efforge.jsonc` and refuses to replace one you have edited unless you pass `--overwrite`; shared files such as `layers.ts`, `.env.example` and the local settings file are edited in place instead. Package scripts are different: an add-on's scripts replace scripts with the same name in your `package.json` either way, so review the diff.

Removing an add-on isn't supported yet, and a single-choice slot only moves from `none` to a value.

With no ids, in a terminal, `add` opens a picker: every add-on the project doesn't have, by slot, with its description beside the one under the cursor. Options of a slot the project already filled are shown disabled, with why (`add` can't swap a database). Space picks, Enter adds; picking nothing adds nothing. A pick the rules refuse (auth on a project without a database, and no database picked) is said, with what to pick with it, and asked again. After a pick, `add` prints the same command with the ids, so the next time needs no picker. Without a terminal (CI, a pipe, `CI=1`), and with `--json`, there is no picker: `add` with no ids is the `NoAddonIds` error, which lists the ids it can add.

## `efforge info <id>`

```sh
npx create-efforge info email
npx create-efforge info ai --json --cwd my-app
```

Describes one add-on from its manifest: what it is for, the Effect service and layer it adds, what a project needs first and what it conflicts with, the files it writes, the files it edits in place (the seams) with the transforms that edit them, packages, scripts, env vars, its dashboard card, the `AGENTS.md` sections it adds, and its page under `docs/addons/`. Ids resolve as `add` resolves them, the typo rule included. Inside a project (or with `--cwd`) it lists only what that project would get, and ends with whether the project has it, the command that adds it, or why it can't be added alone and the commands that add it with what it needs.

## `efforge graph`

```sh
npx create-efforge graph                  # Mermaid, for a README, an issue or a PR
npx create-efforge graph --format=text    # an indented list
npx create-efforge graph --json           # nodes and edges
npx create-efforge graph --write          # into README.md, kept current by add
```

Prints the project's layer graph: the layers `AppLayer` merges in `apps/web/src/server/layers.ts`, read from the file as it is, with what each provides and needs. The facts are the dashboard's: a card's `layer` (`provides`, `needs`), what `layers.ts` provides to a layer with `Layer.provide`, and, for a layer without a card, the service, bindings and settings its add-on declares. A layer you added yourself shows with provides and needs unknown. The Mermaid uses the tempering colours, one per layer in order, and renders on GitHub in light and dark. In a pipe, stdout carries only the graph (`graph > layers.mmd`).

`--write` puts the graph in `README.md` between `<!-- efforge:readme:graph -->` markers, after the capabilities section, under a "Layer graph" heading, following the same rules as the other README regions. From then on `add` redraws it. A README without `efforge:readme` markers, or with broken ones, is never touched: `graph --write` says why and writes nothing (`ReadmeUnwritable`).

## `efforge upgrade`

Run inside a generated project, or pass `--cwd`:

```sh
npx create-efforge upgrade --check            # what differs, what breaks, and what upgrade would do
npx create-efforge upgrade --dry-run          # the files upgrade would write; nothing written
npx create-efforge upgrade                    # apply it, then pnpm install
npx create-efforge upgrade --check --diff --file apps/web/src/routes/app/index.tsx   # efforge's version of one file
```

It renders today's templates for the project's own stack and compares, then applies what is still efforge's and leaves what is yours. How it tells them apart:

- **Files efforge wrote**: `efforge.jsonc` keeps a hash of each. Unchanged since efforge wrote it means efforge's; changed means yours.
- **Files efforge edits in place** (`layers.ts`, `AGENTS.md`, `wrangler.jsonc`, `auth.ts`), **pins, scripts and dependencies**: efforge keeps a record of what each release generated. A pin or script some release wrote is efforge's to move; one no release wrote is yours. An in-place file whose differences from today's template are all things a release wrote is efforge's older output; anything you added makes it yours.
- **Anything without a record is yours.**

`upgrade` then applies one consistent set: the Effect guard and a `packageManager` that honours it ([ADR 0005](decisions/0005-effect-lockstep-overrides.md)), the pins (a set that moves together moves as one), the scripts and dependencies efforge wrote, every file that is still efforge's, new files, and removal of files efforge no longer generates and you never changed. Where a new file needs something in a file you changed that efforge edits in place, such as the `// #region card` block the dashboard shows from `layers.ts`, efforge adds just that, with the same transforms `add` uses, and leaves the rest of your file alone. A change that would break a file of yours, for example a new version of `greeting.ts` that no longer exports what your edited dashboard imports, is held back with every file that needs it, and the output says which and why. Nothing is written if any step fails. It records the efforge version and the new hashes in `efforge.jsonc`, keeping your comments, and runs `pnpm install` when dependencies changed (`--no-install` to skip).

It refuses to run with uncommitted changes, so `git diff` shows exactly what it did; commit first, or pass `--allow-dirty`. An efforge older than the one that made or last upgraded the project refuses too, instead of undoing the newer one's work: use `npx -y create-efforge@latest`.

What it never does: put back a file you deleted, a section you removed from `AGENTS.md` or a layer you replaced; move a pin you set yourself (it holds the rest of that pin's set instead of splitting it); or replace a file you changed. Those files are listed under **Kept**, each with what efforge's change is for and the command that shows efforge's version.

`upgrade --check` prints the same plan without writing, leading with what breaks the project:

- **Needs action** (exit code `2`): a guard missing, efforge's pins of a set at two releases' versions, an import that is broken now (a file without the region another file shows), or an install owed. Most of these `upgrade` fixes; the rest come with the exact lines.
- **Behind**: nothing breaks, and `upgrade` has something to apply. Exit code `0`, or `3` with `--strict`.
- **Up to date**: nothing to apply. Files you changed that differ from efforge's templates are listed, and never count.

`--verbose` lists every pin and file; `--diff` adds each file against efforge's version (`--file <path>` for one). Exit code `1` is an error.

A CI job can gate on `upgrade --check`: it fails only when something breaks the project, not when efforge ships a newer template. Add `--strict` to fail when `upgrade` has something to apply. A scheduled job in generated projects was considered and left out for now ([ADR 0009](decisions/0009-upgrade-check-and-doctor.md)); the design of the apply is [ADR 0011](decisions/0011-upgrade-applies-what-efforge-can-prove.md).

## `efforge doctor`

```sh
npx create-efforge doctor           # one line per check, the fix under each problem
npx create-efforge doctor --json    # {status, checks: [{id, status, message, fix, details?}]}
```

Checks the checkout as it is now: Node and pnpm against `engines` and `packageManager`; that `node_modules` was installed by pnpm and matches the package.json files and `pnpm-lock.yaml`; that exactly one Effect version is installed (the one-line explanation of the 0.2.0 build failure); `pnpm peers check`, with the known upstream Alchemy `unenv` issue and optional peers reported as known; every env var the add-ons declare and the code reads, against `.dev.vars` (or `.env` with Alchemy) and `.env.example`, never printing a value; the bindings the stack needs in `wrangler.jsonc` or `infra/alchemy.run.ts`; D1 migrations not applied locally; whether the local Postgres answers (it starts nothing); `efforge.jsonc` against its schema; a layer in `layers.ts` for each add-on, read as code; and `upgrade --check`'s answer (a failure for needs action, a warning for behind).

Each problem comes with a fix you can run (after it, that check passes and nothing else gets worse), or with what to change when only you can. A check that can't read what it looks for, such as a layer of yours where efforge's was, says it could not verify, and isn't a failure. `pnpm peers check` runs with the pnpm `packageManager` pins when that pnpm made `node_modules`.

It changes nothing and uses no network unless you pass `--online` (to run `pnpm peers check` with a pinned pnpm this machine may not have yet, or to try a database on another host). Exit codes: `0` no check failed (warnings allowed), `2` a check failed, `1` an error.

## Troubleshooting

**`pnpm check` says "Expected at least one target file", or the app renders without styles.** The formatter and Tailwind both skip files a `.gitignore` ignores, and a project that isn't its own git repository is under the ignore rules of the repository around it. If that one ignores everything (a dotfiles repository in `~` with `*` in its `.gitignore`), a project created with `--no-git` has no files to check and no classes to style. `create` says so when it happens (a warning under `--json`), and `doctor`'s `ignored` check names the rule. Run `git init` in the project: a repository of its own has its own ignore rules. The default flow already does this.

**The app returns 500 at startup.** A layer is missing configuration. Run `npx create-efforge doctor`: its `env` check names each variable `.dev.vars` (`.env` with Alchemy) lacks. `.env.example` lists what each add-on needs, and a value marked "Fill in" is a secret only you have.

**A project made by an older efforge stopped building.** Run `npx create-efforge doctor`, then `npx create-efforge upgrade --check` to see what `upgrade` would change, and `npx create-efforge upgrade` to apply it.
