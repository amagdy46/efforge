# efforge

Start an [Effect](https://effect.website) app with database, auth, and Cloudflare services already wired together.

`npm create efforge` generates a TypeScript monorepo: a [TanStack Start](https://tanstack.com/start) app on Cloudflare Workers, with every capability written as an Effect service and layer. You pick the database, ORM, auth, infrastructure tool, AI and extras when you create the project, and `efforge add` adds more later.

Status: v0.1, early. Two defaults sit on pre-release dependencies (see [Status and limits](#status-and-limits)). MIT licensed ([LICENSE](./LICENSE)).

```console
$ npm create efforge my-app -- --yes --database=d1 --orm=effect-sql --auth=better-auth --extras=storage
┌   create-efforge   Effect apps on Cloudflare, already wired
│
◇  Your stack ─────────────────────────────────────────────────────────╮
│                                                                      │
│  name      my-app                                                    │
│  runtime   cloudflare                                                │
│  database  d1                                                        │
│  orm       effect-sql                                                │
│  auth      better-auth                                               │
│  infra     none                                                      │
│  ai        none                                                      │
│  extras    storage                                                   │
│                                                                      │
│  re-run non-interactively:                                           │
│  npm create efforge my-app -- --yes --database=d1 --orm=effect-sql   │
│  --auth=better-auth --extras=storage                                 │
│                                                                      │
├──────────────────────────────────────────────────────────────────────╯
│
◇  ✓ Writing files
│
◇  ✓ Initializing git
│
◇  ✓ Installing dependencies (pnpm install)
│
◇  ✓ Generating the route tree (tsr generate)
│
◇  ✓ Formatting (vp fmt)
│
◇  ✓ Creating the initial commit
│
└  Done.

  cd my-app
  pnpm dev
```

## Why efforge

Several scaffolders already cover parts of this stack. [Better-T-Stack](https://www.better-t-stack.dev) offers TanStack Start, Workers, a choice of database and auth, Alchemy, and add-ons after creation. [create-effect-app](https://github.com/Effect-TS/examples) gives you a basic, CLI or monorepo Effect project. `npm create cloudflare` gives you a TanStack Start app on Workers.

efforge is narrower: it is for building the whole server side in Effect, on Cloudflare.

- Each capability (database, auth, mail, storage, AI) is an Effect service with tagged errors in `packages/core`, implemented as a layer and composed in one file, `apps/web/src/server/layers.ts`.
- Cloudflare bindings are reached through Effect layers, never through `env` directly, so code that uses them can be tested with `@effect/vitest`.
- `efforge add` edits those seam files (layers, exports, bindings, secrets) with AST transforms instead of asking you to paste code.
- The generated `AGENTS.md` gives coding agents the same layout and rules, and `pnpm check` runs format, lint (with Effect diagnostics) and types.

Use something else if you want Next.js, a runtime other than Cloudflare, or plain async code without Effect.

## Install

Needs Node 24.11 or newer and pnpm. Generated projects use pnpm only.

```sh
npm create efforge my-app        # asks for each choice
cd my-app && pnpm dev            # http://localhost:5173
```

## Common commands

```sh
# accept the defaults: Postgres, Drizzle, Better Auth with organizations
npm create efforge my-app -- --yes

# see what a stack would write, without writing it
npm create efforge my-app -- --yes --database=d1 --orm=effect-sql --dry-run

# add an add-on to an existing project (run inside it)
npx create-efforge add email

# preview an add-on, then apply it
npx create-efforge add ai/effect-ai-byok extras/storage --dry-run
```

After creating a project, `efforge.jsonc` records the stack and a `command` that recreates it non-interactively.

## Stack options

| Slot | Options | Default |
|---|---|---|
| `runtime` | `cloudflare` | `cloudflare` |
| `database` | `postgres` (via Hyperdrive), `d1`, `none` | `postgres` |
| `orm` | `drizzle`, `effect-sql`, `none` | `drizzle` |
| `auth` | `better-auth-orgs`, `better-auth`, `none` | `better-auth-orgs` |
| `infra` | `none`, `alchemy` | `none` |
| `ai` | `none`, `effect-ai-byok` | `none` |
| `extras` (multi) | `workflows`, `realtime`, `browser`, `storage`, `email` | none |

Options are filtered by earlier choices. `orm` is set exactly when `database` is, and `auth` needs a database. With `infra=none`, bindings live in `wrangler.jsonc`; with `infra=alchemy`, they live in `infra/alchemy.run.ts` and there is no `wrangler.jsonc`.

### Flags

```
npm create efforge [name] -- [flags]

--runtime --database --orm --auth --infra --ai    one value each (see the table)
--extras workflows,realtime,...                   comma-separated
-y, --yes        accept defaults for anything a flag did not set
--dry-run        print the files that would be written; write nothing
--json           print {stack, command, files} as JSON (implies --yes)
--install / --no-install    run pnpm install (default: yes)
--git / --no-git            git init + initial commit (default: yes)
```

`efforge add <id...>` takes ids like `email`, `extras/email` or `ai/effect-ai-byok`, and the flags `--dry-run`, `--json`, `--cwd <dir>`, `--no-install` and `--overwrite`. It re-checks compatibility and refuses to overwrite generated files you have edited unless you pass `--overwrite`. Package scripts with the same name as an add-on's scripts are replaced either way, so check the diff.

## What you get

```
apps/web                 TanStack Start app (Worker entry, routes, shadcn/ui, Tailwind v4)
packages/core            service interfaces (Context.Service), tagged errors, schemas
packages/db              schema, migrations, DB layer          (when database != none)
infra/                   alchemy.run.ts                         (infra=alchemy)
apps/browser             Playwright container image             (extras=browser)
efforge.jsonc            the stack choices; `efforge add` reads it
AGENTS.md  CLAUDE.md     rules for AI agents and humans
```

The workspace uses a pnpm `catalog:` of exact version pins, Turborepo for `dev`, `build`, `typecheck` and `test`, and [Vite+](https://viteplus.dev) (Oxlint and Oxfmt) for `pnpm check`. Why Vite+: [decision 0001](./docs/decisions/0001-vite-plus.md).

## Status and limits

v0.1 is the first release and the CLI's options may still change.

- Cloudflare is the only runtime.
- You can add add-ons but not remove them, and a single-choice slot only moves from `none` to a value. To switch from Postgres to D1, create a new project.
- `infra=alchemy` uses Alchemy 2.0 **beta** (`2.0.0-beta.83`).
- Drizzle is pinned to a 1.0 **release candidate** (`1.0.0-rc.5-5935859`); see [decision 0002](./docs/decisions/0002-drizzle-rc-pin.md).
- CI generates, installs and runs the full gate (typecheck, check, test, build) for a matrix of 15 stacks, not every combination.
- With `--auth=none`, the `effect-ai-byok` demo server function (`apps/web/src/server/ai.ts`) is not gated, so anyone who can reach the app can spend the configured API key. Add auth or remove the demo before deploying.

### Troubleshooting

**`pnpm check` says "Expected at least one target file".** The formatter reads `.gitignore` files in parent directories, even outside a git repository. If a parent directory ignores everything (for example a dotfiles `~/.gitignore` containing `*`), a project created with `--no-git` sees no files. Run `git init` in the project; the default flow already does this.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for building and testing efforge itself, and [CHANGELOG.md](./CHANGELOG.md) for releases.

MIT licensed. See [LICENSE](./LICENSE).
