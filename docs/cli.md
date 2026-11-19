# efforge CLI reference

## `npm create efforge`

```
npm create efforge [name] -- [flags]

--runtime --database --orm --auth --infra --ai    one value each (see the README's stack table)
--extras workflows,realtime,...                   comma-separated
-y, --yes        accept defaults for anything a flag did not set
--dry-run        print the files that would be written; write nothing
--json           print one JSON document on stdout, nothing else (implies --yes; see json.md)
--install / --no-install    run pnpm install (default: yes)
--git / --no-git            git init + initial commit (default: yes)
```

`npm create` passes flags to efforge only after `--`. `pnpm create`, `bun create` and a direct call take them without it: `npx create-efforge my-app --yes --database=d1`.

Pass `.` as the name to create the project in the current directory, named after it. The target directory must be empty; a directory holding only `.git` counts as empty.

`npx create-efforge create my-app` is the same as `npx create-efforge my-app`. A first argument that looks like a command is refused rather than taken as a project name: a command in other case or one typo away (`Add`, `lst`, `ad`), or a word people guess as one (`help`, `update`, `init`, `install`, `ls` and the rest of `reservedWords` in `src/fix.ts`). Inside an efforge project the form without `create` creates nothing. `create lst` names a project `lst`, wherever you run it.

Also available: `--help` (with examples), `--version`, `--completions bash|zsh|fish` (prints a completion script that covers both `create-efforge` and `efforge`) and `--log-level debug`.

The summary before writing, and the `command` field of `efforge.jsonc`, give a non-interactive command that recreates the stack, for example:

```sh
npm create efforge my-app -- --yes --database=d1 --orm=effect-sql --auth=better-auth --extras=storage,realtime
```

When it finishes, `create` prints the next steps for the stack: `docker compose up -d --wait` for Postgres, `pnpm db:migrate` when there is a database, then `pnpm dev` (with Alchemy, no `db:migrate` on D1). The generated README's "Run it" has the same steps, from the same code, and its other sections (scripts, layout, capabilities, a first deploy for wrangler or Alchemy) are written for the stack too.

Compatibility rules: `orm` is set exactly when `database` is; `auth` needs a database; `d1`, `workflows`, `realtime` and `browser` need the Cloudflare runtime. With `infra=none`, bindings live in `wrangler.jsonc`; with `infra=alchemy`, they live in `infra/alchemy.run.ts` and there is no `wrangler.jsonc`.

## CI, scripts and coding agents

efforge only prompts when stdin is a terminal and `CI` isn't set. Without one (CI, a pipe, `</dev/null`, `CI=1`), a prompt it would need fails at once and names the flag to pass, for example `No terminal to ask for "database": pass --database=postgres|d1|none, or --yes to accept the defaults.`, followed by `Try: <the command with --yes>`. Pass `--yes` plus the flags you care about. Every choice the prompts offer has a flag: the stack flags, the name argument (a non-empty directory is an error, not a re-ask) and `--yes` for the confirmation.

In CI or a pipe, each step prints one line instead of a spinner, and section headers are not printed. `NO_COLOR=1` turns colour off. Errors go to stderr, and end with `Try: <command>` when a command fixes them.

Exit codes: `0` success (and answering No at the confirmation), `1` an error, `2` `upgrade --check` or `doctor` found something, `130` cancelled with Ctrl-C. Cancelling during setup leaves the files written so far and prints the commands that finish the job.

`--json` makes `create`, `add`, `list`, `upgrade --check` and `doctor` print exactly one JSON document on stdout, on success and on failure, and nothing else. It never prompts, and it still creates the project unless you add `--dry-run`. Errors carry a stable `code` and a `fix`: the command to run instead. The documents, every error code and the versioning rules are in [json.md](json.md); JSON Schemas ship in the package under `schemas/`. Under `npm create`, npm prints its own lines first; use `npx create-efforge ... --json`. Coding agents can learn all of this from one file: [skills/efforge/SKILL.md](../skills/efforge/SKILL.md).

