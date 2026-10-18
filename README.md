# efforge

`npm create efforge` scaffolds a full-stack TypeScript app on an opinionated Effect stack: TanStack Start on Cloudflare, with the database, ORM, auth, infrastructure, AI and extras each chosen from a small set of options. Every part is a replaceable slot, and `efforge add` adds more later.

```sh
npm create efforge my-app          # interactive
cd my-app && pnpm dev
```

Needs Node 23.6 or newer and pnpm. Generated projects use pnpm only.

## Slots

Options are filtered by your earlier choices (for example `orm` needs a database). Pick them interactively or with flags.

| Slot | Options | Default |
|---|---|---|
| `runtime` | `cloudflare` | `cloudflare` |
| `database` | `postgres`, `d1`, `none` | `postgres` |
| `orm` | `drizzle`, `effect-sql`, `none` | `drizzle` |
| `auth` | `better-auth-orgs`, `better-auth`, `none` | `better-auth-orgs` |
| `infra` | `none`, `alchemy` | `none` |
| `ai` | `none`, `effect-ai-byok` | `none` |
| `extras` (multi) | `workflows`, `realtime`, `browser`, `storage`, `email` | none |

Rules: `orm` is set exactly when `database` is; `auth` needs a database; `d1`, `workflows`, `realtime` and `browser` need the Cloudflare runtime. With `infra=none` bindings live in `wrangler.jsonc`; with `infra=alchemy` they live in `infra/alchemy.run.ts` and there is no `wrangler.jsonc`.

## Flags

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

The summary before writing, and the `command` field of `efforge.jsonc`, give the exact non-interactive command that reproduces a stack.

```sh
npm create efforge my-app -- -y --database=d1 --orm=effect-sql --auth=better-auth --extras=storage,realtime
```

## `efforge add`

Adds an add-on to an existing project (run it in the project directory, or pass `--cwd`):

```sh
efforge add email
efforge add ai/effect-ai-byok extras/storage --dry-run
```

Ids are `email`, `extras/email` or `ai/effect-ai-byok`. `add` re-checks compatibility, merges files and edits seam files (layers, exports, bindings, workflow secrets) with idempotent AST transforms, and refuses to overwrite files you edited unless you pass `--overwrite`. Flags: `--overwrite`, `--dry-run`, `--json`, `--cwd <dir>`, `--no-install`. Removing an add-on is not supported in v0.1; single-select slots only move from `none` to a value.

**AI without auth:** with `--auth=none`, the `effect-ai-byok` demo server function (`apps/web/src/server/ai.ts`) is not gated, so anyone who can reach the app can spend the configured API key. Add auth or remove the demo before deploying.

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

- **Services and layers.** Capabilities are Effect services in `packages/core`, implemented as layers and composed in one place, `apps/web/src/server/layers.ts`. Server functions run through `runtime.ts`. Cloudflare bindings are reached only through `effect-cf` layers, never `env` directly.
- **Tooling.** pnpm workspace with a `catalog:` of exact pins, Turborepo for `dev`/`build`/`typecheck`/`test`, `@effect/vitest` for tests.
- **Vite+ lint and format.** A root `vite.config.ts` configures `vp lint` and `vp fmt` (Oxlint and Oxfmt), including Effect diagnostics from `@effect/tsgo`. `pnpm check` runs format check, lint and types; the generated `AGENTS.md` tells agents to run it and not to disable rules. See `docs/decisions/0001-vite-plus.md`.
- **AGENTS.md.** Layout, Effect conventions, UI and style rules, and the command table; add-ons append their own sections.

## Status and limits

v0.1 is unreleased.

- Cloudflare is the only runtime (D1 or Postgres through Hyperdrive).
- `infra=alchemy` uses `alchemy` 2.0 **beta** (`2.0.0-beta.83`).
- `drizzle-orm` and `drizzle-kit` are pinned to a 1.0 **release candidate** (`1.0.0-rc.5-5935859`).
- All versions are exact pins in `src/versions.ts`; `node scripts/bump.ts` compares them with npm.
- Templates are verified by generating real projects and running their full gate (`pnpm test:e2e`).

## Developing efforge

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm test:e2e                        # every stack; slow
pnpm test:e2e -t "stacks build minimal$"
node src/bin.ts my-app --dry-run     # run the CLI from source
node scripts/bump.ts [--write]       # pins vs npm latest
```

efforge lints and formats itself with Vite+ (`pnpm lint`, `pnpm format`, `pnpm check`). CI runs unit checks, one e2e job per stack, a browser-image build and the browser flow against Postgres.

MIT licensed.
