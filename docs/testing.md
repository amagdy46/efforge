# Swap a layer to test

Code in an efforge project asks for services (`Mailer`, `Database`, `Auth`) instead of importing an implementation. A test gives it a different implementation of the same service: a **test layer**. This page shows one test from start to finish, the rules the generated project enforces, how to test a server function, and what not to test this way.

If the words service, layer and tagged error are new, read [Why your app is shaped like this](architecture.md) first.

## A worked example

This test is for a project with the email add-on (`npm create efforge my-app -- --extras=email`, or `npx create-efforge add extras/email`). Save it as `packages/core/test/mailer.test.ts` and run `pnpm test`. The repo keeps it in [`docs/examples/extras-email/mailer.test.ts`](examples/extras-email/mailer.test.ts), and CI copies it into every generated stack with email and runs it, so it keeps passing.

<!-- sample: repo:docs/examples/extras-email/mailer.test.ts -->
```ts
import { expect, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Mailer, MailerError, type MailMessage } from "../src/mailer"

// The code under test. It asks for Mailer and never sees a layer.
const sendWelcome = (to: string) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer
    yield* mailer.send({ to, subject: "Welcome", text: "Thanks for signing up." })
    return "sent" as const
  }).pipe(Effect.catchTag("MailerError", () => Effect.succeed("not sent" as const)))

// Test layer: keeps each message in an array instead of sending it.
const outbox: Array<MailMessage> = []
const MailerTest = Layer.succeed(
  Mailer,
  Mailer.of({ send: (message) => Effect.sync(() => outbox.push(message)) }),
)

// Test layer: every send fails, the way it would if the provider were down.
const MailerDown = Layer.succeed(
  Mailer,
  Mailer.of({ send: () => Effect.fail(new MailerError({ operation: "send", cause: "down" })) }),
)

layer(MailerTest)("with a working mailer", (it) => {
  it.effect("sends the welcome message", () =>
    Effect.gen(function* () {
      expect(yield* sendWelcome("ada@example.com")).toBe("sent")
      expect(outbox).toEqual([
        { to: "ada@example.com", subject: "Welcome", text: "Thanks for signing up." },
      ])
    }),
  )
})

layer(MailerDown)("with a mailer that is down", (it) => {
  it.effect("reports a failed send instead of failing", () =>
    Effect.gen(function* () {
      expect(yield* sendWelcome("ada@example.com")).toBe("not sent")
    }),
  )
})
```

What each part does:

- **`sendWelcome`** is the code under test. In a real app it would live in `packages/core/src`; it is in the test file here to keep the example in one place. It asks for `Mailer` with `yield* Mailer`, and turns a `MailerError` into the value `"not sent"` with `Effect.catchTag`.
- **`MailerTest`** is a test layer. `Layer.succeed(Mailer, Mailer.of({ ... }))` builds a layer from a plain object that has the service's methods. Its `send` pushes the message into `outbox`.
- **`MailerDown`** is a second test layer, for the failure path. Its `send` fails with the same tagged error the real layer uses, so the test exercises the `catchTag` branch.
- **`layer(MailerTest)(name, (it) => { ... })`** from `@effect/vitest` builds the layer once for the tests inside, and provides it to each `it.effect`.
- **`it.effect`** runs a test written as an Effect: `yield*` the code under test, then assert with `expect`.

The real `MailerLive` is never imported, so the test needs no Cloudflare runtime, no `EMAIL` binding and no network.

## The rules

The generated project enforces these with lint (`pnpm check` and `pnpm lint`):

- **Run Effects in tests with `it.effect`, `it.layer` or `layer` from `@effect/vitest`.** Calling `Effect.runPromise` (or any `Effect.run*`) or `ManagedRuntime.make` in a `*.test.ts` file is an error from the project's own rule, `lint/effect-tests.js`:

  ```text
  error effect-tests(no-manual-runtime): Effect.runPromise in a test: use it.effect or it.layer from @effect/vitest instead.
  ```

  `@effect/vitest` runs each test with Effect's test services (a `TestClock` that only moves when the test moves it) and reports a failure with its full cause, which a hand-run Effect skips.
- **Provide test layers with `layer(...)`, not `Effect.provide(...)` inside a test.** The Effect language service flags `Effect.provide` with a layer outside an entry point (`effecttsgo(strict-effect-provide)`). The example above uses one `layer(...)` block per test layer for this reason.
- **Swap services with test layers; do not mock modules.** `vi.mock` replaces an import for the whole file and hides the interface; a test layer implements the interface, so the compiler checks it.

Tests live in `packages/core/test`, and `pnpm test` runs them through Turborepo. `packages/core` has no Cloudflare code, so its tests run in plain Node.

## Test a server function

A server function runs its Effect through `apps/web/src/server/runtime.ts`, with every layer in `AppLayer` and the Worker's bindings. Those bindings come from `cloudflare:workers`, which exists only inside workerd, so a server function cannot be imported into a Vitest test in Node.

Keep server functions thin instead:

1. Put the logic in an Effect program in `packages/core/src` that asks for the services it needs, like `sendWelcome` above.
2. Make the server function only validate its input and call `runtime.runPromise(program)`.
3. Test the program with test layers, as above.
4. Check the server function itself under `pnpm dev`, which runs the Worker in workerd with local bindings.

## What not to test this way

- **The platform's behaviour.** A test layer is your guess at how D1, R2, Durable Objects, Workflows or Email Sending behave. Where the real thing could differ (SQL dialects, consistency, limits), check it under `pnpm dev`.
- **The layers that wrap bindings.** `MailerLive`, `DatabaseLayer` and the other live layers read bindings through `cloudflare.ts`, so they do not load in Node. Keep them small, and exercise them under `pnpm dev`.
- **Pure functions.** Code that needs no service, such as `realtime-limits.ts` or `storage-security.ts`, can use plain Vitest `it` and `expect`; there is nothing to swap.

## More test layers are coming

Today the generated tests cover pure functions (`llm-crypto`, `realtime-limits`, `storage-security`). The capability cards, described in `docs/capability-cards.md` once they land, give each add-on a test layer and a test that covers a tagged-error path, in this shape. Until then, the example above is the pattern to copy for any service.