Before writing anything, efforge checks that pnpm is installed (unless `--no-install`), warns about unsupported Node versions, and skips git if git isn't installed.

## `efforge list`

```sh
npx create-efforge list            # every add-on with a one-line description
npx create-efforge list --json     # {project, addons: [{id, slot, option, title, description, installed?}]}
```

Inside an efforge project (or with `--cwd`), add-ons the project already has are marked `✓`.

## `efforge add`

Run inside a generated project, or pass `--cwd`:

```sh
npx create-efforge add email
npx create-efforge add ai/effect-ai-byok extras/storage --dry-run
```

Ids are `email`, `extras/email` or `ai/effect-ai-byok`, in any case. A slot name with one add-on (`ai`, `infra`) means that add-on; a typo or an ambiguous id (`auth`) gets a suggestion. With no ids, `add` says which add-ons the project can still add. Flags: `--overwrite`, `--dry-run`, `--json`, `--cwd <dir>`, `--no-install`.

The single-choice slots depend on each other, so add them together: on a project without a database, `add database/d1 orm/effect-sql auth/better-auth` works where `add auth/better-auth` alone is refused (the error lists each combination that works, as a command to run; which database and ORM is your choice).

`add` prints the files it creates (`+`) and changes (`~`), warns when it removes a generated file (for example `wrangler.jsonc` when you add Alchemy) or replaces a package script, and ends with the env vars the new add-ons need, then, for each new add-on, its dashboard card and the `AGENTS.md` sections it added, and links to the add-ons' docs pages. It rewrites the text between the `efforge:readme` markers of `README.md` to match the new stack and leaves the rest alone; a README without markers (from an older efforge, or rewritten) is not touched, and `add` says so in one line. It warns, but doesn't stop, when the git tree has uncommitted changes. It runs `pnpm install` only when dependencies changed. On a project that was never installed (`--no-install`), it skips the route tree and tells you to run `pnpm install`. With `--json`, success lists the files created and changed, the new env vars, `nextSteps` (commands still to run, such as `pnpm install` or `pnpm db:migrate`), `packageManager`, `notes` and `added` (one entry per new add-on with its `docs` link, its `card` file and the `agents` sections it added); see [json.md](json.md).

On a project made by efforge 0.2.0, `add` also repairs the Effect version guard: it adds the `overrides` to `pnpm-workspace.yaml` and raises `packageManager` from pnpm 12.4.2, which ignores them, to 12.21.0. When an add-on brings a dashboard widget (realtime) and the dashboard is still the one efforge generated, `add` replaces it with one that renders the widgets; if you edited it, `add` leaves it alone and prints what to add.

`add` re-checks compatibility, writes the add-on's files, and edits the files that compose the app (layers, exports, bindings, workflow secrets) with idempotent AST transforms. It records hashes of the template files it writes in `efforge.jsonc` and refuses to replace one you have edited unless you pass `--overwrite`; shared files such as `layers.ts`, `.env.example` and the local settings file are edited in place instead. Package scripts are different: an add-on's scripts replace scripts with the same name in your `package.json` either way, so review the diff.

Removing an add-on isn't supported yet, and a single-choice slot only moves from `none` to a value.

## `efforge upgrade --check`

Run inside a generated project, or pass `--cwd`:

```sh
npx create-efforge upgrade --check            # what differs from this efforge, and what to do
npx create-efforge upgrade --check --diff     # also each file against today's template
npx create-efforge upgrade --check --patch | git apply   # make the changes that keep your edits
```

It renders today's templates for the project's own stack and compares, without writing anything. The report, summary first:

