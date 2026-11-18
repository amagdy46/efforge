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

When it finishes, `create` prints the next steps for the stack: `docker compose up -d --wait` for Postgres, `pnpm db:migrate` when there is a database, then `pnpm dev` (or `cp .env.example .env` first with Alchemy).

Compatibility rules: `orm` is set exactly when `database` is; `auth` needs a database; `d1`, `workflows`, `realtime` and `browser` need the Cloudflare runtime. With `infra=none`, bindings live in `wrangler.jsonc`; with `infra=alchemy`, they live in `infra/alchemy.run.ts` and there is no `wrangler.jsonc`.

## CI, scripts and coding agents

efforge only prompts when stdin is a terminal and `CI` isn't set. Without one (CI, a pipe, `</dev/null`, `CI=1`), a prompt it would need fails at once and names the flag to pass, for example `No terminal to ask for "database": pass --database=postgres|d1|none, or --yes to accept the defaults.`, followed by `Try: <the command with --yes>`. Pass `--yes` plus the flags you care about. Every choice the prompts offer has a flag: the stack flags, the name argument (a non-empty directory is an error, not a re-ask) and `--yes` for the confirmation.

In CI or a pipe, each step prints one line instead of a spinner, and section headers are not printed. `NO_COLOR=1` turns colour off. Errors go to stderr, and end with `Try: <command>` when a command fixes them.

Exit codes: `0` success (and answering No at the confirmation), `1` an error, `130` cancelled with Ctrl-C. Cancelling during setup leaves the files written so far and prints the commands that finish the job.

`--json` makes `create`, `add` and `list` print exactly one JSON document on stdout, on success and on failure, and nothing else. It never prompts, and it still creates the project unless you add `--dry-run`. Errors carry a stable `code` and a `fix`: the command to run instead. The documents, every error code and the versioning rules are in [json.md](json.md); JSON Schemas ship in the package under `schemas/`. Under `npm create`, npm prints its own lines first; use `npx create-efforge ... --json`. Coding agents can learn all of this from one file: [skills/efforge/SKILL.md](../skills/efforge/SKILL.md).

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

`add` prints the files it creates (`+`) and changes (`~`), warns when it removes a generated file (for example `wrangler.jsonc` when you add Alchemy) or replaces a package script, and ends with the env vars the new add-ons need. It warns, but doesn't stop, when the git tree has uncommitted changes. It runs `pnpm install` only when dependencies changed. On a project that was never installed (`--no-install`), it skips the route tree and tells you to run `pnpm install`. With `--json`, success lists the files created and changed, the new env vars, `nextSteps` (commands still to run, such as `pnpm install` or `pnpm db:migrate`), `packageManager` and `notes`; see [json.md](json.md).

On a project made by efforge 0.2.0, `add` also repairs the Effect version guard: it adds the `overrides` to `pnpm-workspace.yaml` and raises `packageManager` from pnpm 12.4.2, which ignores them, to 12.21.0. When an add-on brings a dashboard widget (realtime) and the dashboard is still the one efforge generated, `add` replaces it with one that renders the widgets; if you edited it, `add` leaves it alone and prints what to add.

`add` re-checks compatibility, writes the add-on's files, and edits the files that compose the app (layers, exports, bindings, workflow secrets) with idempotent AST transforms. It records hashes of the template files it writes in `efforge.jsonc` and refuses to replace one you have edited unless you pass `--overwrite`; shared files such as `layers.ts` and `.dev.vars` are edited in place instead. Package scripts are different: an add-on's scripts replace scripts with the same name in your `package.json` either way, so review the diff.

Removing an add-on isn't supported yet, and a single-choice slot only moves from `none` to a value.

## Troubleshooting

**`pnpm check` says "Expected at least one target file".** The formatter reads `.gitignore` files in parent directories, even outside a git repository. If a parent directory ignores everything (for example a dotfiles `~/.gitignore` containing `*`), a project created with `--no-git` sees no files. Run `git init` in the project; the default flow already does this.

**The app returns 500 at startup.** A layer is missing configuration. Check `.dev.vars` against `.env.example`: each add-on lists the variables it needs there.
