# Three ways to call Effect from TanStack Start

An efforge app keeps its server code in Effect: programs in `packages/core`, layers composed into `AppLayer` in `apps/web/src/server/layers.ts`. The browser reaches that code in one of three ways. This page says what each one is, what it costs, and when to use it.

| | Server function | Effect RPC (`efforge add rpc`) | `HttpApi` |
| --- | --- | --- | --- |
| What the browser calls | a function, `greet({ data })` | a typed client, `greet({ payload })` | a typed client or any HTTP client |
| Typed errors in the browser | yes, as their classes | yes, as their classes | yes, with an HTTP status each |
| Streams | a `ReadableStream` inside the value | yes, a call can be a stream | needs its own endpoint |
| Loads data for the first render | yes, from a route loader | no: calls start in the browser | yes, from a loader with an absolute URL |
| Other clients (a phone app, a partner) | no | possible, with the same group | yes, and it can publish OpenAPI |
| Client JavaScript it adds | none beyond the dashboard's | about 40 KiB gzip, on pages that use it | not measured |
| In efforge | every project | an add-on | not yet |

## 1. A server function

Every efforge project has these. A server function is TanStack Start's own RPC: a function the browser calls as if it were local, which runs on the Worker. efforge runs the Effect with `runOutcome`, which returns the Effect's `Exit` encoded, so a failure reaches the browser as its class with its fields. The runtime card's function, as the template writes it (on a stack with auth, efforge adds `.middleware([requireSession])`):

<!-- sample: repo:templates/base/files/web/src/server/greeting.ts -->
```ts
export const greet = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(GreetInput))
  .handler(({ data }) => runOutcome(greetProgram(data.name), InvalidName))
```

In a component, `useServerCall(greet, InvalidName)` calls it, and `state.error instanceof InvalidName` holds when it fails. A route loader can call it during server rendering, so its data is in the first HTML.

Use a server function for a form post, for data a page needs when it first renders, and for anything one page calls. It is the default for a reason: it needs nothing, and it already carries typed errors.

## 2. Effect RPC

`npx -y create-efforge add rpc` adds an Effect RPC group and a typed client for it. The group is a contract in `packages/core`: each call's payload, success and tagged error, as `Schema`. The server serves the whole group at `POST /api/rpc`, and the client is built from the same group, so the two cannot drift apart.

Here is the whole idea in about 35 lines (imports left out). The add-on writes these parts in their own files, with tests, and with a session rule on stacks with auth:

```ts
// packages/core/src/rpc.ts: the contract, shared by the server and the browser
export class AppRpcs extends RpcGroup.make(
  Rpc.make("Greet", { payload: { name: Schema.String }, success: Greeting, error: InvalidName }),
  Rpc.make("Countdown", { payload: { from: Schema.Int }, success: Schema.Int, stream: true }),
) {}

// packages/core/src/rpc-handlers.ts: ordinary Effect code, on the app's services
export const AppRpcsHandlers = AppRpcs.toLayer({
  Greet: ({ name }) => greet(name),
  Countdown: ({ from }) => Stream.iterate(from, (n) => n - 1).pipe(Stream.take(from + 1)),
})

// apps/web/src/server/rpc.ts: a layer in AppLayer; a fresh RPC server per request
const RpcServices = Layer.mergeAll(AppRpcsHandlers, RpcSerialization.layerNdjson)
export const RpcLive = Layer.effect(
  RpcHandler,
  Effect.map(Effect.context<Layer.Success<typeof RpcServices>>(), (services) =>
    HttpEffect.toWebHandler(
      // without the layer's Scope: each request's server lives in its own
      Effect.provide(Effect.flatten(RpcServer.toHttpEffect(AppRpcs)), Context.omit(Scope.Scope)(services)),
    ),
  ),
).pipe(Layer.provide(RpcServices))

// apps/web/src/routes/api/rpc.ts: a TanStack Start server route serves it
export const Route = createFileRoute("/api/rpc")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runtime.runPromise(RpcHandler.use((handle) => Effect.promise(() => handle(request)))),
    },
  },
})

// apps/web/src/lib/rpc-client.ts: the client, one atom per call
export class AppClient extends AtomRpc.Service<AppClient>()("AppClient", {
  group: AppRpcs,
  protocol: rpcOverHttp("/api/rpc"),
}) {}
export const greetAtom = AppClient.mutation("Greet")

// in a component: greet({ payload: { name } }) calls it; result is an AsyncResult
const result = useAtomValue(greetAtom)
const greet = useAtomSet(greetAtom)
```

