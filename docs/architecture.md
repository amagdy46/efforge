# Why your app is shaped like this

In an efforge project, every server capability (the database, auth, email, storage, AI) is built the same way, from three pieces: an interface, a layer that implements it, and one line in one file that puts the layer in the app. A test swaps that layer for another. This page walks through the pieces with email as the example, then the two places where Cloudflare and Effect meet, then the path of one request.

It assumes you know TypeScript and have heard of Effect. Every Effect term is defined where it first appears. The code is from a project made with `npm create efforge my-app -- --yes --extras=email` (the default stack plus email); `test/docs.test.ts` checks every sample against the files efforge generates.

## The idea in one picture

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/amagdy46/efforge/main/docs/assets/layers-narrow-dark.svg">
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/amagdy46/efforge/main/docs/assets/layers-narrow-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/amagdy46/efforge/main/docs/assets/layers-dark.svg">
  <img src="https://raw.githubusercontent.com/amagdy46/efforge/main/docs/assets/layers-light.svg" width="840" alt="Diagram: the Mailer interface; MailerLive implements it and is listed in AppLayer; in a test, MailerTest implements it instead and layer(MailerTest) provides it. The list below gives the same facts.">
</picture>

The same facts as text:

1. **The interface.** `Mailer`, in `packages/core/src/mailer.ts`, has one method, `send(message)`, which can fail with `MailerError`. Your code asks for `Mailer` and never sees a layer.
2. **A layer.** `MailerLive`, in `apps/web/src/server/mailer.ts`, implements `Mailer` by sending through the `EMAIL` binding.
3. **One file composes.** `apps/web/src/server/layers.ts` lists `MailerLive` in `AppLayer`, next to `DatabaseLayer` and `AuthLive`.
4. **A test swaps the layer.** In `packages/core/test/mailer.test.ts`, `MailerTest` also implements `Mailer` and keeps messages in an array. `layer(MailerTest)` gives it to the test in place of `MailerLive`.

## 1. A capability is an interface

Here is the email capability's interface, from `packages/core/src/mailer.ts`:

<!-- sample: packages/core/src/mailer.ts -->
```ts
export class Mailer extends Context.Service<
  Mailer,
  { readonly send: (message: MailMessage) => Effect.Effect<void, MailerError> }
>()("@repo/core/Mailer") {}
```

`send` returns an `Effect.Effect<void, MailerError>`. An **Effect** is a description of work that has not run yet. When something runs it, it either succeeds with a value (here `void`) or fails with an error of the type in the second slot (here `MailerError`). Failures are part of the type, so the compiler knows how `send` can fail.

`Mailer` is a **service**: a named interface that code asks for, instead of importing an implementation. Code that sends mail looks like this (from the [testing guide's example](examples/extras-email/mailer.test.ts)):

<!-- sample: repo:docs/examples/extras-email/mailer.test.ts -->
```ts
const sendWelcome = (to: string) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer
    yield* mailer.send({ to, subject: "Welcome", text: "Thanks for signing up." })
    return "sent" as const
  }).pipe(Effect.catchTag("MailerError", () => Effect.succeed("not sent" as const)))
```

`Effect.gen` lets you write Effect code like `async` code, with `yield*` where you would write `await`. `yield* Mailer` asks for the service. The type of `sendWelcome` records that it needs a `Mailer`; it does not run until one is provided.

`MailerError` is a **tagged error**: a class with a `_tag` field, so code can handle each kind of failure by name, as `Effect.catchTag("MailerError", ...)` does above.

<!-- sample: packages/core/src/mailer.ts -->
```ts
export class MailerError extends Data.TaggedError("MailerError")<{
  readonly operation: string
  readonly cause: unknown
}> {}
```

Interfaces and their errors live in `packages/core`. That package has no Cloudflare code, so it type-checks and tests anywhere.

## 2. A layer implements it

A **layer** builds a service. It may need other services, and it can fail while it builds. Here is the smallest one in the email add-on, from `apps/web/src/server/mailer.ts`. It prints each message instead of sending it:

<!-- sample: apps/web/src/server/mailer.ts -->
```ts
const ConsoleMailer = (from: string) =>
  Layer.succeed(
    Mailer,
    Mailer.of({
      send: (message) =>
        Effect.log(
          `[mail] from ${from} to ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
        ),
    }),
  )