- **Versions**: each catalog pin against efforge's: behind, ahead, the same, or not one efforge manages. Pins that move together are grouped (the Effect family, drizzle-orm with drizzle-kit, alchemy and its Cloudflare provider, the lint toolchain, TanStack, React, Tailwind), so nobody bumps half a set.
- **Guards**: the overrides that hold every Effect package at one version, and a `packageManager` new enough to honour them ([ADR 0005](decisions/0005-effect-lockstep-overrides.md)). Their absence is what broke 0.2.0 projects.
- **Generated files**: `efforge.jsonc` keeps a hash of each file efforge wrote, not its content, so efforge can tell who changed a file but can't merge. `refresh`: you haven't touched it and the template moved on, safe to replace. `review`: you changed it and so did the template. `yours`: you changed it; nothing to do. `new`: efforge generates it today and the project lacks it. `differs`: a file efforge edits in place (`layers.ts`, `AGENTS.md`), which has no hash and differs from today's template.
- **Seams**: what efforge's transforms or templates would add today that the project lacks: an `AGENTS.md` section, a binding, a dependency, `engines`.
- **Scripts**: package scripts that differ from today's template.
- **What to do**: the steps in order, each a command or the exact lines to put in a file, ending with the project's gate.

`--patch` prints, and nothing else, one git patch of every change except files you edited: the guard, the pins, seams, refreshed and new files, and their hashes in `efforge.jsonc` (so a later `add` still treats them as efforge's). Commit first; `git apply` refuses the patch if a file changed since the report. To take efforge's version of a file you are reviewing, `npx create-efforge upgrade --check --diff | git apply --include=<file>`. `--verbose` lists every pin and file. Bare `upgrade` (applying changes itself) isn't there yet and says so.

Exit codes: `0` nothing to do, `2` drifted (a guard is missing or `--patch` has something), `1` an error. Files you edited, deleted or keep differently never count, so a project can always get back to `0`, and a CI job can gate on it.

A scheduled job in generated projects that runs this weekly was considered and left out ([ADR 0009](decisions/0009-upgrade-check-and-doctor.md)): run it yourself, or add a step to your own CI.

## `efforge doctor`

```sh
npx create-efforge doctor           # one line per check, the fix under each problem
npx create-efforge doctor --json    # {status, checks: [{id, status, message, fix, details?}]}
```

Checks the checkout as it is now: Node and pnpm against `engines` and `packageManager`; that `node_modules` matches the lockfile and package.json files; that exactly one Effect version is installed (the one-line explanation of the 0.2.0 build failure); `pnpm peers check`, with the known upstream Alchemy `unenv` issue and optional peers reported as known; every env var the add-ons declare and the code reads, against `.dev.vars` (or `.env` with Alchemy) and `.env.example`, never printing a value; the bindings the stack needs in `wrangler.jsonc` or `infra/alchemy.run.ts`; D1 migrations not applied locally; whether the local Postgres answers (it starts nothing); `efforge.jsonc` against its schema; a layer in `layers.ts` for each add-on; and whether `upgrade --check` has something to do.

It changes nothing and uses no network unless you pass `--online` (to run `pnpm peers check` when your pnpm differs from `packageManager`, which may download it, or to try a database on another host). Exit codes: `0` no check failed (warnings allowed), `2` a check failed, `1` an error.

## Troubleshooting

**`pnpm check` says "Expected at least one target file".** The formatter reads `.gitignore` files in parent directories, even outside a git repository. If a parent directory ignores everything (for example a dotfiles `~/.gitignore` containing `*`), a project created with `--no-git` sees no files. Run `git init` in the project; the default flow already does this.

**The app returns 500 at startup.** A layer is missing configuration. Run `npx create-efforge doctor`: its `env` check names each variable `.dev.vars` (`.env` with Alchemy) lacks. `.env.example` lists what each add-on needs, and a value marked "Fill in" is a secret only you have.

**A project made by an older efforge stopped building.** Run `npx create-efforge doctor`, then `npx create-efforge upgrade --check` to see what `upgrade` would change, and `npx create-efforge upgrade` to apply it.
