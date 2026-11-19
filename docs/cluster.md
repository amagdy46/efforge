# Your first entity and workflow on Durable Objects

`efforge add cluster` gives a project Effect Cluster on Cloudflare: an entity that keeps its state, a workflow that waits without holding a Worker, and a durable queue. It runs on Durable Objects through Effect's own `@effect/platform-cloudflare`, which Effect released in November 2026 and marks experimental. This page follows the three examples the add-on writes, then says what "experimental" means for a project that uses them.

You need to have read [Why your app is shaped like this](architecture.md). If Effect Cluster is new to you, the Effect blog's series explains it from the start: [Part 1, actors](https://effect.website/blog/module-of-the-week/cluster-actors), [Part 2, messaging](https://effect.website/blog/module-of-the-week/cluster-messaging), [Part 3, delivery](https://effect.website/blog/module-of-the-week/cluster-delivery), [Part 4, idempotency](https://effect.website/blog/module-of-the-week/cluster-idempotency) and [Part 5, workflows](https://effect.website/blog/module-of-the-week/cluster-workflow).

```sh
npx -y create-efforge add cluster
```

## Three pieces, one Durable Object each

On Cloudflare there are no runners and no shards to place. Each entity instance, each workflow run and each queue is its own Durable Object, found by name, and its SQLite storage is the record. The add-on binds four Durable Object classes that `@effect/platform-cloudflare` ships: `ClusterEntity`, `ClusterWorkflow`, `ClusterDurableQueue` and `ClusterSingleton` (`CLUSTER_ENTITY`, `CLUSTER_WORKFLOW`, `CLUSTER_QUEUE`, `CLUSTER_SINGLETON`). Nothing in the add-on uses the singleton yet; the cluster layer needs its binding.

| Piece | Defined in `packages/core/src/cluster.ts` | Handler in `cluster-handlers.ts` | What the card does |
| --- | --- | --- | --- |
| Entity | `Counter`, with `Increment` and `Get` | `CounterLive`: the count in the object's SQLite | Increments a counter by name |
| Workflow | `Review`, waiting on `Approval` | `ReviewLive`: `draft`, a durable wait, `publish` | Starts a run, approves it, shows each step |
| Queue | `GreetingQueue`, used by the `Greet` workflow | `GreetLive` offers; `writeGreeting` is the worker's job | Offers a greeting and shows what the worker wrote |

## The entity

An entity is a set of messages with one handler per id. The definition is plain Effect: the same code would run on any cluster backend.

<!-- sample: repo:templates/extras/cluster/files/core-cluster.ts -->
```ts
/** One counter per id; each id is its own Durable Object, with its own SQLite. */
export const Counter = Entity.make("Counter", [
  Rpc.make("Increment", {
    payload: { by: Schema.Number },
    success: Schema.Number,
  }).annotate(ClusterSchema.Persisted, true),
  Rpc.make("Get", { success: Schema.Number }),
])
```

`Persisted` stores an `Increment` in the object's mailbox before the handler runs, so an increment that was received is not lost if the object is evicted part way. The handler keeps the count in the object's own SQLite, through `DurableObjectSqlClient`. A caller never sees the Durable Object:

<!-- sample: repo:templates/extras/cluster/files/core-cluster.ts -->
```ts
    const id = `${yield* ownerKey(owner)}/${trimmed}`
    const counter = (yield* Counter.client)(id)
    const added = counter.Increment({ by: 1 })
    return yield* Effect.mapError(added, failed("Counter.Increment"))
```

The id starts with a hash of the signed-in user, so each user's counters are their own. To add an entity: define it beside `Counter`, write its handler layer beside `CounterLive` and add it to `ClusterHandlers`, and add the definition to `entities` in `apps/web/src/server/cluster.ts`.

## The workflow

A workflow is an Effect that can stop and carry on later. An activity's result is stored the first time it succeeds, so a run that resumes does not do that work again.

<!-- sample: repo:templates/extras/cluster/files/cluster-handlers.ts -->
```ts
export const ReviewLive = Review.toLayer(
  Effect.fnUntraced(function* ({ title }) {
    const draft = yield* Activity.make({
      name: "draft",
      success: Schema.String,
      execute: Effect.succeed(`"${title}" drafted`),
    })
    // suspends; no Worker is held until approveReview completes it
    const verdict = yield* DurableDeferred.await(Approval)
    return yield* Activity.make({
      name: "publish",
      success: Schema.String,
      execute: Effect.succeed(`${draft}, ${verdict}, published`),
    })
  }),
)
```

`DurableDeferred.await` suspends the run: its state is in the workflow's Durable Object and nothing runs until `approveReview` completes the deferred, minutes or days later. Then the object replays the run, `draft` returns its stored result, and `publish` runs. Locally the run resumes about 0.1 seconds after the approval.

The example waits on an approval, not on a timer, on purpose: see the durable sleep below.

