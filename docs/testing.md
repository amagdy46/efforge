# Swap a layer to test

Code in an efforge project asks for services (`Notes`, `Auth`, `Database`) instead of importing an implementation. A test gives it a different implementation of the same service: a **test layer**. This page walks through one generated test, then the rules the project enforces, how to test a server function, and what not to test this way.

If the words service, layer and tagged error are new, read [Why your app is shaped like this](architecture.md) first.

## A worked example

Every project with a database has this test, `packages/core/test/notes.test.ts`. It tests `createNote`, from `packages/core/src/notes.ts`, without a database. Run it with `pnpm test`.

<!-- sample: packages/core/test/notes.test.ts -->
```ts
import { expect, layer } from "@effect/vitest"
import { Clock, Effect, Layer, Ref } from "effect"
import { createNote, InvalidNote, type Note, Notes } from "../src/notes"

/** `Notes` kept in memory: the test layer that stands in for the database. */
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

layer(NotesInMemory)("createNote", (it) => {
  it.effect("stores the trimmed title", () =>
    Effect.gen(function* () {
      const note = yield* createNote("  Buy milk ")
      expect(note.title).toBe("Buy milk")
      const notes = yield* Notes
      expect(yield* notes.list).toContainEqual(note)
    }),
  )

  it.effect("refuses a blank title with InvalidNote and stores nothing", () =>
    Effect.gen(function* () {
      const notes = yield* Notes
      const before = yield* notes.list
      const error = yield* Effect.flip(createNote("   "))
      expect(error).toBeInstanceOf(InvalidNote)
      expect(yield* notes.list).toEqual(before)
    }),
  )
})
```

What each part does:

- **`createNote`** is the code under test. It checks the title, then stores the note through `Notes` ([the code](architecture.md#1-a-capability-is-an-interface)). It asks for `Notes` and never sees a layer.
- **`NotesInMemory`** is a test layer. `Layer.effect(Notes, ...)` builds it by running an Effect: `Ref.make` creates the list the notes go in (a `Ref` is a value Effects can read and replace), and `Notes.of({ ... })` returns the interface's two members, `list` and `insert`.
- **`layer(NotesInMemory)(name, (it) => { ... })`**, from `@effect/vitest`, builds the layer once and provides it to each `it.effect` inside. The two tests share one list, so the second compares the list before and after instead of expecting it to be empty.
- **`it.effect`** runs a test written as an Effect: `yield*` the code under test, then assert with `expect`.
- **`yield* Notes`** inside a test gets the test layer, to check what was stored.
- **`Effect.flip`** swaps success and failure, so `yield* Effect.flip(createNote("   "))` gives the error to assert on: an `InvalidNote`, with nothing stored.

The real `NotesLive` is never imported, so the test needs no Postgres, no Cloudflare runtime and no network.

Effect ships test layers too. `packages/core/test/greeting.test.ts`, in every project, uses `TestClock`: the clock `it.effect` gives each test. It starts at 0 and moves only when the test calls `TestClock.adjust`.

## The rules

The generated project enforces these with lint (`pnpm check` and `pnpm lint`):

- **Run Effects in tests with `it.effect` or `layer(...)` from `@effect/vitest`.** (`it.layer` is the same as `layer`, for use inside a `describe`.) Calling `Effect.runPromise` (or any `Effect.run*`) or `ManagedRuntime.make` in a `*.test.ts` file is an error from the project's own rule, `lint/effect-tests.js`:

  <!-- quote: lint/effect-tests.js -->
  ```text
  error effect-tests(no-manual-runtime): Effect.runPromise in a test: use it.effect or it.layer from @effect/vitest instead.
  ```

  Why: `it.effect` gives each test a clock that stands still until the test moves it, so code that sleeps or times out finishes at once. When a test fails, it prints the whole failure, including the tagged error inside it. An Effect you run yourself with `Effect.runPromise` gets neither.
- **Provide test layers with `layer(...)`, not `Effect.provide(...)`.** `pnpm check` reports `Effect.provide(someLayer)` inside a test as `effecttsgo(strict-effect-provide)`. Layers are meant to be provided once, where a program starts; in a test, that place is `layer(...)`.
- **Swap services with test layers; do not mock modules.** `vi.mock` replaces an import for the whole file and hides the interface; a test layer implements the interface, so the compiler checks it.

Tests live in `packages/core/test`, and `pnpm test` runs them through Turborepo. `packages/core` has no Cloudflare code, so its tests run in plain Node.

## Test a server function

A server function runs its Effect through `apps/web/src/server/runtime.ts`, with every layer in `AppLayer` and the Worker's bindings. Those bindings come from `cloudflare:workers`, which exists only inside workerd, so a server function cannot be imported into a Vitest test in Node.

Keep server functions thin instead, as the generated ones are:

1. Put the logic in an Effect in `packages/core/src` that asks for the services it needs, like `createNote`.
2. Make the server function only check its input and run that Effect. `addNote` in `apps/web/src/server/notes.ts` does only `runOutcome(createNote(data.title), ...AddNoteErrors)`, the program and the errors it hands the browser as their classes.
3. Test the Effect with test layers, as above.
4. Check the server function itself under `pnpm dev`, which runs the Worker in workerd with local bindings.

## What not to test this way

- **The platform's behaviour.** A test layer is your guess at how Postgres, D1, R2, Durable Objects, Workflows or Email Sending behave. Where the real thing could differ (SQL dialects, consistency, limits), check it under `pnpm dev`.
- **The layers that wrap bindings.** `NotesLive`, `DatabaseLayer` and the other live layers need bindings from `cloudflare.ts`, so they do not load in Node. Keep them small, and exercise them under `pnpm dev`.
- **Pure functions.** Code that needs no service, such as `realtime-limits.ts` from the realtime add-on, can use plain Vitest `it` and `expect`; there is nothing to swap.

## Every card comes with a test like this

Each capability on the dashboard ships its own test layer and a test of one tagged error, in `packages/core/test`, like `notes.test.ts`. [Capability cards](capability-cards.md) states the rule for add-on authors. To test a service of your own, copy this pattern.
