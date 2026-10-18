# efforge

[![npm](https://img.shields.io/npm/v/create-efforge)](https://www.npmjs.com/package/create-efforge)
[![CI](https://github.com/amagdy46/efforge/actions/workflows/ci.yml/badge.svg)](https://github.com/amagdy46/efforge/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/create-efforge)](https://github.com/amagdy46/efforge/blob/main/LICENSE)

Start an [Effect](https://effect.website) app with database, auth, and Cloudflare services already wired together.

`npm create efforge` generates a TypeScript monorepo: a [TanStack Start](https://tanstack.com/start) app on Cloudflare Workers, where each capability is an Effect service and layer. You choose the database, ORM, auth, infrastructure tool, AI and extras when you create the project, and `efforge add` adds more later.

Status: v0.1, early. The default ORM (Drizzle) is pinned to a release candidate, and the optional Alchemy support uses a beta. Needs Node 24.11+ and pnpm. MIT licensed.

```console
$ npm create efforge my-app -- --yes --database=d1 --orm=effect-sql --auth=better-auth --extras=storage
┌   create-efforge   Effect apps on Cloudflare, already wired
◇  Your stack ─────────────────────────────────────────────────────────╮
│  name      my-app                                                    │
│  runtime   cloudflare                                                │
│  database  d1                                                        │
│  orm       effect-sql                                                │
│  auth      better-auth                                               │
│  infra     none                                                      │
│  ai        none                                                      │
│  extras    storage                                                   │
├──────────────────────────────────────────────────────────────────────╯
◇  ✓ Writing files
◇  ✓ Initializing git
◇  ✓ Installing dependencies (pnpm install)
◇  ✓ Generating the route tree (tsr generate)
◇  ✓ Formatting (vp fmt)
◇  ✓ Creating the initial commit
└  Done.
```

(Output abridged: blank lines and the re-run command are left out.)

## Why efforge

Several scaffolders already cover parts of this stack. [Better-T-Stack](https://www.better-t-stack.dev) offers TanStack Start, Workers, a choice of database and auth, Alchemy, and add-ons after creation. [create-effect-app](https://github.com/Effect-TS/examples) gives you a basic, CLI or monorepo Effect project. `npm create cloudflare` gives you a TanStack Start app on Workers.

efforge is narrower: it is for writing the whole server side in Effect, on Cloudflare.

- Each capability (database, auth, mail, storage, AI) is an Effect service with tagged errors in `packages/core`, implemented as a layer and composed in one file, `apps/web/src/server/layers.ts`.
- Application code gets Cloudflare bindings through Effect layers; only `apps/web/src/server/cloudflare.ts` reads the Worker environment. Code that uses bindings can be tested with `@effect/vitest`.
- `efforge add` wires a new add-on into the layers, exports, bindings and secrets with AST transforms, instead of asking you to paste code.
- The generated `AGENTS.md` gives coding agents the same layout and rules, and `pnpm check` runs format, lint (with Effect diagnostics) and types.

Use something else if you want Next.js, a runtime other than Cloudflare, or plain async code without Effect.

## Quick start

```sh
npm create efforge my-app        # asks for each choice
cd my-app
```

Then, depending on the database you picked:

```sh
# Postgres (the default): start the bundled database, then migrate
docker compose up -d
pnpm db:migrate

# D1: apply migrations to the local D1 database
pnpm db:migrate

pnpm dev                         # http://localhost:5173
```

`.dev.vars` is generated with development-only secrets. Replace them, and set them as Worker secrets, before deploying.

## Common commands

```sh
# accept the defaults: Postgres, Drizzle, Better Auth with organizations
npm create efforge my-app -- --yes

# list the files a stack would write, without writing them
npm create efforge my-app -- --yes --database=d1 --orm=effect-sql --dry-run

# add an add-on to an existing project (run inside it)
npx create-efforge add email

# preview two add-ons without changing the project
npx create-efforge add ai/effect-ai-byok extras/storage --dry-run
```

`efforge.jsonc` in the generated project records the stack and a `command` that recreates it. All flags, `add` behaviour and troubleshooting: [docs/cli.md](https://github.com/amagdy46/efforge/blob/main/docs/cli.md).

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

Options are filtered by earlier choices. `orm` is set exactly when `database` is, and `auth` needs a database. With `infra=none`, bindings live in `wrangler.jsonc`; with `infra=alchemy`, they live in `infra/alchemy.run.ts`.

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

The workspace uses a pnpm `catalog:` of exact version pins, Turborepo for `dev`, `build`, `typecheck` and `test`, and [Vite+](https://viteplus.dev) (Oxlint and Oxfmt) for `pnpm check`.

## Status and limits

v0.1 is the first release, and the CLI's options may still change.

- Cloudflare is the only runtime.
- You can add add-ons but not remove them, and a single-choice slot only moves from `none` to a value. To switch from Postgres to D1, create a new project.
- `infra=alchemy` uses Alchemy 2.0 beta (`2.0.0-beta.83`). Drizzle is pinned to `1.0.0-rc.5-5935859` ([why](https://github.com/amagdy46/efforge/blob/main/docs/decisions/0002-drizzle-rc-pin.md)).
- CI generates, installs and runs the full gate (typecheck, check, test, build) for a matrix of 15 stacks, not every combination.
- With `--auth=none`, the `effect-ai-byok` demo server function is not gated, so anyone who can reach the app can spend the configured API key. Add auth or remove the demo before deploying.

## Contributing

Building and testing efforge itself: [CONTRIBUTING.md](https://github.com/amagdy46/efforge/blob/main/CONTRIBUTING.md). Releases: [CHANGELOG.md](https://github.com/amagdy46/efforge/blob/main/CHANGELOG.md).

MIT licensed. See [LICENSE](https://github.com/amagdy46/efforge/blob/main/LICENSE).
