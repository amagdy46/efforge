---
name: efforge
description: Create a full-stack Effect app on Cloudflare Workers (TanStack Start, D1 or Postgres, Better Auth, email, storage, AI) with the efforge CLI, or add one of those capabilities to an existing efforge project. Use when asked to start a new Effect or Cloudflare Workers web app, or when a project has an efforge.jsonc file and needs a database, auth, email, storage, AI, realtime, workflows or browser rendering.
license: MIT
compatibility: Needs create-efforge 0.3.0 or later, Node 24.11+ or 26+, pnpm, git, and network access to the npm registry.
---

# efforge

efforge creates a TypeScript monorepo: a TanStack Start app on Cloudflare Workers whose server side is written in Effect. Every capability (database, auth, mail, storage, AI) is an Effect service with a layer. `add` wires another capability into an existing project.

Don't use it for Next.js, for a runtime other than Cloudflare, or for code without Effect.

This skill needs create-efforge 0.3.0 or later: the first version with the `--json` contract it describes.

## Rules

- Always pass `--json`. stdout is then exactly one JSON document, success or failure, and nothing prompts.
- Check the version first: `npx -y create-efforge@latest --version --json` prints `{"efforge": "...", "contract": 1, "ok": true}`. If it prints a line of text instead, or any document has no `contract` field, the CLI is older than 0.3.0 and this skill doesn't apply: tell the user, and don't guess at its output. If `contract` is greater than 1, read the contract below again before you rely on a field.
- Check `ok`. When it is `false`, read `error.code` and `error.message`. `error.fix` is either a command that does what you were trying to do, or `null`; it never picks a different capability, never creates something you didn't ask for, and keeps your name and flags. Run it when it isn't `null`, with the same `npx -y create-efforge@latest` prefix you used (a `fix` starts with `npx -y create-efforge`).
- When `fix` is `null` and the error has `alternatives`, there is more than one way out (which database, or which of two conflicting flags gives way). Each entry is `{ command, description }`, a complete command. Pick the one that matches what the user asked for, or ask them; don't take the first one blindly. A database or ORM can't be swapped after `add`, so ask when the user gave no preference (D1 is the usual choice: no Docker).
- Run `npx -y create-efforge@latest ...`, not `npm create efforge` (npm adds lines to stdout).
- The full contract, with every field and error code: https://raw.githubusercontent.com/amagdy46/efforge/main/docs/json.md

## Create a project

```sh
npx -y create-efforge@latest create my-app --json --database=d1 --auth=better-auth
```

It writes `./my-app`, runs `pnpm install`, formats, and makes the first git commit. It takes a minute or two, most of it the install; allow it at least five minutes before a timeout. If it is stopped anyway, it still prints one document (`Interrupted`) with the steps that finish the job. If stdout is empty (killed outright), run the same command again: it answers `TargetNotEmpty` with the steps that finish the project it started.

| Flag | Values | Default |
|---|---|---|
| `--database` | `postgres` (via Hyperdrive), `d1`, `none` | `postgres` |
| `--orm` | `drizzle`, `effect-sql`, `none` | `drizzle` |
| `--auth` | `better-auth-orgs` (users plus organizations, members and invitations), `better-auth` (users and sessions only), `none` | `better-auth-orgs` |
| `--infra` | `none` (`wrangler.jsonc`), `alchemy` | `none` |
| `--ai` | `none`, `effect-ai-byok` | `none` |
| `--extras` | comma-separated: `workflows`, `realtime`, `browser`, `storage`, `email` | none |

Rules: `orm` is `none` exactly when `database` is `none`, and `auth` needs a database. A flag you leave out takes its default. Postgres needs Docker for local development; D1 doesn't, so prefer `--database=d1` unless the user asked for Postgres.

Other flags: `--dry-run` (write nothing, list the files), `--no-install`, `--no-git`. The name is one word, a directory under the current one; it must be a valid npm package name and the directory must not exist or be empty. Always write `create` before it: a first word that looks like a command (`help`, `lst`, `update`, `init`) is refused, and so is a create without `create` run inside an existing efforge project.

To preview without writing:

```sh
npx -y create-efforge@latest create my-app --json --dry-run --database=d1 --auth=better-auth
```

## Read the result

- `directory`: the project, absolute.
- `nextSteps`: commands still to run, in order, each with its `cwd`. Run them. A step with `longRunning: true` is the dev server (`pnpm dev`): start it in the background or leave it to the user.
- `env`: env vars the project reads. `set: false` means efforge wrote no local value: read `description` to see whether it has a default or must be filled in (in `file`, usually `.dev.vars`).
- `command`: a command that creates the same stack again without prompts.
- `warnings`: things that didn't stop the run but the user should know (git commit skipped, unsupported Node, an install a previous run left undone). Read them and tell the user.

## Add a capability

See what the project can add:

```sh
npx -y create-efforge@latest list --json --cwd my-app
```

Each entry of `addons` has the `id` to pass and `installed`. `add` takes the full id (`extras/email`) or the part after the slash when it names one add-on (`email`). Then:

```sh
npx -y create-efforge@latest add email --json --cwd my-app
```

