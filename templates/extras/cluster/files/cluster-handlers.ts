import { DurableObjectSqlClient } from "@effect/platform-cloudflare/CloudflareCluster"
import { Effect, Layer, Schema } from "effect"
import { Entity } from "effect/cluster"
import { Activity, DurableDeferred, DurableQueue } from "effect/workflow"
import { Approval, Counter, Greet, GreetingQueue, Review } from "./cluster"

/*
 * Import `@effect/platform-cloudflare/CloudflareCluster`, never the package
 * root: the root also loads the Durable Object classes, which import
 * `cloudflare:workers`, and then nothing here runs in Node (the tests).
 */

/** The counter's value lives in its Durable Object's own SQLite, keyed by id. */
export const CounterLive = Counter.toLayer(
  Effect.gen(function* () {
    const sql = yield* DurableObjectSqlClient.orDie
    const id = (yield* Entity.CurrentAddress).entityId
    yield* sql`CREATE TABLE IF NOT EXISTS counter (
      id TEXT PRIMARY KEY, value INTEGER NOT NULL)`
    const read = sql<{ readonly value: number }>`
      SELECT value FROM counter WHERE id = ${id}`.pipe(Effect.map((rows) => rows[0]?.value ?? 0))
    return Counter.of({
      Increment: ({ payload }) =>
        sql`INSERT INTO counter (id, value) VALUES (${id}, ${payload.by})
          ON CONFLICT (id) DO UPDATE SET value = value + ${payload.by}`.pipe(
          Effect.andThen(read),
          Effect.orDie,
          Effect.withSpan("Counter.Increment"),
        ),
      Get: () => read.pipe(Effect.orDie, Effect.withSpan("Counter.Get")),
    })
  }).pipe(Effect.orDie),
)

// #region card
/** Two activities around a durable wait. Each activity's result is stored. */
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
// #endregion

/** Offers one greeting and waits, suspended, until a worker has written it. */
export const GreetLive = Greet.toLayer(
  Effect.fnUntraced(function* ({ run, name }) {
    return yield* DurableQueue.process(GreetingQueue, { run, name })
  }),
)

/** Every handler the cluster serves. */
export const ClusterHandlers = Layer.mergeAll(CounterLive, ReviewLive, GreetLive)
