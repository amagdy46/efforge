<!-- generated: header (pnpm brand) -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/amagdy46/efforge/main/.github/assets/lockup-dark.svg">
    <img src="https://raw.githubusercontent.com/amagdy46/efforge/main/.github/assets/lockup-light.svg" width="300" height="72" alt="efforge logo: a maker's punch with ef struck through it, beside the word efforge">
  </picture>
</h1>
<!-- /generated -->

<p align="center">
  Start a Cloudflare app where every server capability is an <a href="https://effect.website">Effect</a> service.<br>
  Pick a database, auth, AI and extras now; add more later with one command.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/create-efforge"><img src="https://img.shields.io/npm/v/create-efforge" alt="npm version"></a>
  <a href="https://github.com/amagdy46/efforge/actions/workflows/ci.yml"><img src="https://github.com/amagdy46/efforge/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/amagdy46/efforge/blob/main/LICENSE"><img src="https://img.shields.io/github/license/amagdy46/efforge" alt="MIT license"></a>
</p>

```sh
npm create efforge my-app
```

<p align="center">
  <img src="https://raw.githubusercontent.com/amagdy46/efforge/main/.github/assets/demo.gif" width="760" alt="Terminal recording: npm create efforge my-app picks Cloudflare D1, Effect SQL, Better Auth with organizations and Storage, installs and commits in a few seconds, then efforge add email adds a Mailer service and lists the new env vars">
</p>

`pnpm create efforge my-app` and `bun create efforge my-app` work too. The generated project uses pnpm, and needs Node 24.11+ or 26+.

## Why efforge

You get a TypeScript monorepo: a [TanStack Start](https://tanstack.com/start) app on Cloudflare Workers, with the server side written in Effect.

- **Every capability is a service.** Database, auth, mail, storage and AI are Effect services with tagged errors in `packages/core`, implemented as layers and composed in one file, `apps/web/src/server/layers.ts`. Swap a layer to test or to change a provider.
- **Cloudflare bindings stay at the edge of your code.** Only `apps/web/src/server/cloudflare.ts` reads the Worker environment. Everything else gets bindings through layers, so it runs under `@effect/vitest`.
- **`efforge add` edits code, not docs.** Adding email later wires the layer, the exports, the binding and the secrets with AST transforms, and refuses to overwrite a file you've changed.
- **Ready for coding agents.** The generated `AGENTS.md` describes the layout and its rules, and `pnpm check` runs format, lint (with Effect diagnostics) and types.

CI generates 15 stacks on every change, installs them and runs typecheck, lint, tests and a build on each. There is no telemetry.

Use something else if you want Next.js, a runtime other than Cloudflare, or plain async code without Effect: [create-effect-app](https://github.com/Effect-TS/examples) for an Effect project without the web stack, or `npm create cloudflare` for TanStack Start on Workers without Effect.

## Pick your stack

The prompts walk through these (and let you go back). Each one is also a flag, so `npm create efforge my-app -- --yes --database=d1 --orm=effect-sql` asks nothing.

| Slot | Options | Default |
|---|---|---|
| `database` | `postgres` (via Hyperdrive), `d1`, `none` | `postgres` |
| `orm` | `drizzle`, `effect-sql`, `none` | `drizzle` |
| `auth` | `better-auth-orgs`, `better-auth`, `none` | `better-auth-orgs` |
| `infra` | `none` (`wrangler.jsonc`), `alchemy` | `none` |
| `ai` | `none`, `effect-ai-byok` | `none` |
| `extras` | `workflows`, `realtime`, `browser`, `storage`, `email` | none |

`orm` is set exactly when `database` is, and `auth` needs a database. When it finishes, efforge prints the next steps for your stack (start Postgres, run migrations, `pnpm dev`) and a command that recreates the same stack.

## Add more later

```sh
npx create-efforge list                     # every add-on, ✓ for the ones you have
npx create-efforge add email                # wire one in
npx create-efforge add ai/effect-ai-byok extras/storage --dry-run   # see what would change
```

`add` reads the stack from `efforge.jsonc`, checks the new choice is compatible, writes the add-on's files and edits the files that compose the app. It computes everything first and writes nothing if any step fails. Files you've edited since they were generated are left alone unless you pass `--overwrite`, and it shows you the diff. When it's done it lists the new env vars to fill in. Run it with a clean git tree and review the result with `git diff`.

## For coding agents

Tell your agent to use efforge, or install the skill: `npx skills add amagdy46/efforge`. Without it, these commands are all an agent needs. `--json` never prompts and prints one JSON document; on failure, `error.fix` is the command to run instead.

```sh
npx -y create-efforge@latest create my-app --json --database=d1 --auth=better-auth
npx -y create-efforge@latest list --json --cwd my-app
npx -y create-efforge@latest add email --json --cwd my-app
```

Then, in `my-app`: `pnpm typecheck && pnpm check && pnpm test && pnpm build`. The skill ([skills/efforge/SKILL.md](https://github.com/amagdy46/efforge/blob/main/skills/efforge/SKILL.md)) says what each error means; [docs/json.md](https://github.com/amagdy46/efforge/blob/main/docs/json.md) is the full contract, and [llms.txt](https://github.com/amagdy46/efforge/blob/main/llms.txt) lists the docs.

## What you get

```
apps/web          TanStack Start app: Worker entry, routes, shadcn/ui, Tailwind v4
packages/core     service interfaces, tagged errors, schemas
packages/db       schema, migrations, database layer     (with a database)
infra/            alchemy.run.ts                         (infra=alchemy)
apps/browser      Playwright container image             (extras=browser)
efforge.jsonc     your stack choices, read by efforge add
AGENTS.md         layout and rules for coding agents
```

The workspace pins exact versions in a pnpm `catalog:`, runs `dev`, `build`, `typecheck` and `test` through Turborepo, and lints and formats with [Vite+](https://viteplus.dev) (Oxlint, Oxfmt).

## Status

Early: Cloudflare is the only runtime, add-ons can be added but not removed yet, and the CLI's options may still change. Drizzle is pinned to a release candidate and Alchemy support uses a beta. With `--auth=none`, the AI demo endpoint isn't gated; add auth or remove it before deploying. Details and known gaps: [docs/limits.md](https://github.com/amagdy46/efforge/blob/main/docs/limits.md).

## Docs

- [CLI reference](https://github.com/amagdy46/efforge/blob/main/docs/cli.md): every flag, CI and scripting, `add` in detail
- [`--json` contract](https://github.com/amagdy46/efforge/blob/main/docs/json.md): the output scripts and agents read, every error code
- [Contributing](https://github.com/amagdy46/efforge/blob/main/CONTRIBUTING.md) and the [changelog](https://github.com/amagdy46/efforge/blob/main/CHANGELOG.md)

Prompts by [Clack](https://github.com/bombshell-dev/clack). MIT licensed.