What the add-on decides for you:

- **The server is a layer; each request gets its own RPC server.** `RpcLive` is in `AppLayer`, and builds a fresh RPC server inside each request on `AppLayer`'s services: on Workers, I/O such as a Postgres socket belongs to the request that started it. The handlers run on the same layers as the server functions (the database card's `Notes`, Better Auth), not on copies, and the telemetry slot under `AppLayer` reaches the RPC server, so each call is a span named `rpc.Greet`, as a server function's is `serverFn.greet`.
- **Errors are the same idea as a server function's.** Declare them with `Schema.TaggedError` and a brand, and set them as a call's `error`. In the browser, the failure is the class with its fields (`instanceof InvalidName`, `length`); the dashboard shows it with the same `FailureNote`. A field holding a driver's error is `cause: ServerOnly` and stays on the server. A call that got no RPC answer at all fails with `RpcClientError`.
- **The session rule is the same.** On a stack with auth, `/api/rpc` is under `/api/`, so `requireApiSession` refuses a call without a session with 401 `Unauthorized` before RPC runs. The client reads that answer back as `Unauthorized`, the class a server function's session gate gives, so the browser matches it the same way. Behind the gate, the group's `RpcSession` middleware checks the session again from the RPC request's cookies and gives each handler `Auth` for the caller.
- **Streams stream.** A call with `stream: true` is sent as newline-delimited JSON over one HTTP response; the countdown on the dashboard shows each number as it arrives.
- **Nothing calls the server while a page renders on the server.** A query atom read during server rendering runs there, where `/api/rpc` has no origin; it fails at once, the server's HTML shows that failure while the browser starts from nothing, and React reports a hydration mismatch. That was the warning the first spike saw. The card starts every call from a click and gives its atoms their own `RegistryProvider`, so no atom state is shared between server renders. For data in the first render, use a route loader with a server function.

What it costs: `@effect/atom-react` and Effect's RPC client, about 40 KiB of gzipped JavaScript. Measured on a D1 + Better Auth project, built and served with `vite preview`, counting every script a first visit fetches:

| Page | Without `rpc` | With `rpc` |
| --- | --- | --- |
| `/`, the landing page | 164.4 KiB gzip (505.9 raw, 7 files) | 164.4 KiB gzip (505.9 raw, 7 files) |
| `/app`, the dashboard | 212.9 KiB gzip (649.7 raw, 10 files) | 252.5 KiB gzip (771.5 raw, 10 files) |

A page that does not import the client gets none of it.

Use RPC for calls your own UI makes many of, for streams, and when you want one contract for every call instead of one function each. Effect's RPC modules are marked unstable upstream; efforge pins Effect exactly, so an upgrade is a step you take, not one that happens to you.

## 3. `HttpApi`

`HttpApi` (`effect/http-api`) describes a REST API: endpoints with paths, methods, HTTP status codes per error, and OpenAPI generated from the same description. Its client is typed too, and any HTTP client can call it.

Use it when the callers are not your own UI: a mobile app, a partner, a public API with documentation. It is the wrong tool for "call my server from this component": you would design paths and status codes for calls nobody outside the app makes. efforge has no add-on for it yet; served from a splat route such as `apps/web/src/routes/api/v1/$.ts`, it sits behind the same `/api/` session gate.

## See also

- [The rpc add-on's page](addons/extras-rpc.md): every file it writes and edit it makes.
- [Why your app is shaped like this](architecture.md): interfaces, layers and `AppLayer`.
- [ADR 0014](decisions/0014-effect-rpc-add-on.md): why the add-on is shaped this way.
