# Agent guide

Rules for AI agents (and humans) working in this repo. Read this before changing code.

## Layout

- `packages/core`: service interfaces (`Context.Service` tags), tagged errors, schemas. No runtime wiring.
- `apps/web/src/server/layers.ts`: the single place layers are composed into `AppLayer`. `TelemetryLive` there, underneath every layer, is where a tracer goes.
- `apps/web/src/server/runtime.ts`: runs an Effect against `AppLayer`; server functions go through it.
- `apps/web/src/server.ts`: the Worker entry. Durable Object and Workflow classes are exported from here.
- `apps/web/src/server/routes.ts`: Worker-level routes (`workerRoutes`) tried before TanStack Start.
- `apps/web/src/routes`: TanStack Router file routes. `routeTree.gen.ts` is generated (and gitignored); never edit it.
- `apps/web/src/components/ui`: shadcn components.
- `apps/web/src/capabilities`: the dashboard's cards (`registry.ts`). A card shows a file's
  `// #region card` block (`?region=card`, cut by `apps/web/regions.ts`), which ships to the
  browser: never mark a secret, and keep the markers. Lint rejects `?raw` and other whole-file
  imports; `pnpm build` fails if a server file or a secret would ship.
- The dashboard is a starter surface. To remove it, replace `routes/app/index.tsx`, delete `capabilities/`, `components/{capability-card,code-block,layer-graph}.tsx`, `lib/{highlight,layer-graph}.ts` and the `@/server/...` files the cards import (`greeting.ts`, `notes.ts`, ..., not `stack.ts`), and in `server/stack.ts` drop the registry import and return `cards: []`. Run `pnpm typecheck`.
- `apps/web/src/server/outcome.ts`: `runOutcome(program, ...errors)` runs an Effect for a server function and returns its `Exit`, encoded; `useServerCall(fn, ...errors)` (`lib/use-server-call.ts`) decodes it, so a failure is the error's class again, fields included. A call refused before it ran (no session, bad input) or a defect has `rejected: true`.
- `efforge.jsonc`: the stack choices. `efforge add` reads it; leave it alone. To add a capability (email, storage, a database, auth, AI), run `npx -y create-efforge@latest add <id> --json` from the project root instead of wiring it by hand; `npx -y create-efforge@latest list --json` lists the ids.
- `README.md`: `efforge add` rewrites the text between each pair of `efforge:readme` markers; write anywhere else.

## Effect

- Model capabilities as services in `packages/core` and implement them as layers; wire layers in `layers.ts`.
- Failures are tagged errors in the error channel, handled with `Effect.catchTag`. To add one, declare it in the service's file with `Schema.TaggedError` (`class TitleTaken extends Schema.TaggedError<TitleTaken, { readonly brand: unique symbol }>()("TitleTaken", { message: Schema.String, title: Schema.String }) {}`) and fail with it; list it in the server function, `runOutcome(program, TitleTaken)`, and in the component, `useServerCall(fn, TitleTaken)`; then `state.error instanceof TitleTaken` holds, with `state.error.title`. A field that holds a driver's error is `cause: ServerOnly` (`packages/core/src/server-only.ts`): it stays in the server log. An error you don't list (a `Data.TaggedError`) still arrives, as its tag and message.
- End every method of a live layer with `Effect.withSpan("<Service>.<method>")`. Where a layer needs another service, provide that service's exported layer (`Layer.provide(AuthLive)`), not a copy built inline: Effect builds each layer value once, so it is `AppLayer`'s instance.
- Validate data at boundaries (requests, env, storage, third-party responses) with `Schema`.
- Reach Cloudflare bindings (R2, D1, KV, Durable Objects, ...) only through `effect-cf`.
  `apps/web/src/server/cloudflare.ts` is the one file that imports `env` from `cloudflare:workers`;
  lint rejects it anywhere else.
- Never wrap an Effect in `try/catch`, and never use `async`/`await` inside `Effect.gen`; use `yield*`.
- Provide layers at entry points only (`runtime.ts`, scripts), not inside library code.
- No `any`. Use `unknown` and narrow it with `Schema` or a type guard. Keep `E` types specific; `unknown` or `any` in an error channel is a lint error.
- Model a multi-step lifecycle (order, invite, job) as a tagged union of states
  (`Data.TaggedEnum`) and match on it, not as a set of boolean flags.

## Tests

- Write Effect tests with `it.effect` and `it.layer` from `@effect/vitest`. `Effect.run*` and
  `ManagedRuntime.make` in a test file are lint errors (`lint/effect-tests.js`).
- Swap services with test layers; do not mock modules. Put the logic in a program that needs a
  service (`createNote` needs `Notes`), give the test a layer that implements the service in
  memory, and check the result and the tagged error path:

  ```ts
  const NotesInMemory = Layer.effect(
    Notes,
    Effect.gen(function* () {
      const rows = yield* Ref.make<ReadonlyArray<Note>>([])
      return Notes.of({
        list: Ref.get(rows),
        insert: (title) => /* add a row to `rows` and return it */,
      })
    }),
  )

  layer(NotesInMemory)("createNote", (it) => {
    it.effect("refuses a blank title", () =>
      Effect.gen(function* () {
        expect(yield* Effect.flip(createNote("  "))).toBeInstanceOf(InvalidNote)
      }),
    )
  })
  ```

  With a database, `packages/core/test/notes.test.ts` is this test in full. A service with one fixed answer can use `Layer.succeed(Auth, Auth.of({ ... }))`. `it.effect` already gives each test a `TestClock`.

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
your editor reports a stale route tree. Restart `pnpm dev` after adding a dependency; until then
pages can fail with "Cannot read properties of null (reading 'useContext')". When `pnpm dev` prints
a Local Explorer address (`/cdn-cgi/local/explorer/`), open it to debug: the local D1 rows, R2
objects, Durable Object storage, Workflows runs, and each request's traces.

## Before you finish

Run `pnpm check && pnpm typecheck && pnpm test && pnpm build` and fix everything it reports.
Zero errors and zero warnings are the bar.

<!-- efforge:agents -->
