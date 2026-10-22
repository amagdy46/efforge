# Agent guide

Rules for AI agents (and humans) working in this repo. Read this before changing code.

## Layout

- `packages/core`: service interfaces (`Context.Service` tags), tagged errors, schemas. No runtime wiring.
- `apps/web/src/server/layers.ts`: the single place layers are composed into `AppLayer`.
- `apps/web/src/server/runtime.ts`: runs an Effect against `AppLayer`; server functions go through it.
- `apps/web/src/server.ts`: the Worker entry. Durable Object and Workflow classes are exported from here.
- `apps/web/src/server/routes.ts`: Worker-level routes (`workerRoutes`) tried before TanStack Start.
- `apps/web/src/routes`: TanStack Router file routes. `routeTree.gen.ts` is generated (and gitignored); never edit it.
- `apps/web/src/components/ui`: shadcn components.
- `efforge.jsonc`: the stack choices. `efforge add` reads it; leave it alone.

## Effect

- Model capabilities as services in `packages/core` and implement them as layers; wire layers in `layers.ts`.
- Failures are tagged errors (`Data.TaggedError`) in the error channel, handled with `Effect.catchTag`.
- Validate data at boundaries (requests, env, storage, third-party responses) with `Schema`.
- Reach Cloudflare bindings (R2, D1, KV, Durable Objects, ...) only through `effect-cf`.
  `apps/web/src/server/cloudflare.ts` is the one file that imports `env` from `cloudflare:workers`;
  lint rejects it anywhere else.
- Never wrap an Effect in `try/catch`, and never use `async`/`await` inside `Effect.gen`; use `yield*`.
- Provide layers at entry points only (`runtime.ts`, scripts), not inside library code.
- No `any`. Use `unknown` and narrow it with `Schema` or a type guard.
- Keep `E` types specific; `unknown` or `any` in an error channel is a lint error.
- Model a multi-step lifecycle (order, invite, job) as a tagged union of states
  (`Data.TaggedEnum`) and match on it, not as a set of boolean flags.

## Tests

- Write Effect tests with `it.effect` and `it.layer` from `@effect/vitest`. `Effect.run*` and
  `ManagedRuntime.make` in a test file are lint errors (`lint/effect-tests.js`).
- Swap services with test layers; do not mock modules.
- Where a fake would behave differently from the platform (D1, R2, Durable Objects, Workflows),
  check the behaviour under `pnpm dev` too: it runs your Worker in workerd with local bindings.

## UI

- Use the existing shadcn components in `components/ui` before writing new ones.
- Style with Tailwind classes and the theme tokens (`bg-background`, `text-muted-foreground`, ...), not hard-coded colors.
- No inline `style` props and no CSS-in-JS.
- Do not add a dependency unless the task cannot be done without it.

## Style

- Match the surrounding code: naming, file layout, error handling.
- No comments that restate the code. Comment only the non-obvious why.
- No placeholder code, TODOs or stubs; finish what you start or leave it out.
- No speculative abstractions: do not add options, layers or helpers nobody uses yet.
- No unused exports, imports or variables.
- No `console.log`; use `Effect.log`. `console.warn` and `console.error` are allowed.
- No defensive checks for cases the types already rule out.
- Do not disable lint rules to get a check passing. Fix the code. Generated files are already ignored.

## Commands

| Command                    | Use                                                               |
| -------------------------- | ----------------------------------------------------------------- |
| `pnpm dev`                 | Dev server                                                        |
| `pnpm check`               | Format check, lint (incl. Effect diagnostics), types              |
| `pnpm format`              | Apply formatting (oxfmt via Vite+)                                |
| `pnpm lint`                | Lint only                                                         |
| `pnpm typecheck`           | Regenerate the route tree, then type-check every workspace        |
| `pnpm --filter web routes` | Regenerate `routeTree.gen.ts` after adding or moving a route file |
| `pnpm test`                | Tests (`@effect/vitest`)                                          |
| `pnpm build`               | Build every workspace                                             |

Lint and format are configured in the root `vite.config.ts`. The Effect rules need the
patched install that `pnpm install` performs (`prepare` script); re-run it if they go quiet.
`routeTree.gen.ts` is not committed: `pnpm install` generates it (`postinstall` in `apps/web`),
`pnpm dev` and `pnpm build` keep it current, and `pnpm typecheck` regenerates it first, so a fresh
clone works after `pnpm install`. Run `pnpm --filter web routes` after adding a route file if
your editor reports a stale route tree.

## Before you finish

Run `pnpm check && pnpm typecheck && pnpm test && pnpm build` and fix everything it reports.
Zero errors and zero warnings are the bar.

<!-- efforge:agents -->
