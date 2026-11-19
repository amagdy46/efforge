# 0013 — Server functions return the encoded `Exit`; layers are named spans over a telemetry slot

Date: 2026-11-19. Status: accepted. Changes the `runOutcome` part of
[0008](0008-capability-cards.md).

## Context

Three add-ons are planned on top of the base (`rpc`, `observability`, `cluster`). A spike of
each in a generated project found they stay small only if the base changes first, and found
one problem every efforge app has today: a server function hands the browser a tagged error as
`{ _tag, message }`, so the client loses the class and its fields, the main thing Effect's typed
errors give it. The spike also found that a tracer merged into `AppLayer` misses the fibers a
layer forks while it builds (an RPC server, a cluster runner), and that efforge's own services
emit no spans, so a trace would show nothing by name.

## Decision

- `runOutcome(program, ...errors)` runs the Effect and returns its `Exit`, encoded with
  `Schema.toCodecJson(Schema.Cause(Schema.Union([...errors, NotConfigured, AnyTagged]),
  Schema.Defect()))` (`Schema.Exit`'s encoding: `{ _tag: "Success", value }` or
  `{ _tag: "Failure", cause }`). The value is not encoded: TanStack Start serializes it as before,
  so a `ReadableStream` still streams. `Schema.Exit` itself is not serializable by Start; its JSON
  codec is.
- The client decodes with the same classes: `useServerCall(fn, ...errors)` and `settleCall`
  (`lib/use-server-call.ts`), through `decodeOutcome` (`lib/outcome.ts`, shared by both sides).
  The list is declared once, exported beside the server function (`AnnounceErrors`), and both
  sides spread it. The types hold them to it: `Outcome` carries the tags of the listed errors as
  a type-only field (tags, because TanStack Start's serializer types drop a field holding
  classes), and the client accepts only error classes with those tags, in that order. Before,
  the two lists were written twice with nothing linking them.
  A failure is an instance of its class again, fields included. `run` still resolves to
  `{ ok, value }` or `{ ok: false, error, rejected }`, so code written against the old shape keeps
  working.
- Only typed failures cross. A defect or an interruption rejects the call, a 500, as before. A
  runtime that cannot start rejects too, unless the reason is a missing setting, which is
  `NotConfigured`, always listed.
- An error the server function does not list (an owner's `Data.TaggedError`) arrives as its
  `_tag` and `message` (`AnyTagged`), which is what every error got before. Listing is how a
  class comes back; nothing breaks for not listing.
- A call refused before its Effect answered (the session gate's `Unauthorized`, the validator,
  no answer, a defect) is `rejected: true`, so the client tells it apart from the function's own
  failure. The session gate and `requireApiSession` are unchanged; they run before the boundary.
- Core service errors are `Schema.TaggedError` with a brand (efforge's lint asks for it). A field
  holding a driver's error is `cause: ServerOnly` (`packages/core/src/server-only.ts`): the error
  keeps it for the server log and encoding drops it, so no raw driver text reaches the browser
  now that fields do.
- `layers.ts` has `TelemetryLive = Layer.mergeAll(Layer.empty /* efforge:telemetry */)` and
  `AppLayer = Layer.mergeAll(...).pipe(Layer.provideMerge(TelemetryLive))`: telemetry sits
  underneath every layer, so forked fibers inherit it, and stays in the runtime's context, so each
  request's Effect does too. `addTelemetry` fills the slot; `addLayer`, `graph`, `doctor` and the
  dashboard read `AppLayer` through the `.pipe`.
- Every member of a live layer ends in `Effect.withSpan("<Service>.<member>")`, and `runOutcome`
  runs each call as `serverFn.<name>`, named by `nameCall`, a global function middleware that puts
  the name in an `AsyncLocalStorage`. A repo test fails on a live layer member without its span.
- Every layer `AppLayer` composes stays an exported constant. An add-on provides those
  (`Layer.provide(AuthLive)`); Effect builds a layer value once per runtime, so it shares
  `AppLayer`'s instance. The database entry keeps its inline shape: renaming it would make
  `upgrade` add the new name beside the old one in every owner-edited `layers.ts` (it re-applies
  `addLayer` to files the owner changed), and sharing already works by reference.

## Consequences

- The dashboard's JavaScript grows by Effect's `Schema` decode, about 29 KiB gzip on a stack with
  every add-on; the landing page does not change.
- A card lists its errors twice, in the server function and in the demo. A mismatch is not a
  type error: an unlisted class arrives as its tag and message.
- `upgrade` keeps a server function file it cannot prove is its own (an owner's, or a card's in a
  project made between releases, which no release record covers) and then holds the new
  `outcome.ts` back, since that file imports `runOutcome`. Such a function still returns the
  earlier `{ ok, value }` / `{ ok: false, error: { _tag, message } }`, so the client reads both
  shapes (`EarlierOutcome` in `lib/outcome.ts`), and the refreshed cards work on it, with tags
  and messages. The upgrade e2e cases cover a project made by `next` before this change, with and
  without an owner's own `Data.TaggedError` service on `runOutcome` and `useServerCall`.
- Code that reads a server function's result directly, not through `useServerCall` or
  `settleCall`, reads whichever shape its server function returns; `decodeOutcome` takes both.
