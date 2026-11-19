# Why your app is shaped like this

Every server capability in an efforge project (database, auth, email, storage, AI) is built from the same three pieces: an interface, a layer that implements it, and one line in one file that puts the layer in the app. A test swaps the layer for another. This page follows one capability, notes, through those pieces, then shows the two places where Cloudflare and Effect meet, then the path of one request.

You need TypeScript and to have heard of Effect; each Effect term is defined where it first appears. The code comes from a project made with the default stack, `npm create efforge my-app -- --yes` (Postgres, Drizzle and Better Auth). Every project with a database has the same notes code.

## The idea in one picture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/amagdy46/efforge/main/docs/assets/layers-dark.svg">
  <img src="https://raw.githubusercontent.com/amagdy46/efforge/main/docs/assets/layers-light.svg" width="520" alt="Diagram: the Notes interface; NotesLive implements it and is listed in AppLayer; in a test, NotesInMemory implements it instead and layer(NotesInMemory) provides it. The list below gives the same facts.">
</picture>

The same facts as text:

1. **The interface.** `Notes`, in `packages/core/src/notes.ts`, has `list` and `insert(title)`, which can fail with `NotesUnavailable`. Code such as `createNote` asks for `Notes` and never sees a layer.
2. **A layer.** `NotesLive`, in `packages/db/src/notes.ts`, implements `Notes` with queries on the `note` table.
3. **One file composes.** `apps/web/src/server/layers.ts` lists the app's layers in `AppLayer`. `NotesLive` is in it as part of `DatabaseLayer`, next to `AuthLive`.
4. **A test swaps the layer.** In `packages/core/test/notes.test.ts`, `NotesInMemory` also implements `Notes` and keeps notes in memory. `layer(NotesInMemory)` gives it to the tests in place of `NotesLive`.

## 1. A capability is an interface

The notes interface, from `packages/core/src/notes.ts`:

<!-- sample: packages/core/src/notes.ts -->
```ts
export class Notes extends Context.Service<
  Notes,
  {
    /** Newest first */
    readonly list: Effect.Effect<ReadonlyArray<Note>, NotesUnavailable>
    readonly insert: (title: string) => Effect.Effect<Note, NotesUnavailable>
  }
>()("@repo/core/Notes") {}
```

An **Effect** is a description of work that has not run yet. `Effect.Effect<Note, NotesUnavailable>` means: when it runs, it succeeds with a `Note` or fails with a `NotesUnavailable`. Failures are part of the type, so the compiler knows how `insert` can fail. `list` is itself an Effect, which reads the notes each time it runs; `insert` is a function that returns one.

`Notes` is a **service**: a named interface that code asks for instead of importing an implementation. `Context.Service` declares one. Its first type is the service itself and its second is the interface; the string at the end is the service's name. The empty `()` in between is part of how Effect spells it.

Code that uses the service, from the same file:

<!-- sample: packages/core/src/notes.ts -->
```ts
export const createNote = (
  input: string,
): Effect.Effect<Note, InvalidNote | NotesUnavailable, Notes> =>
  Effect.gen(function* () {
    const title = input.trim()
    if (title.length === 0 || title.length > 200)
      return yield* new InvalidNote({
        message: "A note needs a title of 1 to 200 characters.",
        limit: 200,
      })
    const notes = yield* Notes
    return yield* notes.insert(title)
  })
```

`Effect.gen` reads like `async` code, with `yield*` for `await`. `yield* Notes` asks for the service, and `yield* new InvalidNote(...)` fails with that error. The return type has a third part this time, the services the Effect needs: `createNote` cannot run until something provides `Notes`.

`InvalidNote` and `NotesUnavailable` are **tagged errors**: classes with a `_tag` field, so code can handle each kind of failure by name, for example with `Effect.catchTag("InvalidNote", ...)`. They are declared with `Schema.TaggedError`, so each also has a schema: that is what lets one cross from a server function to the browser as the same class, fields included (see "How a request flows").

Interfaces, their errors and code like `createNote` live in `packages/core`. It has no Cloudflare code, so it type-checks and tests anywhere.

## 2. A layer implements it