## The queue

A `DurableQueue` hands work from a workflow to a worker and gives the worker's result back to the workflow. `Greet` offers one item and suspends until it is done.

On Cloudflare, nothing runs a worker in the background: a Worker only runs while it answers a request, a Cron Trigger or an alarm. So the request that offers a greeting also runs the worker, until its own item is written or 10 seconds have passed. The worker takes items in order, whoever offered them, so an item left behind by a request that ended early is taken by the next one. The queue is one Durable Object for the whole app; the card says so.

For work that must finish with no visitor, add a Cron Trigger to the Worker and run the worker for a bounded time in its `scheduled` handler. The add-on does not wire one: the generated Worker entry has no `scheduled` handler yet, and `wrangler dev` does not fire crons on its own, so it could not be tried locally.

## How a call reaches a Durable Object

`ClusterLive`, in `apps/web/src/server/cluster.ts`, builds `CloudflareCluster.layer` from the four bindings and registers the handlers. It is in `AppLayer`, so any server function can use `Counter.client` or `Review.execute`.

When a Durable Object starts, before it handles a request or an alarm, it waits for the app's runtime to build: that build is what registers the handlers. `apps/web/src/cluster/objects.ts` sets that up with `setInitializer` and re-exports the four classes, which `src/server.ts` exports to Cloudflare. A cold object therefore builds the whole `AppLayer` once, and Cloudflare allows 15 seconds for it.

Handlers import `@effect/platform-cloudflare/CloudflareCluster`, never the package root. The root also loads the Durable Object classes, which import `cloudflare:workers`, and then nothing under `packages/` could run in Node.

## Tests

`packages/core/test/cluster.test.ts` runs the same programs and handlers without Cloudflare: the entity on `TestRunner` with SQLite in memory, the workflows on `WorkflowEngine.layerMemory`, the queue on an in-memory store. They prove the code. They cannot prove anything about Durable Objects: timing, eviction and deploys show only under `pnpm dev` or on Cloudflare.

## When to use something else

- **Background jobs** that must run on time, retry per step and show in a dashboard: `extras/workflows`, Cloudflare Workflows behind the `Jobs` service. It is a GA Cloudflare product. A project can have both: the names do not clash.
- **WebSockets**: `extras/realtime`'s `Room`. Cluster entities answer requests; they do not hold sockets.
- **Effect code you want to run on another cluster backend later**, entities with state, workflows that wait on people or on other workflows: this add-on.

## What experimental means here

`@effect/platform-cloudflare` says of itself: "This package is experimental. Its APIs may change in patch releases." Every export is marked `@stability experimental`. efforge treats it that way:

- **Exact pins.** `@effect/platform-cloudflare` 4.1.4 and, for the tests, `@effect/sql-sqlite-node` 4.1.4, released with `effect` 4.1.4 and held to it by the overrides in `pnpm-workspace.yaml` ([ADR 0005](decisions/0005-effect-lockstep-overrides.md)). `efforge upgrade` moves them only with `effect`. Read the package's changelog before moving `effect` in a project that has this add-on.
- **What changed upstream so far.** The package first appeared in 4.1.3 (2026-11-10). 4.1.4 (2026-11-11) changed only its dependencies. A `CloudflareTracer` was merged on 2026-11-16 and is not released. Nothing has broken between versions yet, because there have been two. The README's `npm install effect@rc @effect/platform-cloudflare@rc` is stale: the `rc` tag is an old 4.0 release candidate.
- **A durable sleep wakes about a minute late.** In 4.1.4, a `DurableClock.sleep` that is the first thing a run awaits wakes when the workflow's 60 second guard alarm fires, not when the timer is due: a 3 second sleep finished at 60.1 seconds, every time it was measured. Starting a run arms the timer's alarm and the guard alarm at the same moment; each reads the current alarm and then sets its own, so the guard's 60 seconds can overwrite the timer's 3. When the run did any asynchronous work first (50 ms), the same sleep woke at 3.2 seconds. A sleep at or under a minute with `inMemoryThreshold` set runs in memory and is on time, but it keeps the Durable Object awake. Do not rely on a durable sleep's timing until upstream fixes it.
- **Restart `pnpm dev` after changing a handler.** A Durable Object keeps the handlers it started with. `setInitializer` may run once per isolate, while `pnpm dev` evaluates the Worker entry again after every edit, so the README's pattern makes every page fail after the first edit ("the Durable Object initializer is already set"); `objects.ts` keeps the first registration and reads the newest runtime.
- **What cannot be tested locally**, and is not tested by efforge: a deploy (with wrangler or with Alchemy), eviction and hibernation, several isolates, alarm timing in production, Cron Triggers, and a deploy while an entity is kept alive (it runs the old code for a while). Upstream's README says its own live Alchemy deploy has not been verified either. `pnpm dev`, `wrangler dev` on the production build and `alchemy dev` all ran every demo locally.
