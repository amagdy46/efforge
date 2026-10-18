# Agent guide

Rules for AI agents (and humans) working in this repo. Read this before changing code.

## Layout

- `packages/core`: service interfaces (`Context.Service` tags), tagged errors, schemas. No runtime wiring.
- `apps/web/src/server/layers.ts`: the single place layers are composed into `AppLayer`.
- `apps/web/src/server/runtime.ts`: runs an Effect against `AppLayer`; server functions go through it.
- `apps/web/src/server.ts`: the Worker entry. Durable Object and Workflow classes are exported from here.
- `apps/web/src/server/routes.ts`: Worker-level routes (`workerRoutes`) tried before TanStack Start.
- `apps/web/src/routes`: TanStack Router file routes. `routeTree.gen.ts` is generated; never edit it.
- `apps/web/src/components/ui`: shadcn components.
- `efforge.jsonc`: the stack choices. `efforge add` reads it; leave it alone.

## Effect

- Model capabilities as services in `packages/core` and implement them as layers; wire layers in `layers.ts`.
- Failures are tagged errors (`Data.TaggedError`) in the error channel, handled with `Effect.catchTag`.
- Validate data at boundaries (requests, env, storage, third-party responses) with `Schema`.
- Reach Cloudflare bindings (R2, D1, KV, Durable Objects, ...) only through `effect-cf`.
- Never wrap an Effect in `try/catch`, and never use `async`/`await` inside `Effect.gen`; use `yield*`.
- Provide layers at entry points only (`runtime.ts`, scripts), not inside library code.
- No `any`. Use `unknown` and narrow it with `Schema` or a type guard.
- Keep `E` types specific; `unknown` or `any` in an error channel is a lint error.

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

| Command          | Use                                                  |
| ---------------- | ---------------------------------------------------- |
| `pnpm dev`       | Dev server                                           |
| `pnpm check`     | Format check, lint (incl. Effect diagnostics), types |
| `pnpm format`    | Apply formatting (oxfmt via Vite+)                   |
| `pnpm lint`      | Lint only                                            |
| `pnpm typecheck` | Type-check every workspace                           |
| `pnpm test`      | Tests (`@effect/vitest`)                             |
| `pnpm build`     | Build every workspace                                |

Lint and format are configured in the root `vite.config.ts`. The Effect rules need the
patched install that `pnpm install` performs (`prepare` script); re-run it if they go quiet.

## Before you finish

Run `pnpm check && pnpm typecheck && pnpm test && pnpm build` and fix everything it reports.
Zero errors and zero warnings are the bar.

<!-- efforge:agents -->