A **layer** builds a service. It may need other services, and it can fail while it builds. `NotesLive`, from `packages/db/src/notes.ts`:

<!-- sample: packages/db/src/notes.ts -->
```ts
export const NotesLive = Layer.effect(
  Notes,
  Effect.gen(function* () {
    const { db } = yield* Database
    return Notes.of({
      list: db
        .select({ id: note.id, title: note.title, createdAt: note.createdAt })
        .from(note)
        .orderBy(desc(note.createdAt))
        .pipe(Effect.mapError(notesUnavailable), Effect.withSpan("Notes.list")),
```

`Layer.effect(Notes, ...)` builds `Notes` by running an Effect. That Effect asks for another service, `Database`, which holds a Drizzle client whose queries are Effects. So `NotesLive` needs `Database` before it can build. `Notes.of({ ... })` is the implementation: an object with the interface's members. `x.pipe(f)` passes `x` through `f`; here `Effect.mapError(notesUnavailable)` turns a driver error into a `NotesUnavailable`, and `Effect.withSpan("Notes.list")` names the call for a trace (it costs nothing until a tracer is set in `layers.ts`; every member of every live layer has one). The file goes on to implement `insert` the same way.

Layers live next to the code they wrap: the database ones in `packages/db`, the ones that use other Cloudflare resources in `apps/web/src/server`.

## 3. One file composes the layers

`apps/web/src/server/layers.ts` is the only place layers are put together:

<!-- sample: apps/web/src/server/layers.ts -->
```ts
export const AppLayer = Layer.mergeAll(
  Logger.layer([Logger.consolePretty()]),
  DatabaseLayer.pipe(Layer.provide(WorkerEnvLive)),
  AuthLive,
  /* efforge:layers */
).pipe(Layer.provideMerge(TelemetryLive))
```

`Layer.mergeAll` combines layers into one that provides every service they provide. `DatabaseLayer` comes from `packages/db/src/layer.ts`, and it is `NotesLive` together with the database client it needs:

<!-- sample: packages/db/src/layer.ts -->
```ts
export const DatabaseLayer = NotesLive.pipe(Layer.provideMerge(DatabaseLive))
```

`Layer.provideMerge(DatabaseLive)` gives `NotesLive` the `Database` it needs and keeps `Database` in the result, so the app gets both services. In `layers.ts`, `Layer.provide(WorkerEnvLive)` gives `DatabaseLayer` what it needs in turn, the Worker's bindings, and unlike `provideMerge` leaves them out of the result. The next section explains `WorkerEnvLive`.

`AppLayer` provides every service the app has. `efforge add` adds layers before the `/* efforge:layers */` marker, so keep the `Layer.mergeAll(...)` shape. To change how a service works, change the layer listed here; code that asks for `Notes` stays the same.

`TelemetryLive`, just above `AppLayer` in the same file, is where a tracer or an exporter goes. It is empty in a new project. `Layer.provideMerge(TelemetryLive)` puts it underneath the merged layers rather than beside them, so a fiber a layer forks while it builds (a server, a queue runner) is traced as well as each request; a tracer merged into the list would miss those fibers. An add-on puts its tracer there with the `addTelemetry` transform.

A layer that needs another service provides that service's own exported layer (`Layer.provide(AuthLive)`, or `DatabaseLayer` and `WorkerEnvLive`), never a copy built inline. Effect builds each layer value once per runtime, so it is the same instance `AppLayer` holds.

## 4. A test swaps one out

A **test layer** is another implementation of the same interface, made for tests. From `packages/core/test/notes.test.ts`:

<!-- sample: packages/core/test/notes.test.ts -->
```ts
const NotesInMemory = Layer.effect(
  Notes,
  Effect.gen(function* () {
    const rows = yield* Ref.make<ReadonlyArray<Note>>([])
    return Notes.of({
      list: Ref.get(rows),
      insert: (title) =>
        Effect.gen(function* () {
          const all = yield* Ref.get(rows)
          const note = {
            id: String(all.length + 1),
            title,
            createdAt: new Date(yield* Clock.currentTimeMillis),
          }
          yield* Ref.set(rows, [note, ...all])
          return note
        }),
    })
  }),
)
```

