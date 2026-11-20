# 0015 — Effect Cluster on Durable Objects ships as an experimental add-on

Date: 2026-11-20. Status: accepted.

## Context

Effect released `@effect/platform-cloudflare` (4.1.3, 2026-11-10; 4.1.4 the next day), which runs
Effect Cluster entities, Effect Workflow and durable queues on Durable Objects. The package calls
itself experimental: "Its APIs may change in patch releases." A spike in a generated project
(efforge-work `w5-research.md`) ran all three locally and found three limits, measured again for
this add-on:

1. A `DurableClock.sleep` that is the first thing a run awaits wakes when the workflow's 60 second
   guard alarm fires: a 3 second sleep finished at 60.1 seconds, every time. Starting a run arms
   the timer's alarm and the guard alarm together, each with a read of the current alarm and then
   a write, so the guard can overwrite the earlier timer. With 50 ms of asynchronous work before
   the sleep it woke at 3.2 seconds.
2. Nothing runs a queue worker in the background: a Worker runs only while it answers a request,
   a Cron Trigger or an alarm.
3. Alchemy's own cluster path (`AlchemyCloudflareCluster.make`) runs inside an Effect-native
   `Cloudflare.Worker`; efforge deploys a TanStack Start `Cloudflare.Website.Vite`.

Building it found a fourth: `setInitializer` may run once per isolate, and `vite dev` evaluates the
Worker entry again after every edit, so the package's README pattern makes every page fail
("the Durable Object initializer is already set") after the first edit under `pnpm dev`.

## Decision

- `extras/cluster`, titled "Cluster (experimental)", pinned exactly: `@effect/platform-cloudflare`
  and (tests) `@effect/sql-sqlite-node` at `effectVersion`, held by the lockstep overrides
  ([0005](0005-effect-lockstep-overrides.md)). Every limit is said where a user meets it: the card,
  the `AGENTS.md` section, the add-on page's limits, `docs/cluster.md` and `docs/limits.md`.
- The smallest set that shows the three primitives: a `Counter` entity (state in its own SQLite),
  a `Review` workflow (activity, durable wait, activity) and a `GreetingQueue` used by a `Greet`
  workflow. Definitions and programs in `packages/core/src/cluster.ts`, handlers in
  `cluster-handlers.ts` (both import `@effect/platform-cloudflare/CloudflareCluster`, never the
  root, so the tests run in Node), errors and the card's types in `cluster-errors.ts` (the browser
  bundle gets those, not Effect Cluster).
- The demo workflow waits on an approval (`DurableDeferred`), not on a durable sleep. Its resume is
  prompt (about 0.1 s locally), and a demo that sits a minute on a 3 second timer would look hung.
  The late sleep is documented with its cause; the in-memory threshold is named as the workaround
  for short waits.
- The queue is drained by the request that offers: `greet` offers, then runs
  `DurableQueue.makeWorker` in the same request until its item is written, 10 seconds at most. No
  Cron Trigger: the generated Worker entry has no `scheduled` handler, and `wrangler dev` fires no
  cron by itself, so it could not be tried locally. The worker takes items oldest first, so an item
  left by a request that ended early goes with the next offer. How to add a cron is documented.
- Ownership: counter ids and run ids are keyed by a hash of `currentOwner`, so with auth each
  user's are their own and someone else's run answers `UnknownExecution`. The queue is one Durable
  Object for the app; the card says it is shared.
- On Alchemy, the wrangler-style path: four `Cloudflare.DurableObject` resources bound as
  `CLUSTER_*` (as realtime does for `Room`), the same class re-exports and initializer. Alchemy
  defaults a Durable Object to SQLite and writes its migrations. Not refused: the gate passes and
  every demo ran under `alchemy dev`. The deploy is not tested, on either infra.
- `apps/web/src/cluster/objects.ts` keeps the first `setInitializer` per isolate (a flag on
  `globalThis`) and reads the newest runtime, so `pnpm dev` survives an edit. The initializer is
  the app's `ManagedRuntime`: a cold Durable Object builds `AppLayer` once, inside Cloudflare's
  15 second limit.
- It sits beside `extras/workflows` (Cloudflare Workflows behind `Jobs`, GA) and `extras/realtime`
  (a hand-written `Room` for WebSockets); `AGENTS.md` says when to use which. A project with all
  three passes its gate.
- `doctor` gains a `durable-objects` check: every class a binding names is exported from the
  Worker entry and, with wrangler, created by a migration. It covers realtime's `Room` too.

## Consequences

- A patch release of `effect` can change this add-on's API. `efforge upgrade` moves the pins with
  `effect`; the owner reads the package's changelog first.
- The demo does not show a durable sleep until upstream fixes the wake. When it does, a sleep can
  go back into `Review`, and `docs/cluster.md` and the card lose the caveat.
- Whatever shows only on real Durable Objects (eviction, hibernation, several isolates, alarm
  timing, a deploy while an entity is kept alive) is unverified by efforge.