Ids: `email`, `storage`, `realtime`, `workflows`, `browser`, `ai`, `infra/alchemy`, `database/d1`, `database/postgres`, `orm/drizzle`, `orm/effect-sql`, `auth/better-auth`, `auth/better-auth-orgs`. Several at once is fine: `add email storage`. On a project without a database, add the database, an ORM and auth in one command: `add database/d1 orm/effect-sql auth/better-auth`.

The result lists `created`, `changed` and `removed` files, the new `env` vars, and `nextSteps` (often `pnpm install --no-frozen-lockfile` or `pnpm db:migrate`). Run the `nextSteps`. `notes` is work `add` left for you, one line each (for example, a line to add to a dashboard the user edited): do each one, or tell the user why you didn't. Read `warnings` and pass them on to the user. `add` checks everything before it writes: an error before the write (`UnknownAddon`, `IncompatibleStack`, `OverlayConflict`, ...) leaves the project as it was. A failed install afterwards (`CommandFailed`) leaves the files written. Commit before you run it, so `git diff` shows only its changes.

## Errors

| `code` | What to do |
|---|---|
| `UnknownFlag`, `UnexpectedArgument` | Run `fix` when it isn't `null`. When it is, the message says what's wrong; correct the command yourself. |
| `InvalidFlagValue` | No fix: choose from `allowed` (when present) and run the command again. |
| `InvalidProjectName` | Run `fix` when it isn't `null` (only case and spaces changed). A path (`../app`) gets none: run efforge from the directory the project should go in, with just the name. |
| `UnknownCommand` | The first word isn't a command. Run `fix` (the command it names) when it isn't `null`; otherwise use one of `commands`. To name a project like a command, write `create <name>`. |
| `InsideProject` | You ran a create without the word `create` inside an efforge project (`project`). To change that project, use `add`. Only if the user wants a project inside it, run `create <name>`. |
| `UnknownValue` | Run `fix` when it isn't `null` (a clear typo, corrected). Otherwise choose from `allowed`; if what the user wants isn't there, efforge doesn't offer it: tell them. |
| `IncompatibleStack` | No fix: two choices conflict, or `add` needs another add-on with it. Pick from `alternatives` (see Rules) and run that command. For `add`, `needs` names the slots to fill and the ids that can fill each. |
| `TargetNotEmpty` | The directory exists. With `project: true` it holds an efforge project: when `fix` isn't `null` it is the project this command started (same `stack` as `requested`): run `fix`, then `nextSteps`. When `fix` is `null` and `stack` differs from `requested`, it is a different project: ask the user for another name or whether to use it. With `project: false`, ask for another name. Never delete the directory yourself. |
| `Interrupted` | The run was stopped (exit code 130). Run `fix` when it isn't `null`, then the rest of `nextSteps`. For `add` with `written: false`, run the same command again. |
| `NotAnEfforgeProject` | Run `fix` when it isn't null (it points `--cwd` at the project). Otherwise the directory isn't an efforge project. |
| `NoAddonIds` | Pick an id from `available`, or run `fix` (it lists them). |
| `UnknownAddon` | Run `fix` when it isn't `null` (a clear typo, or the one id a fragment names). Otherwise pick from `suggestions`, or run `list --json` for the ids the project can add; if what the user wants isn't there, efforge doesn't offer it: tell them. |
| `SlotAlreadySet` | The project already has another choice for that slot, and swapping isn't supported. Tell the user; a different choice needs a new project. |
| `RemoveNotSupported` | Removing an add-on isn't supported. Tell the user. |
| `OverlayConflict` | `add` would replace files the user edited (`files`, `diff`). Nothing was written. Show the diff and ask before running `fix`, which adds `--overwrite` and discards those edits. |
| `TransformAnchorMissing` | Nothing was written. Apply `snippet` to `file` by hand, then run the same command again. |
| `PnpmMissing` | Install pnpm (`npm install --global pnpm`) and run the command again, or ask the user. |
| `SetupIncomplete`, `CommandFailed` | The files are written; a command failed (`output` says why, often the network). Run `fix`, then the rest of `nextSteps`; the error also carries `env`. Running the same `add` again also finishes the install it owes. |
| `WriteFailed`, `InternalError` | Stop and tell the user, with `message`. |

A code not in this table is newer than this skill: treat it as a failure, run `fix` if it isn't `null`, and otherwise tell the user `message`.

Exit codes: `0` success, `1` error, `130` stopped (with `--json`, `create` and `add` still print an `Interrupted` document; stopped in the first moment, before anything was written, stdout can be empty: run the same command again).

## Verify

In the project directory, after the `nextSteps` that aren't long-running:

```sh
pnpm typecheck && pnpm check && pnpm test && pnpm build
```

All four pass on a new project and after every `add`. If one fails after your own edits, fix your code, not the generated setup.

## Working in the project

Read `AGENTS.md` at the project root before you change code. It describes the layout and the rules that `pnpm check` enforces. In short: service interfaces and tagged errors live in `packages/core`, layers are composed in `apps/web/src/server/layers.ts`, only `apps/web/src/server/cloudflare.ts` reads the Worker environment, and tests use `@effect/vitest`. `efforge.jsonc` records the stack; leave it to `add`.