It has the same shape as `NotesLive`, with an array where the table was. A `Ref` is a value that Effects can read and replace; it holds the array. `Clock.currentTimeMillis` reads the time from Effect's clock, which a test controls. The tests run `createNote` with `layer(NotesInMemory)` instead of `NotesLive`, so they need no database. [Swap a layer to test](testing.md) walks through the whole file.

## Two places where Cloudflare and Effect meet

### Only `cloudflare.ts` reads the Worker environment

A **binding** is how a Worker reaches a Cloudflare resource: `HYPERDRIVE` (the connection to Postgres), a D1 database, an R2 bucket. Cloudflare passes bindings in an object called `env`, and one file reads it:

<!-- sample: apps/web/src/server/cloudflare.ts -->
```ts
import { env } from "cloudflare:workers"
import { Layer } from "effect"
import { WorkerEnvironment } from "effect-cf"

/**
 * The Worker's `env` as effect-cf's `WorkerEnvironment`. This is the only place `env` is read;
 * everything else gets bindings through effect-cf layers (Hyperdrive, D1, KV, R2, ...) that
 * need `WorkerEnvironment`.
 */
export const WorkerEnvLive = Layer.succeed(WorkerEnvironment, env)
```

`cloudflare:workers` exports `env` to any module, so `WorkerEnvLive` can hold it as a layer. A layer that needs a binding, such as `DatabaseLayer`, asks `WorkerEnvLive` for it; [effect-cf](https://github.com/danieljvdm/effect-cf) supplies the layers that do the asking (Hyperdrive, D1, R2 and others).

<!-- quote: vite.config.ts -->
What this prevents: `cloudflare:workers` exists only inside workerd, Cloudflare's runtime, so a file that imports it cannot load under Vitest in Node. Because only `cloudflare.ts` imports it, the rest of the code loads in tests. Lint enforces the rule: importing `env` anywhere else fails `pnpm check` with "Read bindings through effect-cf layers; only server/cloudflare.ts reads env."

### One file runs your Effects: `runtime.ts`

A **server function** is a TanStack Start function that runs on the server; the browser calls it like an ordinary async function. A **runtime** runs Effects: it builds the layers an Effect needs, runs it, and closes what the layers opened. Every server function hands its Effect to `runtime.runPromise`, from `apps/web/src/server/runtime.ts`, directly or through a helper; it returns a Promise.

When the runtime builds `AppLayer` depends on one thing, the database:

- **Postgres** (the default): it builds `AppLayer` for each call and closes it when the call ends. A Postgres connection is a socket, and a Worker may not use a socket that another request opened. Hyperdrive pools the real connections, so a new client per call is cheap.
- **D1, or no database**: it builds `AppLayer` once per isolate and reuses it. An **isolate** is one running copy of your Worker; it serves many requests. These layers hold bindings, not connections, and a binding works in any request.

The Postgres runtime:

<!-- sample: apps/web/src/server/runtime.ts -->
```ts
export const runtime = {
  runPromise: <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof AppLayer>>): Promise<A> =>
    Effect.runPromise(Effect.provide(effect, checkSettings(AppLayer))),
}
```

With D1 or no database, the runtime is a `ManagedRuntime`, Effect's ready-made runtime that builds its layer once:

<!-- sample: repo:templates/base/files/web/src/server/runtime.ts -->
```ts
export const runtime = ManagedRuntime.make(checkSettings(AppLayer))
```

`checkSettings` turns a missing setting into a clear `NotConfigured` error that names the setting and the file it goes in.

What this prevents: two Worker errors that come from reusing a connection across requests. Using a socket that another request opened fails with "Cannot perform I/O on behalf of a different request", and waiting on one can hang until Cloudflare ends the request with "The script will never generate a response". The Postgres runtime opens and closes its connection inside each call, so no socket outlives its request. Every server function goes through this file, so the rule is written once.

## How a request flows

The dashboard at `/app` has a card for the database. When it loads, it calls the `listNotes` server function. That call, from the browser to Postgres:

<!-- paths -->
```text
listNotes(), called by the database card
  card        apps/web/src/capabilities/database.tsx  calls listNotes()
  server fn   apps/web/src/server/notes.ts            runOutcome(program, errors)
  outcome     apps/web/src/server/outcome.ts          runtime.runPromise
  runtime     apps/web/src/server/runtime.ts          builds AppLayer for this call
  service     packages/core/src/notes.ts              Notes, its list member
  layer       packages/db/src/notes.ts                NotesLive, a Drizzle query
  layer       packages/db/src/layer.ts                DatabaseLayer, on HYPERDRIVE
  binding     apps/web/src/server/cloudflare.ts       WorkerEnvLive supplies env
  Postgres    through Hyperdrive
```

The server function, from `apps/web/src/server/notes.ts`:

<!-- sample: apps/web/src/server/notes.ts -->
```ts
export const listNotes = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(() => runOutcome(newestFirst, NotesUnavailable))
```

`requireSession` gives the handler the session (`sessionGate`, which runs before every server function, has already refused a call without one). `newestFirst` is `Notes.use((notes) => notes.list)`: it asks for `Notes` and runs `list`. `runOutcome` runs the Effect through `runtime.runPromise`, as a span named after the function (`serverFn.listNotes`), and returns its `Exit`, encoded for the wire: the value, or the tagged errors it failed with. The classes after the program are the errors to keep as classes; the card names the same ones:

<!-- sample: apps/web/src/capabilities/database.tsx -->
```tsx
  const notes = useServerCall(listNotes, NotesUnavailable)
```

`useServerCall` decodes the `Exit`, so `notes.state.error` is a `NotesUnavailable` again, with its `reason`, and `instanceof` works on it. An error the function did not list (a `Data.TaggedError`, say) arrives with its tag and message only. Three things never become a value:

- **A refused call.** The session gate's `Unauthorized`, the validator's `InvalidInput`, and a server that did not answer reject the call; `useServerCall` reports them with `rejected: true`, so a card can tell them from the function's own failures.
- **A bug.** A defect (an exception in the program) rejects the call as a 500, as `runtime.runPromise` would.
- **A raw driver error.** A field declared `ServerOnly` (`packages/core/src/server-only.ts`), such as `NotesUnavailable`'s `cause`, stays in the server log; encoding drops it.

A missing setting is `NotConfigured`, a value like any other, which names the setting and the file to put it in. [Capability cards](capability-cards.md) describes the cards and how an add-on contributes one.

## What `efforge add` changes

`efforge add extras/email` (and every other add-on) does three things:

1. **Writes the add-on's own files**: its interface, its layers, its tests, and its dashboard card if it has one.
2. **Edits the seams.** A **seam** is a place in a generated file that is there for add-ons to extend: the `AppLayer` list before `/* efforge:layers */`, the card list in `apps/web/src/capabilities/registry.ts`, the Worker's routes in `apps/web/src/server/routes.ts`, the re-exports in `packages/core/src/index.ts`, the bindings in `wrangler.jsonc` or `infra/alchemy.run.ts`, `.dev.vars`, `.env.example`, `AGENTS.md` and `package.json`. Some add-ons also edit a generated file at a known place: email adds invitation emails to `apps/web/src/server/auth.ts` when the project has organizations, and AI adds a tab to `apps/web/src/routes/app/settings.tsx`.
3. **Records** the add-on, and a hash of every file it wrote, in `efforge.jsonc`.

Each edit is an AST transform (a change to the parsed code, not to its text), so it adds only its own lines, and running `add` twice changes nothing.

Some add-ons write a file the project already has; auth, for example, writes its own `apps/web/src/routes/app.tsx`. `add` replaces such a file only when its hash in `efforge.jsonc` shows you have not edited it. If you have, `add` changes nothing, shows the diff, and prints the command with `--overwrite` that replaces it anyway. It also writes nothing if any step fails.

Each add-on's page lists every file it writes and every edit it makes: [the email page](addons/extras-email.md), for example.

## Where to go next

- [Swap a layer to test](testing.md): test layers and the test rules.
- [Capability cards](capability-cards.md): the dashboard's cards, and how an add-on contributes one.
- [Add-ons](addons/README.md): what each add-on adds and edits.
