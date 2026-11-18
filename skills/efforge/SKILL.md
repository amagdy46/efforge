---
name: efforge
description: Create a full-stack Effect app on Cloudflare Workers (TanStack Start, D1 or Postgres, Better Auth, email, storage, AI) with the efforge CLI, or add one of those capabilities to an existing efforge project. Use when asked to start a new Effect or Cloudflare Workers web app, or when a project has an efforge.jsonc file and needs a database, auth, email, storage, AI, realtime, workflows or browser rendering.
license: MIT
compatibility: Needs Node 24.11+ or 26+, pnpm, git, and network access to the npm registry.
---

# efforge

efforge creates a TypeScript monorepo: a TanStack Start app on Cloudflare Workers whose server side is written in Effect. Every capability (database, auth, mail, storage, AI) is an Effect service with a layer. `add` wires another capability into an existing project.

Don't use it for Next.js, for a runtime other than Cloudflare, or for code without Effect.

## Rules

- Always pass `--json`. stdout is then exactly one JSON document, success or failure, and nothing prompts.
- Check `ok`. When it is `false`, read `error.code` and `error.message`, then run `error.fix` if it is not `null`. `fix` is your own command with the smallest change that works.
- Run `npx -y create-efforge@latest ...`, not `npm create efforge` (npm adds lines to stdout).
- The full contract, with every field and error code: https://raw.githubusercontent.com/amagdy46/efforge/main/docs/json.md

## Create a project

```sh
npx -y create-efforge@latest create my-app --json --database=d1 --auth=better-auth
```

It writes `./my-app`, runs `pnpm install`, formats, and makes the first git commit. It takes about a minute, most of it the install.

| Flag | Values | Default |
|---|---|---|
| `--database` | `postgres` (via Hyperdrive), `d1`, `none` | `postgres` |
| `--orm` | `drizzle`, `effect-sql`, `none` | `drizzle` |
| `--auth` | `better-auth-orgs`, `better-auth`, `none` | `better-auth-orgs` |
| `--infra` | `none` (`wrangler.jsonc`), `alchemy` | `none` |
| `--ai` | `none`, `effect-ai-byok` | `none` |
| `--extras` | comma-separated: `workflows`, `realtime`, `browser`, `storage`, `email` | none |

Rules: `orm` is `none` exactly when `database` is `none`, and `auth` needs a database. A flag you leave out takes its default. Postgres needs Docker for local development; D1 doesn't, so prefer `--database=d1` unless the user asked for Postgres.

Other flags: `--dry-run` (write nothing, list the files), `--no-install`, `--no-git`. The name is a directory under the current one; it must be a valid npm package name and the directory must not exist or be empty.

To preview without writing:

```sh
npx -y create-efforge@latest create my-app --json --dry-run --database=d1 --auth=better-auth
```

## Read the result

- `directory`: the project, absolute.
- `nextSteps`: commands still to run, in order, each with its `cwd`. Run them. A step with `longRunning: true` is the dev server (`pnpm dev`): start it in the background or leave it to the user.
- `env`: env vars the project reads. `set: false` means efforge wrote no local value: read `description` to see whether it has a default or must be filled in (in `file`, usually `.dev.vars`).
- `warnings`: things that didn't stop the run but you should tell the user (git commit skipped, unsupported Node).

## Add a capability

See what the project can add:

```sh
npx -y create-efforge@latest list --json --cwd my-app
```

Each entry of `addons` has the `id` to pass and `installed`. Then:

```sh
npx -y create-efforge@latest add email --json --cwd my-app
```

Ids: `email`, `storage`, `realtime`, `workflows`, `browser`, `ai`, `infra/alchemy`, `database/d1`, `database/postgres`, `orm/drizzle`, `orm/effect-sql`, `auth/better-auth`, `auth/better-auth-orgs`. Several at once is fine: `add email storage`. On a project without a database, add the database, an ORM and auth in one command: `add database/d1 orm/effect-sql auth/better-auth`.

The result lists `created`, `changed` and `removed` files, the new `env` vars, and `nextSteps` (often `pnpm install` or `pnpm db:migrate`). `add` writes nothing unless every step succeeds. Commit before you run it, so `git diff` shows only its changes.

## Errors

| `code` | What to do |
|---|---|
| `UnknownFlag`, `InvalidFlagValue`, `UnexpectedArgument`, `UnknownCommand`, `UnknownValue`, `InvalidProjectName` | Run `fix`. |
| `IncompatibleStack` | Run `fix`. For `add`, it adds the ids in `needs` to the same command. |
| `TargetNotEmpty` | The directory exists. Run `fix` (a free name), or ask the user. Never delete the directory yourself. |
| `NotAnEfforgeProject` | Run `fix` when it isn't null (it points `--cwd` at the project). Otherwise the directory isn't an efforge project. |
| `NoAddonIds`, `UnknownAddon` | Pick an id from `available` or `suggestions`, or run `fix` (the one suggestion, or `list`). |
| `SlotAlreadySet` | The project already has another choice for that slot, and swapping isn't supported. Tell the user; a different choice needs a new project. |
| `RemoveNotSupported` | Removing an add-on isn't supported. Tell the user. |
| `OverlayConflict` | `add` would replace files the user edited (`files`, `diff`). Nothing was written. Show the diff and ask before running `fix`, which adds `--overwrite` and discards those edits. |
| `TransformAnchorMissing` | Nothing was written. Apply `snippet` to `file` by hand, then run the same command again. |
| `PnpmMissing` | Install pnpm (`npm install --global pnpm`) and run the command again, or ask the user. |
| `SetupIncomplete`, `CommandFailed` | The files are written; a command failed (`output` says why, often the network). Run `fix` to finish. |
| `WriteFailed`, `InternalError` | Stop and tell the user, with `message`. |

Exit codes: `0` success, `1` error, `130` cancelled.

## Verify

In the project directory, after the `nextSteps` that aren't long-running:

```sh
pnpm typecheck && pnpm check && pnpm test && pnpm build
```

All four pass on a new project and after every `add`. If one fails after your own edits, fix your code, not the generated setup.

## Working in the project

Read `AGENTS.md` at the project root before you change code. It describes the layout and the rules that `pnpm check` enforces. In short: service interfaces and tagged errors live in `packages/core`, layers are composed in `apps/web/src/server/layers.ts`, only `apps/web/src/server/cloudflare.ts` reads the Worker environment, and tests use `@effect/vitest`. `efforge.jsonc` records the stack; leave it to `add`.