```

`MailerLive`, in the same file, is the layer the app uses. It reads `MAIL_TRANSPORT`: `console` picks the layer above (`.dev.vars` sets it for `pnpm dev`), anything else picks one that sends through Cloudflare Email Service. If `MAIL_FROM` is missing in production, `MailerLive` fails with `MailerConfigError` when it is built, before any mail is sent.

Layers live in `apps/web/src/server`, next to the Cloudflare code they use.

## 3. One file composes the layers

`apps/web/src/server/layers.ts` is the only place layers are put together:

<!-- sample: apps/web/src/server/layers.ts -->
```ts
export const AppLayer = Layer.mergeAll(
  Logger.layer([Logger.consolePretty()]),
  DatabaseLayer.pipe(Layer.provide(WorkerEnvLive)),
  AuthLive,
  MailerLive,
  /* efforge:layers */
)
```

`AppLayer` provides every service the app has. `efforge add` adds a layer here, before the `/* efforge:layers */` marker, so keep the `Layer.mergeAll(...)` shape. To change how a service works, change which layer is listed; the code that asks for `Mailer` stays the same.

## 4. A test swaps one out

A **test layer** is a second implementation of the same interface, made for tests. This one keeps messages in an array:

<!-- sample: repo:docs/examples/extras-email/mailer.test.ts -->
```ts
const outbox: Array<MailMessage> = []
const MailerInMemory = Layer.succeed(
  Mailer,
  Mailer.of({ send: (message) => Effect.sync(() => outbox.push(message)) }),
)
```

The test runs `sendWelcome` with this layer instead of `MailerLive`, so it needs no Cloudflare and sends no mail. [Swap a layer to test](testing.md) has the full test and the rules for tests.

## Two seams that keep this working on Workers

### Only `cloudflare.ts` reads the Worker environment

A **binding** is how a Worker reaches a Cloudflare resource: the `HYPERDRIVE` database connection, an R2 bucket, the `EMAIL` sender. Cloudflare passes bindings in an object called `env`. One file reads it:

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

Bindings arrive with each request, but layers are built once and reused. Importing `env` from `cloudflare:workers` gives the bindings outside any request, so `WorkerEnvLive` is a plain layer, and every other layer gets its binding from it through [effect-cf](https://github.com/danieljvdm/effect-cf) (`DatabaseLayer`, for example, takes `HYPERDRIVE`).

What this prevents: `cloudflare:workers` exists only inside workerd, Cloudflare's runtime. A file that imports it cannot load under Vitest in Node. With one file reading `env`, the rest of the code never imports it, and a test replaces the layers above it instead. Lint enforces the rule: importing `env` anywhere else fails `pnpm check` with "Read bindings through effect-cf layers; only server/cloudflare.ts reads env."

### One file runs your Effects: `runtime.ts`

A **runtime** runs Effects. It builds the layers an Effect needs, runs the Effect, and closes what the layers opened. Server functions never run Effects themselves; they hand them to `runtime.runPromise`, which returns a Promise that settles when the Effect succeeds or fails.

Which `runtime.ts` you get depends on the database. Without Postgres (D1, or no database), it is one `ManagedRuntime` per isolate (an **isolate** is one running copy of your Worker; it serves many requests):

<!-- sample: repo:templates/base/files/web/src/server/runtime.ts -->
```ts
/** One runtime per Worker isolate; server functions run their Effects on it. */
export const runtime = ManagedRuntime.make(AppLayer)
```

It builds `AppLayer` on the first request and reuses it for the rest.

With Postgres, it builds `AppLayer` for each call and closes it afterwards:

<!-- sample: apps/web/src/server/runtime.ts -->
```ts
/**
 * Server functions run their Effects through here. Workers must not reuse I/O (such as a
 * Postgres socket) across requests, so unlike a `ManagedRuntime` this builds `AppLayer` for each
 * call and closes it afterwards; Hyperdrive pools the connections behind it.
 */
