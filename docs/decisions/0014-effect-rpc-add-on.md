# 0014 — Effect RPC is an extra, served from a Start route by a layer in `AppLayer`

Date: 2026-11-20. Status: accepted. Builds on [0013](0013-errors-cross-the-wire-and-spans-by-name.md).

## Context

"How do I call Effect from TanStack Start" is the integration question Effect users ask most. An
efforge app answers it with a server function and `runOutcome`, which since 0013 carries typed
errors. People also want a typed client for many calls, streams, and one contract for the server
and the browser. A spike (W5-R) ran three options on Workers with the current pins: Effect RPC
with an `AtomRpc` client, `HttpApi`, and a server function returning an `Exit`. RPC carried
classes, streams and auth with the least code, for about 64 KiB of gzipped client JavaScript
(about 40 once 0013 put `Schema` on the dashboard).

## Decision

- **An extra, not a new slot.** `rpc` is an option of `extras`. A slot holds one option and
  `add` only moves a slot away from `none`; `HttpApi`, if it becomes an add-on, answers a
  different caller (other clients, OpenAPI), and a project can want both. Extras are the place
  for capabilities that combine. No preset includes it: it adds client weight to the dashboard
  and its upstream modules are marked unstable, so it stays a choice.
- **The group and its handlers live in `packages/core`.** `AppRpcs` (`rpc.ts`) is the contract;
  `AppRpcsHandlers` (`rpc-handlers.ts`) runs the programs and services a server function uses
  (`greet` on every stack, `Notes` with a database). Core's tests reach both without the web
  app. `rpcOverHttp` there is the one protocol the browser and the tests use: ndjson over HTTP,
  where an answer other than 2xx is an error.
- **The server is a layer in `AppLayer`, the RPC server is per request.** `RpcLive`
  (`apps/web/src/server/rpc.ts`) provides the exported layers its handlers need (`AuthLive`,
  `DatabaseLayer`), which Effect shares with `AppLayer` by reference, captures those services,
  and builds `RpcServer.toHttpEffect` inside each request (`HttpEffect.toWebHandler` on the captured services). The
  research's shape, one server forked when the layer builds, broke on Postgres in the browser
  flow: workerd cancelled calls as hung, because the server fiber belonged to the request that
  built the runtime, and on Postgres the runtime closes `AppLayer` (and Better Auth's pool) when
  that call returns. Being in `AppLayer` keeps it above the telemetry slot. Calls are spans named
  `rpc.<Call>`, beside `serverFn.<name>`. The graph shows it as one layer that provides
  `RpcHandler`; it reads no binding or setting of its own.
- **A TanStack Start server route serves it** (`routes/api/rpc.ts`), not a Worker route: it is
  the Start answer to a Start question, and it runs inside Start's request context. It answers
  inside the runtime call, and the call lasts until the answer's body has been read or the
  browser has gone. A stream's later parts are written after the route has answered; on
  Postgres the runtime closes `AppLayer` (and its connection) when the call returns, so a
  shorter call left a stream's handler without its database. Holding the call keeps the
  services a stream uses alive as long as the stream, on every runtime, and costs nothing on D1,
  where the runtime outlives the call anyway. Documenting "a stream must not use the database"
  was the first answer; it was easy to miss and failed only at runtime, on one database.
- **A missing setting is `NotConfigured`, as on every card.** When `AppLayer` cannot start for a
  setting, the route (and on auth stacks the route gate, which needs the runtime for the
  session) answers 503 with a `NotConfigured` body before RPC runs. That is no RPC answer, so
  the client reads it back the way it reads the gate's 401: `RpcSettings` is a middleware with a
  client half only (`clientError: NotConfigured`), which the browser's group adds; the server
  never sees it. Its `NotConfigured` (core) has the web app's tag and fields, so `FailureNote`
  shows it as the "not configured" state, naming the setting.
- **The session rule is the route gate, then a middleware.** `/api/rpc` stays behind
  `requireApiSession` and off `public-api-paths.json`. The gate answers 401 before RPC runs,
  which is no RPC answer, so `RpcSessionClient`, the client half of the group's `RpcSession`
  middleware, reads that 401 back as `Unauthorized`, the class a server function's gate gives.
  `RpcSession` on the server checks the session again from the RPC request's own cookies
  (defence in depth, and the check that still holds where the gate is missing, such as a project
  made before the gate) and provides `Auth` for the caller to each handler, so programs that ask
  for `Auth` work without relying on request context reaching a forked fiber. The middleware's
  logic (`makeRpcSession`) is in core, so it is tested there; the server passes it Better Auth's
  lookup.
- **Variants by stack.** With a database the group has `ListNotes`; with auth it is wrapped as
  `SessionRpcs`. The add-on ships each file in variants with `when`, so `add database` or
  `add auth` later replaces an unedited file with the stack's own, as for other add-ons. Card
  modules could not have variants before: a later card file with the module's target is now a
  variant, registered on its own stacks.
- **No call runs during server rendering.** A query atom read while the server renders runs on
  the server, where the relative `/api/rpc` URL fails at once; the server's HTML then shows a
  failure while the browser starts from nothing, a hydration mismatch (the warning the spike saw;
  reproduced and confirmed). The card starts every call from an event and gives its atoms their
  own `RegistryProvider` (`@effect/atom-react`'s default registry is module-global, shared by
  every server render). `AGENTS.md` says to load first-render data with a route loader.

## Consequences

- A project with `rpc` has two ways in to the same layers. `docs/rpc.md` says when to use each,
  and when `HttpApi` would be the right third.
- About 40 KiB of gzipped JavaScript on the dashboard; none on the landing page (measured).
- On Postgres, a stream holds its `AppLayer` (a database connection) open for as long as the
  browser reads it. A long stream is a long-held connection, which Hyperdrive pools.
- `NotConfigured` is declared twice, in the web app and in core, with the same tag and fields;
  core cannot import the web app's.
- The add-on has four variants of the server file (no database, a database, auth, organizations) and two of most others. A change to one is a
  change to all; `test/rpc-addon.test.ts` and the e2e rows cover the stacks.
- `@effect/atom-react` is a new pin, held with `effect` by the `@effect/atom-*` override. The
  release history records it at the next release (until then the history test lists it as
  unreleased).