export const runtime = {
  runPromise: <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof AppLayer>>): Promise<A> =>
    Effect.runPromise(Effect.provide(effect, AppLayer)),
}
```

What this prevents: Workers do not let one request use an I/O object, such as a socket, that another request opened. Cloudflare fails it with "Cannot perform I/O on behalf of a different request". And a handler whose Promise never settles fails with "The script will never generate a response". Keeping the runtime in one file decides once, for every handler, when layers are built and closed, and every handler gets a Promise that settles.

One exception: `apps/web/src/server/invitation-email.ts` makes its own runtime for `MailerLive`, because Better Auth calls it from inside the auth layer, and importing `runtime.ts` there would be an import cycle.

## How a request flows

The dashboard at `/app` lists notes. Here is that request, from the browser to Postgres:

```text
GET /app
  route          apps/web/src/routes/app/index.tsx   loader calls listNotes()
  server fn      apps/web/src/server/notes.ts        runtime.runPromise(program)
  runtime        apps/web/src/server/runtime.ts      builds AppLayer for this call
  program        Effect.gen in notes.ts              yield* Database, then a query
  service        packages/core/src/Database.ts       the Database interface
  layer          packages/db/src/layer.ts            DatabaseLayer, a Drizzle client
  binding        apps/web/src/server/cloudflare.ts   WorkerEnvLive supplies HYPERDRIVE
  Postgres       through Hyperdrive
```

The server function is the whole middle of that list:

<!-- sample: apps/web/src/server/notes.ts -->
```ts
export const listNotes = createServerFn({ method: "GET" }).handler(() =>
  runtime.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database
      return yield* db.select().from(note).orderBy(desc(note.createdAt))
    }),
  ),
)
```

A **server function** is a TanStack Start function that runs on the server and can be called from a route or a component. Each one is a thin shell: it hands an Effect program to the runtime. The program asks for services, the runtime provides them from `AppLayer`, and each layer reaches its binding through `WorkerEnvLive`.

## What `efforge add` changes, and what it leaves alone

`efforge add extras/email` writes the add-on's own files and makes small, listed edits to the files that compose the app. For email:

- **New files:** `packages/core/src/mailer.ts` (the interface), `apps/web/src/server/mailer.ts` (the layers), and with organizations `apps/web/src/server/invitation-email.ts`.
- **Edits:** a re-export in `packages/core/src/index.ts`, `MailerLive` in `layers.ts`, the `EMAIL` binding in `wrangler.jsonc` (or `infra/alchemy.run.ts`), two lines in `.dev.vars`, the variables in `.env.example`, a section in `AGENTS.md`, and the stack in `efforge.jsonc`.

It edits code with AST transforms (edits to the parsed code, not text search and replace), so each edit touches only what it adds, and running it twice changes nothing. It never touches your routes, components, schema or the code that uses services. It records a hash of each file it generates in `efforge.jsonc` and refuses to replace one you have edited unless you pass `--overwrite`. It works out every change first and writes nothing if any step fails. [The email page](addons/extras-email.md) lists every edit; each add-on has a page under [docs/addons](addons/README.md).

## Where to go next

- [Swap a layer to test](testing.md): test layers and the test rules.
- [Add-ons](addons/README.md): what each add-on adds and edits.
- [CLI reference](cli.md): every flag.
- The generated `AGENTS.md`: the same rules, written for coding agents.
